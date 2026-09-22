"use client";

import { ErrorState } from "@/components/route-states";

export default function ProfessorError({ reset }: { error: Error; reset: () => void }) {
  return <ErrorState reset={reset} />;
}
