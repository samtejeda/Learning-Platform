import type { HTMLAttributes, ReactNode } from "react";

// Row list for rosters, lecture lists, admin tables — the Airtable reference's
// "hairline divider row" convention, in DESIGN.md colors. Reads as a table on
// sm+ and stacks (title over meta) on phones. Every row is ≥56px tall so the
// whole row is a comfortable tap target.

export function DataList({ className = "", ...props }: HTMLAttributes<HTMLUListElement>) {
  return <ul role="list" className={`divide-y divide-hairline ${className}`} {...props} />;
}

export function DataRow({ className = "", ...props }: HTMLAttributes<HTMLLIElement>) {
  return <li className={`flex min-h-14 items-center gap-3 py-3 ${className}`} {...props} />;
}

export function DataRowIndex({ children }: { children: ReactNode }) {
  return <span className="w-6 shrink-0 text-sm tabular-nums text-muted-soft">{children}</span>;
}

export function DataRowMain({ title, meta }: { title: ReactNode; meta?: ReactNode }) {
  return (
    <div className="min-w-0 flex-1">
      <div className="truncate text-[15px] font-medium text-ink">{title}</div>
      {meta && (
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">{meta}</div>
      )}
    </div>
  );
}

export function DataRowActions({ children }: { children: ReactNode }) {
  return <div className="flex shrink-0 items-center gap-1">{children}</div>;
}
