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
  // When this page was server-rendered (hard load or refresh), the browser's
  // FormData also carries React's hidden `$ACTION_*` bookkeeping fields, which
  // the action's strict schema rejects ("Unrecognized keys"). Send only the
  // real field so Start works after a refresh as well as after a soft navigation.
  const [state, formAction] = useActionState<ActionState, FormData>((prev, formData) => {
    const clean = new FormData();
    for (const [key, value] of formData.entries()) if (!key.startsWith("$ACTION")) clean.append(key, value);
    return action(prev, clean);
  }, null);
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
