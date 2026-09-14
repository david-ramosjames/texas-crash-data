export function singleFlight<T>(task: () => Promise<T>) {
  let pending: Promise<T> | undefined;
  return () => {
    if (!pending) pending = task().finally(() => { pending = undefined; });
    return pending;
  };
}

// Schedule after completion, not on a fixed interval: slow requests cannot pile up.
export function pollAfterCompletion(task: () => Promise<unknown>, interval: number, visible: () => boolean, onError: (error: unknown) => void = () => {}) {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout>;
  const tick = async () => {
    try { if (visible()) await task(); } catch (error) { onError(error); }
    if (!stopped) timer = setTimeout(tick, interval);
  };
  timer = setTimeout(tick, interval);
  return () => { stopped = true; clearTimeout(timer); };
}
