"use client";

import { useActionState, useState } from "react";
import type { ActionState } from "@/lib/validation/form";
import type { ContentLanguage } from "@/lib/exams/language";
import { Alert } from "@/components/ui/alert";
import { SegmentedRadio } from "@/components/ui/segmented-radio";
import { SubmitButton } from "@/components/ui/submit-button";

/** Choose the language to read and answer in, then start (or resume) an attempt. */
export function StartAttemptForm({
  action,
  defaultLanguage,
  resuming,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  defaultLanguage: ContentLanguage;
  resuming: boolean;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(action, null);
  const [language, setLanguage] = useState<ContentLanguage>(defaultLanguage);

  return (
    <form action={formAction} className="space-y-4">
      {state?.error && <Alert tone="error">{state.error}</Alert>}
      {resuming ? (
        <>
          <p className="text-sm text-muted">This attempt keeps the language you started it in.</p>
          <input type="hidden" name="language" value={language} />
        </>
      ) : (
        <SegmentedRadio
          legend="Language for this attempt"
          name="language"
          value={language}
          onChange={setLanguage}
          options={[
            { value: "es", label: "Español" },
            { value: "en", label: "English" },
          ]}
        />
      )}
      <SubmitButton pendingLabel="Starting…" fullWidth={false} className="min-h-11 w-full sm:w-auto">
        {resuming ? "Resume attempt" : "Start attempt"}
      </SubmitButton>
    </form>
  );
}
