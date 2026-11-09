"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * Re-render the lecture page's server parts the moment the SERVER reports this
 * lecture complete during a session, so anything that depends on completion
 * (the comprehension question) appears without a manual reload. Fires only on
 * the false → true flip: a lecture that was already complete on arrival, or an
 * instructor preview (`enabled` false), never refreshes.
 */
export function useRefreshOnComplete(completed: boolean, enabled: boolean) {
  const router = useRouter();
  const wasCompleted = useRef(completed);
  useEffect(() => {
    if (enabled && completed && !wasCompleted.current) router.refresh();
    wasCompleted.current = completed;
  }, [completed, enabled, router]);
}
