"use client";

import type { StudentMaterial } from "@/lib/data/course-materials";
import { materialTypeLabel } from "@/lib/course-materials/label";
import { FileRowContent, OpenFileRow, fileRowClassName } from "@/components/course-files/file-row";
import { DataList, DataRowIndex } from "@/components/ui/data-list";
import { Badge } from "@/components/ui/badge";

/** Published course materials, student-facing. Each row is one whole-row tap
 * target that opens in a new tab. Link kind opens the stored URL directly;
 * file kind fetches a signed URL on tap (never rendered into the page —
 * students never receive a raw storage path). */
export function CourseMaterialsList({ materials }: { materials: StudentMaterial[] }) {
  return (
    <DataList>
      {materials.map((material, i) => {
        const leading = <DataRowIndex>{i + 1}</DataRowIndex>;
        const badge = <Badge tone="outline">{materialTypeLabel(material.kind, material.mimeType)}</Badge>;
        const description = material.description ? (
          <span className="line-clamp-2">{material.description}</span>
        ) : undefined;
        return (
          <li key={material.id}>
            {material.kind === "link" ? (
              <a
                href={material.url ?? "#"}
                target="_blank"
                rel="noreferrer"
                className={fileRowClassName}
              >
                <FileRowContent
                  leading={leading}
                  title={material.title}
                  description={description}
                  badge={badge}
                />
                <span className="sr-only">(opens in a new tab)</span>
              </a>
            ) : (
              <OpenFileRow
                endpoint={`/api/course-materials/${material.id}`}
                title={material.title}
                description={description}
                leading={leading}
                badge={badge}
              />
            )}
          </li>
        );
      })}
    </DataList>
  );
}
