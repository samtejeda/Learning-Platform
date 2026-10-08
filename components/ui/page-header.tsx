import type { ReactNode } from "react";
import { Breadcrumb, type Crumb } from "./breadcrumb";

type Props = {
  title: string;
  /** Small muted line above the title (e.g. course name on a lecture page). */
  eyebrow?: ReactNode;
  /** One-line description under the title. */
  lead?: ReactNode;
  /** Buttons/links; stack under the title on phones, sit to the right on sm+. */
  actions?: ReactNode;
  /** Back link rendered above everything. With `crumbs`, it shows below the `lg` breakpoint only. */
  back?: ReactNode;
  /** The trail for wide screens (replaces the Back link from `lg` up). The last item is the current page. */
  crumbs?: Crumb[];
};

export function PageHeader({ title, eyebrow, lead, actions, back, crumbs }: Props) {
  return (
    <header className="space-y-3">
      {crumbs ? (
        <>
          <div className="lg:hidden">{back}</div>
          <Breadcrumb items={crumbs} />
        </>
      ) : (
        back
      )}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          {eyebrow && <p className="mb-1 text-sm font-medium text-muted">{eyebrow}</p>}
          <h1 className="text-[2rem] leading-[1.1] sm:text-4xl">{title}</h1>
          {lead && (
            <p className="mt-2 max-w-prose whitespace-pre-line text-[15px] text-muted">{lead}</p>
          )}
        </div>
        {actions && (
          <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center">{actions}</div>
        )}
      </div>
    </header>
  );
}
