"use client";

import { useEffect, useState } from "react";
import type { SectionId } from "./sections";

/**
 * Which section is "current" while scrolling: the last one whose top has
 * passed just under the sticky header(s). Starts on the first section so the
 * server render and the first client render agree.
 */
export function useActiveSection(ids: SectionId[], offset: number): [SectionId | null, (id: SectionId) => void] {
  const [active, setActive] = useState<SectionId | null>(ids[0] ?? null);
  const key = ids.join(",");

  useEffect(() => {
    const list = key ? (key.split(",") as SectionId[]) : [];
    let frame = 0;
    const update = () => {
      frame = 0;
      let current: SectionId | null = list[0] ?? null;
      for (const id of list) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top - offset <= 0) current = id;
      }
      // At the very bottom the last section is current even if it is short.
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2 && list.length) {
        current = list[list.length - 1];
      }
      setActive(current);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [key, offset]);

  return [active, setActive];
}
