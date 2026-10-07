ALTER TABLE "exam_answers" DROP CONSTRAINT "exam_answers_one_value";--> statement-breakpoint
ALTER TABLE "exam_answers" ADD COLUMN "blank_answers" jsonb;--> statement-breakpoint
ALTER TABLE "exam_answers" ADD COLUMN "points_awarded" real;--> statement-breakpoint
ALTER TABLE "exam_questions" ADD COLUMN "points" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "exams" ADD COLUMN "reveal_keys_after_attempts" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "exam_answers" ADD CONSTRAINT "exam_answers_points_nonneg" CHECK ("exam_answers"."points_awarded" is null or "exam_answers"."points_awarded" >= 0);--> statement-breakpoint
ALTER TABLE "exam_answers" ADD CONSTRAINT "exam_answers_one_value" CHECK (("exam_answers"."answer_text" is not null)::int + ("exam_answers"."selected_option" is not null)::int + ("exam_answers"."blank_answers" is not null)::int = 1);--> statement-breakpoint
ALTER TABLE "exam_questions" ADD CONSTRAINT "exam_questions_points_range" CHECK ("exam_questions"."points" between 1 and 100);