import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";

/** Shared frame for the signed-out pages: serif title, muted lead, cream card. */
export function AuthCard({ title, lead, children }: { title: string; lead?: ReactNode; children: ReactNode }) {
  return (
    <Card>
      <h1 className="text-[2rem] leading-[1.1]">{title}</h1>
      {lead && <p className="mt-1.5 text-sm text-muted">{lead}</p>}
      <div className="mt-6">{children}</div>
    </Card>
  );
}
