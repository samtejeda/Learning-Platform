"use client";

import type { ActionState } from "@/lib/validation/form";
import type { ComprehensionProblem } from "@/lib/lectures/comprehension";
import { ConfirmAction } from "@/components/exams/confirm-action";
import { CheckIcon, WarnIcon } from "@/components/exams/status-icons";
import { Badge } from "@/components/ui/badge";
import { Card, CardTitle } from "@/components/ui/card";

/**
 * On/off plus the "ready to turn on" checklist. The checklist is computed from
 * the SAVED question by the same pure rules the server re-checks when enabling,
 * so it names exactly what the server would refuse. Turning off says plainly
 * that the written question is kept.
 */
export function ComprehensionStatus({
  enabled,
  published,
  problems,
  dirty,
  enable,
  disable,
}: {
  enabled: boolean;
  published: boolean;
  problems: ComprehensionProblem[];
  /** The form has unsaved edits; enabling uses what is stored, so it waits for a save. */
  dirty: boolean;
  enable: () => Promise<ActionState>;
  disable: () => Promise<ActionState>;
}) {
  const bySlot = [1, 2]
    .map((slot) => ({ slot, messages: problems.filter((p) => p.slot === slot).map((p) => p.message) }))
    .filter((g) => g.messages.length > 0);
  const ready = problems.length === 0;

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <CardTitle>Quick check question</CardTitle>
        <Badge tone={enabled ? "success" : "outline"}>
          {enabled ? <CheckIcon /> : null}
          {enabled ? "On: students are asked" : "Off: students aren't asked"}
        </Badge>
      </div>
      <p className="mb-4 text-sm text-muted">
        After finishing this lecture, a student answers one multiple-choice question. They get two attempts in total.
      </p>

      {enabled ? (
        <div className="space-y-4">
          <p className="text-sm text-body-strong">
            {published
              ? "Students see the question below the video once they have finished the lecture."
              : "This lecture isn't published yet. Students will see the question once you publish it."}
          </p>
          <p className="text-sm text-muted">While it is on, a save that would leave it incomplete is refused.</p>
          <ConfirmAction
            action={disable}
            variant="secondary"
            busyLabel="Turning off…"
            confirm={{
              title: "Turn the question off?",
              body: "Students stop seeing it. Your written question is kept, so you can turn it back on later.",
              confirmLabel: "Yes, turn it off",
            }}
          >
            Turn off
          </ConfirmAction>
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <h3 className="mb-2 font-sans text-base font-medium text-ink">Ready to turn on?</h3>
            {ready ? (
              <p className="flex items-center gap-2 text-sm font-medium text-success-strong">
                <CheckIcon />
                The saved question is complete in Spanish and English.
              </p>
            ) : (
              <div className="space-y-3">
                <p className="flex items-center gap-2 text-sm font-medium text-warning-strong">
                  <WarnIcon />
                  {problems.length} {problems.length === 1 ? "thing needs" : "things need"} fixing before you can turn it on
                </p>
                <ul role="list" className="space-y-3">
                  {bySlot.map((g) => (
                    <li key={g.slot} className="text-sm text-body">
                      <a
                        href={`#comprehension-q${g.slot}`}
                        className="rounded-sm font-medium text-ink underline underline-offset-2 hover:no-underline focus-visible:focus-ring"
                      >
                        Question {g.slot}
                      </a>
                      <ul className="mt-1 list-disc pl-5">
                        {g.messages.map((m) => (
                          <li key={m}>{m}</li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="mt-2 text-xs text-muted">This checks the question as last saved.</p>
          </div>
          <ConfirmAction
            action={enable}
            variant="primary"
            busyLabel="Turning on…"
            disabled={!ready || dirty}
            disabledReason={
              !ready
                ? "Fix the items above, save, then turn it on."
                : "You have unsaved changes. Save them first: turning it on uses the saved question."
            }
          >
            Turn on
          </ConfirmAction>
        </div>
      )}
    </Card>
  );
}
