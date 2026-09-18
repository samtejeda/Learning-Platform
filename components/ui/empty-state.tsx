import type { ReactNode } from "react";
import { Card } from "./card";

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <Card variant="outlined" className="text-center">
      <p className="font-medium text-ink">{title}</p>
      {description && <p className="mx-auto mt-1 max-w-sm text-sm text-muted">{description}</p>}
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </Card>
  );
}
