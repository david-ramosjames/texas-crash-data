// Public diagnostics must never contain driver messages, SQL, row values or credentials.
const hints: Record<string, string> = {
  '42P01': 'A database table is missing or not visible. Check migrations and the database search path.',
  '42703': 'A database column is missing. Check that all migrations have completed.',
  '42501': 'The database account lacks permission for this operation.',
  '28P01': 'Database authentication failed. Check the database credentials in Railway.',
  '28000': 'Database authentication was rejected. Check the database connection configuration.',
  '3D000': 'The configured database does not exist.',
  '23505': 'A duplicate record conflicts with an existing database record.',
  '23503': 'A required related database record is missing.',
  '53300': 'The database connection limit has been reached.',
  '57014': 'The database query was cancelled or timed out.',
  '25006': 'The database is read-only. Restore writable capacity before retrying.',
  '53100': 'The database disk is full. Increase available disk space before retrying.',
  '53200': 'The database ran out of memory while executing this operation.',
  ECONNREFUSED: 'The database or upstream service refused the connection.',
  ECONNRESET: 'The database or upstream service reset the connection.',
  ETIMEDOUT: 'The database or upstream connection timed out.',
  ENOTFOUND: 'The configured database or upstream hostname could not be resolved.',
  EAI_AGAIN: 'Hostname lookup temporarily failed.',
  ENETUNREACH: 'The database or upstream network is unreachable.',
  EHOSTUNREACH: 'The database or upstream host is unreachable.',
  ERR_INVALID_URL: 'A configured service URL is invalid. Check the Railway variables.',
};
for (const code of ['SELF_SIGNED_CERT_IN_CHAIN', 'DEPTH_ZERO_SELF_SIGNED_CERT',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_HAS_EXPIRED', 'ERR_TLS_CERT_ALTNAME_INVALID']) {
  hints[code] = 'TLS certificate verification failed. Check the database CA certificate and hostname; keep certificate verification enabled.';
}

export function requestFailure(error: unknown): { error: string; code: string } {
  let current = error;
  let hasCode = false;
  // Fetch and connection libraries sometimes wrap the useful code in a cause.
  for (let depth = 0; current && typeof current === 'object' && depth < 5; depth++) {
    const item = current as { code?: unknown; cause?: unknown };
    hasCode ||= item.code !== undefined;
    if (typeof item.code === 'string' &&
        (Object.hasOwn(hints, item.code) || /^[0-9A-Z]{5}$/.test(item.code))) {
      const code = item.code;
      const hint = hints[code] || 'The database or upstream service rejected this operation.';
      return { error: `${hint} [code: ${code}]`, code };
    }
    current = item.cause;
  }
  const message = error instanceof Error ? error.message : 'The operation could not finish.';
  if (hasCode || /password|connection|certificate|postgres(?:ql)?:\/\/|sb_secret_|sk-|Bearer\s/i.test(message)) {
    const code = 'CONNECTION_OR_SERVICE_ERROR';
    return { error: `A database or service operation failed. Check the deployment configuration. [code: ${code}]`, code };
  }
  // Retain existing input-validation feedback for errors with no driver code.
  return { error: message, code: 'REQUEST_ERROR' };
}
