import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { all, first, run, withConnection } from "../lib/db";
import { BASE, compile, validateSpec } from "../lib/research";
import { bodyAnalysis } from "../lib/body-research";
import { discoveryCheckpoints } from "../lib/discovery-checkpoints";

test("paged body research preserves exact global counts, filters, revisions and durable recovery", async () => {
  const pg = new PGlite();
  for (const file of ["001_core.sql", "004_discovery_checkpoints.sql", "007_research_desk.sql"])
    await pg.exec(await readFile(new URL("../migrations/" + file, import.meta.url), "utf8"));
  const connection = {
    query: async (sql: string, args?: unknown[]) => {
      const r = await pg.query(sql, args);
      return { ...r, rowCount: r.affectedRows };
    },
  };
  try {
    await withConnection(connection, async () => {
      for (const id of ["old", "new"])
        await run(
          `INSERT INTO batches(id,extraction,start,"end",status,created,manifest,time_parser_version)
      VALUES(?,?,'2024-01-01','2025-12-31','complete','2026-01-01','[]',2)`,
          id,
          id,
        );
      await run(`INSERT INTO crashes(batch_id,id,date,hour,city,county,road,intersection,severity,cmv,deaths,serious,injuries,latitude,longitude,weather,light,rural,speed,intersection_flag)
      SELECT 'old',lpad(i::text,4,'0'),CASE WHEN i%2=0 THEN '2024-01-01' ELSE '2025-01-01' END,
      i%24,CASE WHEN i%2=0 THEN 'DALLAS' ELSE 'HOUSTON' END,'COUNTY','ROAD',CASE WHEN i%3=0 THEN '' ELSE 'MAIN & OAK' END,
      CASE WHEN i%3=0 THEN 4 ELSE 1 END,i%2,CASE WHEN i%3=0 THEN 2 ELSE 0 END,1,1,
      CASE WHEN i%2=0 THEN NULL ELSE 32.0 END,-96,'CLEAR','DAYLIGHT','N',35,1 FROM generate_series(1,16) i`);
      await run(
        `INSERT INTO crashes SELECT 'new',id,date,hour,city,county,road,intersection,severity,cmv,deaths,serious,injuries,latitude,longitude,weather,light,rural,speed,intersection_flag FROM crashes WHERE id='0001'`,
      );
      await run(
        `INSERT INTO current_crashes SELECT id,CASE WHEN id='0001' THEN 'new' ELSE 'old' END,'2026' FROM crashes WHERE batch_id='old'`,
      );
      for (const id of ["old", "new"]) {
        await run(
          "INSERT INTO lookups VALUES(?,'VEH_BODY_STYL_ID','106',?)",
          id,
          id === "old" ? "TRUCK" : "REVISED LABEL",
        );
        await run(
          "INSERT INTO lookups VALUES(?,'VEH_BODY_STYL_ID','87',?)",
          id,
          id === "old" ? "TRUCK" : "REVISED LABEL",
        );
      }
      // Duplicated vehicles and different codes sharing a label count once per crash.
      // Unknown code and NULL body both become Not recorded and also count once.
      await run(`INSERT INTO units(batch_id,crash_id,number,kind,body,make,model,color,year,cmv,factor)
      SELECT c.batch_id,c.id,n::text,1,CASE n WHEN 1 THEN 106 WHEN 2 THEN 106 WHEN 3 THEN 87 WHEN 4 THEN 999 ELSE NULL END,
      CASE WHEN n=5 THEN 'CHEVROLET' ELSE 'FORD' END,'MODEL',CASE WHEN n=5 THEN 'RED' ELSE 'WHITE' END,2020,1,'FACTOR'
      FROM crashes c CROSS JOIN generate_series(1,5) n WHERE c.id<>'0016'`);
      const base = validateSpec({
        group: "body",
        start: "2024-01-01",
        end: "2025-12-31",
        min: 1,
        limit: 10,
      });
      for (const filter of [
        {},
        { min: 10, limit: 1 },
        { metric: "fatal", min: 3 },
        { metric: "severe" },
        { cohort: "truck" },
        { cohort: "cmv" },
        { cohort: "pedestrian" },
        { make: "FORD", color: "RED" },
        { make: "CHEVROLET", color: "RED" },
        { yearMin: 2020, yearMax: 2020, model: "MODEL", factor: "FACTOR" },
        { city: "Dallas", start: "2024-01-01", end: "2024-12-31", hourFrom: 2, hourThrough: 15 },
        { city: "absent" },
      ]) {
        const spec = validateSpec({ ...base, ...filter }),
          q = compile(spec);
        const expected = await all(q.sql, ...q.args);
        const expectedTotals = await first(
          `SELECT COUNT(*) total,COUNT(*) FILTER (WHERE c.severity IN (1,4)) severe,
        COUNT(*) FILTER (WHERE c.severity=4) fatal,COUNT(*) FILTER (WHERE c.latitude IS NULL) unlocated,
        COUNT(*) FILTER (WHERE c.intersection='') no_intersection ${BASE} ${q.where}`,
          ...q.filterArgs,
        );
        const expectedSources = await all(
          `SELECT DISTINCT b.id,b.extraction,b.start,b."end" ${BASE} JOIN batches b ON b.id=c.batch_id ${q.where} ORDER BY b.id`,
          ...q.filterArgs,
        );
        const result = await bodyAnalysis(
          spec,
          async () => {},
          async (_key, task) => task(),
          2,
        );
        assert.deepEqual(result.rows, expected, JSON.stringify(filter));
        assert.deepEqual(result.totals, expectedTotals, JSON.stringify(filter));
        assert.deepEqual(result.sources, expectedSources, JSON.stringify(filter));
      }
      // Persist two completed pages, interrupt page three, then retry the same job.
      await run("INSERT INTO jobs(id,kind) VALUES('body-recovery','discover')");
      const cp = await discoveryCheckpoints("body-recovery");
      let failPage = true,
        failFinal = true;
      const pages: string[] = [];
      const recovering = {
        query: async (sql: string, args?: unknown[]) => {
          if (sql.startsWith("WITH crash_page")) {
            const cursor = typeof args?.[0] === "string" ? args[0] : "start";
            pages.push(cursor);
            if (cursor === "0004" && failPage) {
              failPage = false;
              throw Object.assign(new Error("page timeout"), { code: "57014" });
            }
          }
          if (sql.startsWith("SELECT label,crashes") && failFinal) {
            failFinal = false;
            throw Object.assign(new Error("final timeout"), { code: "57014" });
          }
          return connection.query(sql, args);
        },
      };
      const attempt = () =>
        withConnection(recovering, () =>
          bodyAnalysis(
            base,
            async () => {},
            (stage, task) =>
              cp.query("research-stage-v1", { spec: base, stage }, stage, async () => {}, task),
            2,
          ),
        );
      await assert.rejects(attempt, /page timeout/);
      assert.deepEqual(pages, ["start", "0002", "0004"]);
      await assert.rejects(attempt, /final timeout/);
      assert.equal(pages.filter((p) => p === "start").length, 1);
      assert.equal(pages.filter((p) => p === "0002").length, 1);
      assert.equal(pages.filter((p) => p === "0004").length, 2);
      const reads = pages.length;
      const recovered = await attempt();
      assert.equal(pages.length, reads, "Final-stage retry must reuse every saved page");
      const q = compile(base);
      assert.deepEqual(recovered.rows, await all(q.sql, ...q.args));
      assert.equal(recovered.totals.total, 16, "Count crashes with no vehicles in the denominator");
      assert.equal(recovered.rows.find((r) => r.label === "TRUCK")?.crashes, 14);
      assert.equal(recovered.rows.find((r) => r.label === "REVISED LABEL")?.crashes, 1);
      assert.equal(recovered.rows.find((r) => r.label === "Not recorded")?.crashes, 15);
      const empty = validateSpec({ ...base, city: "absent" });
      assert.equal(
        (
          await bodyAnalysis(
            empty,
            async () => {},
            async (_key, task) => task(),
            2,
          )
        ).rows.length,
        0,
      );
      await assert.rejects(
        () =>
          bodyAnalysis(
            base,
            async () => {},
            async (_key, task) => task(),
            0,
          ),
        /Invalid/,
      );
      await assert.rejects(
        () =>
          bodyAnalysis(
            base,
            async (phase) => {
              if (phase.includes("page 2"))
                await run(
                  "INSERT INTO settings(key,value) VALUES('summary_generation','changed') ON CONFLICT(key) DO UPDATE SET value='changed'",
                );
            },
            async (_key, task) => task(),
            2,
          ),
        /Imported data changed/,
      );
    });
  } finally {
    await pg.close();
  }
});
