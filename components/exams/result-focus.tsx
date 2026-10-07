"use client";

import { useEffect } from "react";

/** Moves focus to the result heading when the result screen appears, so a screen reader announces it. */
export function ResultFocus({ targetId }: { targetId: string }) {
  useEffect(() => {
    document.getElementById(targetId)?.focus({ preventScroll: true });
  }, [targetId]);
  return null;
}
