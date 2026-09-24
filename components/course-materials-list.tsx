"use client";

import { useState } from "react";
import type { StudentMaterial } from "@/lib/data/course-materials";
import { materialTypeLabel } from "@/lib/course-materials/label";
import { DataList, DataRowIndex } from "@/components/ui/data-list";
import { Badge } from "@/components/ui/badge";

/** Published course materials, student-facing. Link kind opens the stored
 * URL directly; file kind fetches a signed URL on click (never rendered
 * into the page — students never receive a raw storage path). */
export function CourseMaterialsList({ materials }: { materials: StudentMaterial[] }) {
  return (
    <DataList>
      {materials.map((material, i) => (
        <li key={material.id} className="py-3">
          <div className="flex items-center gap-3">
            <DataRowIndex>{i + 1}</DataRowIndex>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[15px] font-medium text-ink">{material.title}</div>
              {material.description && (
                <p className="mt-0.5 line-clamp-2 text-xs text-muted">{material.description}</p>
              )}
            </div>
            <Badge tone="outline">{materialTypeLabel(material.kind, material.mimeType)}</Badge>
          </div>
          <div className="mt-2 pl-8">
            {material.kind === "link" ? (
              <a
                href={material.url ?? "#"}
                target="_blank"
                rel="noreferrer"
                className="text-sm font-medium text-primary hover:underline"
              >
                Open link
              </a>
            ) : (
              <MaterialFileLink materialId={material.id} title={material.title} />
            )}
          </div>
        </li>
      ))}
    </DataList>
  );
}

const ERROR_MESSAGES: Record<number, string> = {
  401: "Your session has expired. Please sign in again.",
  404: "This file isn't available.",
  429: "Too many requests. Please wait a moment and try again.",
  503: "This file is unavailable right now. Please try again.",
};

/** Fetches a signed URL on click and opens it in a new tab — nothing is
 * pre-fetched for the whole list, and the URL is never rendered as an
 * href (so it can't be copied/shared past its short TTL). */
function MaterialFileLink({ materialId, title }: { materialId: string; title: string }) {
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function open() {
    setState("loading");
    setError(null);
    try {
      const res = await fetch(`/api/course-materials/${materialId}`, {
        headers: { accept: "application/json" },
        cache: "no-store",
      });
      if (!res.ok) {
        setState("error");
        setError(ERROR_MESSAGES[res.status] ?? "We couldn't load this file.");
        return;
      }
      const data = (await res.json()) as { url: string };
      setState("idle");
      window.open(data.url, "_blank", "noopener,noreferrer");
    } catch {
      setState("error");
      setError("We couldn't load this file. Check your connection.");
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={open}
        disabled={state === "loading"}
        className="text-sm font-medium text-primary hover:underline disabled:opacity-60"
      >
        {state === "loading" ? "Opening…" : `Open ${title}`}
      </button>
      {state === "error" && (
        <p role="alert" className="mt-1 text-xs text-error">
          {error}
        </p>
      )}
    </div>
  );
}
