"use client";

import { useState } from "react";
import type { ActionState } from "@/lib/validation/form";
import type { OwnedComprehension } from "@/lib/data/lecture-comprehension";
import { comprehensionProblems } from "@/lib/lectures/comprehension";
import { Card, CardTitle } from "@/components/ui/card";
import { AuthoringForm } from "./authoring-form";
import { ComprehensionStatus } from "./comprehension-status";
import { draftFromSaved, sameFields, type ComprehensionDraft } from "./question-model";

/**
 * Professor side of the lecture's comprehension question: the on/off card and
 * the authoring form. The draft lives here so the status card knows whether
 * there are unsaved edits (enabling uses the stored question).
 */
export function ComprehensionPanel({
  data,
  save,
  enable,
  disable,
}: {
  data: OwnedComprehension;
  save: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  enable: () => Promise<ActionState>;
  disable: () => Promise<ActionState>;
}) {
  const [draft, setDraft] = useState<ComprehensionDraft>(() => draftFromSaved(data.questions));
  const saved = draftFromSaved(data.questions);
  const problems = comprehensionProblems(data.questions);

  return (
    <div className="space-y-6">
      <ComprehensionStatus
        enabled={data.enabled}
        published={data.published}
        problems={problems}
        dirty={!sameFields(draft, saved)}
        enable={enable}
        disable={disable}
      />
      <Card>
        <CardTitle className="mb-1">Write the question</CardTitle>
        <p className="mb-5 text-sm text-muted">
          Write it in Español and English. Students choose which to read. Marking the correct option works for both languages.
        </p>
        <AuthoringForm action={save} draft={draft} onChange={setDraft} />
      </Card>
    </div>
  );
}
