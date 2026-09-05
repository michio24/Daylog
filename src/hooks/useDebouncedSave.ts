import { useCallback, useEffect, useRef } from "react";

export function useDebouncedSave<T>(value: T, save: (value: T) => Promise<void>, delay = 700) {
  const latest = useRef(value);
  const previous = useRef(value);
  const timer = useRef<number>();
  const dirty = useRef(false);
  const pending = useRef<Promise<void> | null>(null);
  const saveRef = useRef(save);
  saveRef.current = save;

  const flush = useCallback(async () => {
    window.clearTimeout(timer.current);
    if (pending.current) {
      try { await pending.current; } catch { /* The pending change remains dirty for this retry. */ }
    }
    while (dirty.current) {
      const saving = latest.current;
      dirty.current = false;
      const work = saveRef.current(saving);
      pending.current = work;
      try {
        await work;
      } catch (error) {
        dirty.current = true;
        throw error;
      } finally {
        pending.current = null;
      }
    }
  }, []);

  useEffect(() => {
    latest.current = value;
    if (Object.is(previous.current, value)) return;
    previous.current = value;
    dirty.current = true;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void flush().catch(() => undefined), delay);
    return () => window.clearTimeout(timer.current);
  }, [value, delay, flush]);

  useEffect(() => () => { void flush(); }, [flush]);

  return flush;
}
