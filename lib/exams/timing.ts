// Pure attempt-timing rules. The deadline is enforced on the server only;
// any countdown in the browser is cosmetic.

/** Network-lag allowance on a final submit (the autosaved answers are what
 * count either way). */
export const SUBMIT_GRACE_SECONDS = 30;

export function attemptDeadline(startedAt: Date, durationMinutes: number): Date {
  return new Date(startedAt.getTime() + durationMinutes * 60_000);
}

/** True once the attempt can no longer be edited or submitted by the student. */
export function isPastGrace(now: Date, startedAt: Date, durationMinutes: number): boolean {
  return now.getTime() > attemptDeadline(startedAt, durationMinutes).getTime() + SUBMIT_GRACE_SECONDS * 1000;
}

/** True once the deadline itself has passed (autosave stops being accepted). */
export function isPastDeadline(now: Date, startedAt: Date, durationMinutes: number): boolean {
  return now.getTime() > attemptDeadline(startedAt, durationMinutes).getTime();
}

/**
 * submittedAt to record when closing an attempt: the real time if the
 * student submitted in time, otherwise the deadline (lazy close of an
 * abandoned/expired attempt — there is no cron).
 */
export function closeTimeFor(now: Date, startedAt: Date, durationMinutes: number): Date {
  const deadline = attemptDeadline(startedAt, durationMinutes);
  return now.getTime() > deadline.getTime() ? deadline : now;
}
