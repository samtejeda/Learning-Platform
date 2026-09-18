"use client";

import { useActionState } from "react";
import type { ActionState } from "@/lib/validation/form";
import type { Roster } from "@/lib/data/enrollments";
import { Field } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";
import { SubmitButton } from "@/components/ui/submit-button";
import { Button } from "@/components/ui/button";

type FormAction = (prev: ActionState, formData: FormData) => Promise<ActionState>;

type Props = {
  roster: Roster;
  /** Server actions already bound to the course id by the page. */
  invite: FormAction;
  remove: FormAction;
  revoke: FormAction;
};

/**
 * Roster: invite by email + list of enrolled/invited students with remove
 * buttons. Plain by design; the frontend pass may restyle freely. Contract:
 * field names `email`, `studentId`, `invitationId` match the schemas in
 * lib/validation/enrollments.ts.
 */
export function RosterManager({ roster, invite, remove, revoke }: Props) {
  const [state, inviteAction] = useActionState<ActionState, FormData>(invite, null);

  return (
    <div className="space-y-5">
      <form action={inviteAction} className="space-y-3" noValidate>
        {state?.error && <Alert tone="error">{state.error}</Alert>}
        {state?.success && <Alert tone="success">{state.success}</Alert>}
        <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
          <div className="flex-1">
            <Field
              label="Invite a student by email"
              name="email"
              type="email"
              autoComplete="off"
              placeholder="student@example.com"
              required
              defaultValue={state?.error ? state.values?.email : ""}
              errors={state?.fieldErrors?.email}
              hint="They're enrolled right away if they have an account, or as soon as they create one."
            />
          </div>
          <div className="sm:pb-6">
            <SubmitButton pendingLabel="Inviting…" fullWidth={false}>
              Invite
            </SubmitButton>
          </div>
        </div>
      </form>

      {roster.enrolled.length === 0 && roster.invited.length === 0 ? (
        <p className="text-sm text-slate-500">No students yet.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {roster.enrolled.map((s) => (
            <RosterRow
              key={s.studentId}
              label={s.name ?? s.email ?? "Student"}
              sublabel={s.name && s.email ? s.email : null}
              status="Enrolled"
              statusClass="text-green-700"
              action={remove}
              hiddenName="studentId"
              hiddenValue={s.studentId}
              buttonLabel="Remove"
            />
          ))}
          {roster.invited.map((inv) => (
            <RosterRow
              key={inv.id}
              label={inv.email}
              sublabel={null}
              status="Invited"
              statusClass="text-slate-500"
              action={revoke}
              hiddenName="invitationId"
              hiddenValue={inv.id}
              buttonLabel="Withdraw"
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function RosterRow(props: {
  label: string;
  sublabel: string | null;
  status: string;
  statusClass: string;
  action: FormAction;
  hiddenName: string;
  hiddenValue: string;
  buttonLabel: string;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(props.action, null);
  return (
    <li className="py-2.5 text-sm flex gap-3 items-center">
      <div className="flex-1 min-w-0">
        <div className="text-slate-700 truncate">{props.label}</div>
        {props.sublabel && <div className="text-xs text-slate-400 truncate">{props.sublabel}</div>}
        {state?.error && <div className="text-xs text-red-600">{state.error}</div>}
      </div>
      <span className={`text-xs ${props.statusClass}`}>{props.status}</span>
      <form action={formAction}>
        <input type="hidden" name={props.hiddenName} value={props.hiddenValue} />
        <Button type="submit" variant="ghost" disabled={pending} className="px-2 py-1 text-xs">
          {pending ? "…" : props.buttonLabel}
        </Button>
      </form>
    </li>
  );
}
