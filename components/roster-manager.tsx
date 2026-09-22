"use client";

import { useActionState } from "react";
import type { ActionState } from "@/lib/validation/form";
import type { Roster } from "@/lib/data/enrollments";
import { Field } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { SubmitButton } from "@/components/ui/submit-button";
import { Button } from "@/components/ui/button";
import { DataList, DataRow, DataRowActions, DataRowMain } from "@/components/ui/data-list";

type FormAction = (prev: ActionState, formData: FormData) => Promise<ActionState>;

type Props = {
  roster: Roster;
  /** Server actions already bound to the course id by the page. */
  invite: FormAction;
  remove: FormAction;
  revoke: FormAction;
};

/**
 * Roster: invite by email + enrolled/invited students with remove buttons.
 * Contract: field names `email`, `studentId`, `invitationId` match the
 * schemas in lib/validation/enrollments.ts. Each row is its own form so the
 * buttons work without client JS.
 */
export function RosterManager({ roster, invite, remove, revoke }: Props) {
  const [state, inviteAction] = useActionState<ActionState, FormData>(invite, null);
  const empty = roster.enrolled.length === 0 && roster.invited.length === 0;

  return (
    <div className="space-y-6">
      <form action={inviteAction} className="space-y-3" noValidate>
        {state?.error && <Alert tone="error">{state.error}</Alert>}
        {state?.success && <Alert tone="success">{state.success}</Alert>}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
          <div className="flex-1">
            <Field
              label="Invite a student by email"
              name="email"
              type="email"
              autoComplete="off"
              inputMode="email"
              placeholder="student@example.com"
              required
              defaultValue={state?.error ? state.values?.email : ""}
              errors={state?.fieldErrors?.email}
              hint="They're enrolled right away if they have an account, or as soon as they create one."
            />
          </div>
          <div className="sm:pt-7">
            <SubmitButton pendingLabel="Inviting…" fullWidth={false} className="w-full sm:w-auto">
              Invite
            </SubmitButton>
          </div>
        </div>
      </form>

      {empty ? (
        <p className="text-sm text-muted">No students yet. Invite the first one above.</p>
      ) : (
        <DataList>
          {roster.enrolled.map((s) => (
            <RosterRow
              key={s.studentId}
              label={s.name ?? s.email ?? "Student"}
              sublabel={s.name && s.email ? s.email : null}
              status={<Badge tone="success">Enrolled</Badge>}
              action={remove}
              hiddenName="studentId"
              hiddenValue={s.studentId}
              buttonLabel="Remove"
              confirmText={`Remove ${s.name ?? s.email ?? "this student"} from the course?`}
            />
          ))}
          {roster.invited.map((inv) => (
            <RosterRow
              key={inv.id}
              label={inv.email}
              sublabel={null}
              status={<Badge tone="outline">Invited</Badge>}
              action={revoke}
              hiddenName="invitationId"
              hiddenValue={inv.id}
              buttonLabel="Withdraw"
              confirmText={`Withdraw the invitation for ${inv.email}?`}
            />
          ))}
        </DataList>
      )}
    </div>
  );
}

function RosterRow(props: {
  label: string;
  sublabel: string | null;
  status: React.ReactNode;
  action: FormAction;
  hiddenName: string;
  hiddenValue: string;
  buttonLabel: string;
  confirmText: string;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(props.action, null);
  return (
    <DataRow className="flex-wrap sm:flex-nowrap">
      <DataRowMain
        title={props.label}
        meta={
          <>
            {props.sublabel && <span className="truncate">{props.sublabel}</span>}
            {state?.error && <span className="text-error">{state.error}</span>}
          </>
        }
      />
      <div className="hidden sm:block">{props.status}</div>
      <DataRowActions>
        <form
          action={formAction}
          onSubmit={(e) => {
            if (!window.confirm(props.confirmText)) e.preventDefault();
          }}
        >
          <input type="hidden" name={props.hiddenName} value={props.hiddenValue} />
          <Button type="submit" variant="ghost" size="sm" disabled={pending} aria-busy={pending}>
            {pending ? "…" : props.buttonLabel}
          </Button>
        </form>
      </DataRowActions>
      <div className="basis-full sm:hidden">{props.status}</div>
    </DataRow>
  );
}
