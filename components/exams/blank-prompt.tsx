import { splitOnBlanks } from "@/lib/exams/blanks";

/**
 * A submitted fill-in-the-blank prompt, read-only: the text with each
 * answer shown in its blank (or an empty box). Used on the student's result
 * and the professor's grading page, so the storage token is never shown.
 */
export function BlankPrompt({ prompt, answers }: { prompt: string | null; answers: string[] | null }) {
  const parts = splitOnBlanks(prompt);
  return (
    <p className="whitespace-pre-line text-base font-medium leading-9 text-ink">
      {parts.map((text, n) => (
        <span key={n}>
          {text}
          {n < parts.length - 1 && (
            <span className="mx-1 inline-block min-h-8 min-w-24 max-w-full rounded-md border border-hairline bg-surface-soft px-2.5 py-0.5 align-middle text-[15px] font-medium break-words">
              <span className="sr-only">Blank {n + 1}: </span>
              {answers?.[n]?.trim() ? answers[n] : <span className="text-muted">(empty)</span>}
            </span>
          )}
        </span>
      ))}
    </p>
  );
}
