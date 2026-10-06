CREATE TYPE "public"."content_language" AS ENUM('es', 'en');--> statement-breakpoint
DROP INDEX "exam_submissions_student_exam_idx";--> statement-breakpoint
ALTER TABLE "exam_answers" ALTER COLUMN "answer_text" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "exam_submissions" ALTER COLUMN "submitted_at" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "exam_submissions" ALTER COLUMN "submitted_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "exam_answers" ADD COLUMN "selected_option" integer;--> statement-breakpoint
ALTER TABLE "exam_answers" ADD COLUMN "feedback" text;--> statement-breakpoint
ALTER TABLE "exam_answers" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "exam_questions" ADD COLUMN "prompt_es" text;--> statement-breakpoint
ALTER TABLE "exam_questions" ADD COLUMN "prompt_en" text;--> statement-breakpoint
ALTER TABLE "exam_questions" ADD COLUMN "options_es" jsonb;--> statement-breakpoint
ALTER TABLE "exam_questions" ADD COLUMN "options_en" jsonb;--> statement-breakpoint
ALTER TABLE "exam_questions" ADD COLUMN "correct_option" integer;--> statement-breakpoint
ALTER TABLE "exam_questions" ADD COLUMN "reference_answer_es" text;--> statement-breakpoint
ALTER TABLE "exam_questions" ADD COLUMN "reference_answer_en" text;--> statement-breakpoint
ALTER TABLE "exam_submissions" ADD COLUMN "attempt_number" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "exam_submissions" ADD COLUMN "language" "content_language" NOT NULL;--> statement-breakpoint
ALTER TABLE "exam_submissions" ADD COLUMN "started_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "exams" ADD COLUMN "title_es" text;--> statement-breakpoint
ALTER TABLE "exams" ADD COLUMN "title_en" text;--> statement-breakpoint
ALTER TABLE "exams" ADD COLUMN "description_es" text;--> statement-breakpoint
ALTER TABLE "exams" ADD COLUMN "description_en" text;--> statement-breakpoint
ALTER TABLE "exams" ADD COLUMN "max_attempts" integer DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE "exams" ADD COLUMN "duration_minutes" integer DEFAULT 20 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "exam_answers_submission_question_idx" ON "exam_answers" USING btree ("submission_id","question_id");--> statement-breakpoint
CREATE INDEX "exam_answers_question_idx" ON "exam_answers" USING btree ("question_id");--> statement-breakpoint
CREATE UNIQUE INDEX "exam_submissions_student_exam_attempt_idx" ON "exam_submissions" USING btree ("student_id","exam_id","attempt_number");--> statement-breakpoint
CREATE INDEX "exam_submissions_exam_idx" ON "exam_submissions" USING btree ("exam_id");--> statement-breakpoint
CREATE INDEX "exams_course_idx" ON "exams" USING btree ("course_id");--> statement-breakpoint
ALTER TABLE "exam_questions" DROP COLUMN "prompt";--> statement-breakpoint
ALTER TABLE "exam_questions" DROP COLUMN "options_json";--> statement-breakpoint
ALTER TABLE "exam_questions" DROP COLUMN "reference_answer";--> statement-breakpoint
ALTER TABLE "exams" DROP COLUMN "title";--> statement-breakpoint
ALTER TABLE "exams" DROP COLUMN "description";--> statement-breakpoint
ALTER TABLE "exam_answers" ADD CONSTRAINT "exam_answers_one_value" CHECK (("exam_answers"."answer_text" is not null)::int + ("exam_answers"."selected_option" is not null)::int = 1);--> statement-breakpoint
ALTER TABLE "exam_answers" ADD CONSTRAINT "exam_answers_option_nonneg" CHECK ("exam_answers"."selected_option" is null or "exam_answers"."selected_option" >= 0);--> statement-breakpoint
ALTER TABLE "exam_questions" ADD CONSTRAINT "exam_questions_correct_option_nonneg" CHECK ("exam_questions"."correct_option" is null or "exam_questions"."correct_option" >= 0);--> statement-breakpoint
ALTER TABLE "exam_submissions" ADD CONSTRAINT "exam_submissions_grade_range" CHECK ("exam_submissions"."grade" is null or "exam_submissions"."grade" between 0 and 100);--> statement-breakpoint
ALTER TABLE "exams" ADD CONSTRAINT "exams_max_attempts_range" CHECK ("exams"."max_attempts" between 1 and 10);--> statement-breakpoint
ALTER TABLE "exams" ADD CONSTRAINT "exams_duration_range" CHECK ("exams"."duration_minutes" between 1 and 480);