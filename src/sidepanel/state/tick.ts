/**
 * A 1-Hz re-render hook.
 *
 * The running timer's elapsed time is derived from
 * `Date.now() - startedAt`. To make the UI tick, we need a
 * component to re-render every second. This hook returns a
 * number that increments once per second; components that
 * read it via `useTickingNow()` will re-render on every tick.
 *
 * The interval is started on mount and cleared on unmount.
 * The hook honors `prefers-reduced-motion`: we still tick
 * (the data is real) but the visual flash effects in the
 * components that use this hook are disabled by CSS.
 */
import { useEffect, useState } from "preact/hooks";

export function useTickingNow(): number {
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}
