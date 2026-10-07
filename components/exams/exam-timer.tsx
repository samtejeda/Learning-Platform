"use client";

import { useEffect, useRef, useState } from "react";

/** Seconds-left marks that get announced to screen readers, largest first. */
const THRESHOLDS = [
  { at: 300, message: "5 minutes left." },
  { at: 60, message: "1 minute left." },
  { at: 30, message: "30 seconds left." },
  { at: 0, message: "Time is up. Saving your answers." },
] as const;

export function formatClock(seconds: number) {
  const s = Math.max(0, seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * The exam countdown. Display only: the server enforces the deadline.
 * The ticking clock is a `role="timer"` (implicitly aria-live="off", so it is
 * never announced as it changes, but it can be read on demand). A separate
 * polite live region announces only the threshold marks above, once each.
 */
export function ExamTimer({ deadlineIso, onExpire }: { deadlineIso: string; onExpire: () => void }) {
  const deadline = new Date(deadlineIso).getTime();
  const [remaining, setRemaining] = useState(() => Math.round((deadline - Date.now()) / 1000));
  const [announcement, setAnnouncement] = useState("");
  const announced = useRef<number | null>(null);
  const expired = useRef(false);
  const onExpireRef = useRef(onExpire);
  useEffect(() => {
    onExpireRef.current = onExpire;
  });

  useEffect(() => {
    const tick = () => {
      const left = Math.round((deadline - Date.now()) / 1000);
      setRemaining(left);
      // The smallest mark we've reached. Announce it once; a page that opens
      // already past a mark (e.g. 40 s left) stays quiet until the next one.
      const crossed = [...THRESHOLDS].reverse().find((t) => left <= t.at);
      if (crossed && announced.current !== crossed.at) {
        const firstTick = announced.current === null;
        announced.current = crossed.at;
        if (!firstTick || left >= crossed.at - 2) setAnnouncement(crossed.message);
      }
      if (left <= 0 && !expired.current) {
        expired.current = true;
        onExpireRef.current();
      }
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [deadline]);

  const urgent = remaining <= 60;
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-xs text-muted">Time left</span>
      <span
        role="timer"
        aria-label="Time left"
        className={`text-lg font-medium tabular-nums ${urgent ? "text-warning-strong" : "text-ink"}`}
      >
        {formatClock(remaining)}
      </span>
      {urgent && remaining > 0 && <span className="text-xs font-medium text-warning-strong">Under a minute</span>}
      <p role="status" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}
