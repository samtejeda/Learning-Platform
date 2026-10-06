// Content language for bilingual (Spanish/English) academy content. Pure.

export const CONTENT_LANGUAGES = ["es", "en"] as const;
export type ContentLanguage = (typeof CONTENT_LANGUAGES)[number];

/**
 * Deployment default until the student-level language setting exists
 * (PROGRESS.md "bilingual content model", decision 3). That setting will
 * replace this as the *default* for the language picker; a started attempt's
 * stored language is always authoritative and is never rewritten by it.
 */
export const DEFAULT_CONTENT_LANGUAGE: ContentLanguage = "es";

/** True/false is keyed by position (0 = true, 1 = false), so only the
 * display words differ per language. Interface labels, not exam content. */
export const TRUE_FALSE_LABELS: Record<ContentLanguage, readonly [string, string]> = {
  es: ["Verdadero", "Falso"],
  en: ["True", "False"],
};

export function isContentLanguage(v: unknown): v is ContentLanguage {
  return v === "es" || v === "en";
}

/** jsonb option lists come back as `unknown`; keep only a clean string[]. */
export function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}
