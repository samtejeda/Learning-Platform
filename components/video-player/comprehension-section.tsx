import { getComprehensionForStudent, getOwnedComprehension } from "@/lib/data/lecture-comprehension";
import type { CurrentUser } from "@/lib/auth/session";
import { Alert } from "@/components/ui/alert";
import { TextLink } from "@/components/ui/text-link";
import { ComprehensionPreview } from "./comprehension-preview";
import { ComprehensionQuestion } from "./comprehension-question";

/**
 * The lecture page's comprehension slot, kept out of the page so the page (and
 * the player) stay small. Server component:
 *  - student (progress is tracked): the card, only once the SERVER says the
 *    lecture is completed and the question is on; otherwise nothing.
 *  - instructor preview: a read-only card (or a one-line note when the question
 *    is off). Only prompts and options cross to the client, never the key, and
 *    the check route is never called.
 */
export async function ComprehensionSection({
  lectureId,
  user,
  tracksProgress,
}: {
  lectureId: string;
  user: CurrentUser;
  tracksProgress: boolean;
}) {
  if (tracksProgress) {
    const c = await getComprehensionForStudent(lectureId, user.id);
    if (!c || !c.lectureCompleted) return null;
    const asking = c.status === "open" || c.status === "retry";
    if (asking && !c.question) return null;
    return (
      <ComprehensionQuestion
        // Remount when the server's view changes (e.g. after router.refresh()).
        key={`${c.status}-${c.attemptsUsed}`}
        lectureId={lectureId}
        initial={{ status: c.status, attemptsRemaining: c.attemptsRemaining, question: c.question }}
      />
    );
  }

  const owned = await getOwnedComprehension(lectureId, user);
  if (!owned) return null;
  if (!owned.enabled) {
    return (
      <Alert tone="info">
        The quick check question is off for this lecture, so students aren&apos;t asked one.{" "}
        <TextLink href={`/professor/lectures/${lectureId}/edit`}>Set it up</TextLink>
      </Alert>
    );
  }
  const questions = owned.questions.map((q) => ({
    slot: (q.slot === 2 ? 2 : 1) as 1 | 2,
    es: { prompt: q.promptEs ?? "", options: q.optionsEs },
    en: { prompt: q.promptEn ?? "", options: q.optionsEn },
  }));
  return (
    <ComprehensionPreview
      heading="Quick check (instructor preview)"
      intro="Read-only. Students see this below the video once they finish the lecture."
      questions={questions}
    />
  );
}
