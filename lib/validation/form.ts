import { z } from "zod";

/**
 * The shape every form server action returns. Conventions:
 *  - Signature: (prev: ActionState, formData: FormData) => Promise<ActionState>
 *  - Expected failures RETURN { error, fieldErrors }; they never throw.
 *  - redirect() only on success, and never inside a try/catch (it throws).
 *  - `values` echoes back the submitted (non-secret) fields so the form can
 *    keep them populated after a failed submit.
 */
export type ActionState = {
  error?: string;
  fieldErrors?: Record<string, string[]>;
  success?: string;
  values?: Record<string, string>;
} | null;

export type ParseResult<T> =
  | { ok: true; data: T }
  | { ok: false; state: NonNullable<ActionState> };

/** Fields never echoed back to the client. */
const SECRET_FIELDS = new Set(["password", "confirmPassword", "token"]);

/**
 * Validate a FormData against a zod schema. On failure returns an
 * ActionState with a per-field error map and the safe submitted values.
 */
export function parseFormData<S extends z.ZodType>(
  schema: S,
  formData: FormData,
): ParseResult<z.output<S>> {
  const raw: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string") raw[key] = value;
  }
  return parseObject(schema, raw);
}

/** Same as parseFormData but for a plain object (non-form actions). */
export function parseObject<S extends z.ZodType>(
  schema: S,
  raw: Record<string, unknown>,
): ParseResult<z.output<S>> {
  const result = schema.safeParse(raw);
  if (result.success) return { ok: true, data: result.data };

  const fieldErrors: Record<string, string[]> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.length ? String(issue.path[0]) : "_form";
    (fieldErrors[key] ??= []).push(issue.message);
  }
  const values: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string" && !SECRET_FIELDS.has(key)) values[key] = value;
  }
  const first = Object.values(fieldErrors)[0]?.[0];
  return {
    ok: false,
    state: { error: first ?? "Please check the form and try again.", fieldErrors, values },
  };
}
