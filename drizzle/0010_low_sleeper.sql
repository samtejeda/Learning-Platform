CREATE TABLE "lecture_comprehension_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"lecture_id" uuid NOT NULL,
	"attempt_number" integer NOT NULL,
	"question_slot" integer NOT NULL,
	"correct" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lecture_comprehension_attempts_attempt_range" CHECK ("lecture_comprehension_attempts"."attempt_number" between 1 and 2),
	CONSTRAINT "lecture_comprehension_attempts_slot_range" CHECK ("lecture_comprehension_attempts"."question_slot" between 1 and 2)
);
--> statement-breakpoint
ALTER TABLE "lecture_comprehension_attempts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "lecture_comprehension_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lecture_id" uuid NOT NULL,
	"slot" integer NOT NULL,
	"prompt_es" text,
	"prompt_en" text,
	"options_es" jsonb,
	"options_en" jsonb,
	"correct_option" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lecture_comprehension_questions_slot_range" CHECK ("lecture_comprehension_questions"."slot" between 1 and 2),
	CONSTRAINT "lecture_comprehension_questions_correct_option_range" CHECK ("lecture_comprehension_questions"."correct_option" is null or "lecture_comprehension_questions"."correct_option" between 0 and 5)
);
--> statement-breakpoint
ALTER TABLE "lecture_comprehension_questions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "lectures" ADD COLUMN "comprehension_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "lecture_comprehension_attempts" ADD CONSTRAINT "lecture_comprehension_attempts_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lecture_comprehension_attempts" ADD CONSTRAINT "lecture_comprehension_attempts_lecture_id_lectures_id_fk" FOREIGN KEY ("lecture_id") REFERENCES "public"."lectures"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lecture_comprehension_questions" ADD CONSTRAINT "lecture_comprehension_questions_lecture_id_lectures_id_fk" FOREIGN KEY ("lecture_id") REFERENCES "public"."lectures"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "lecture_comprehension_attempts_student_lecture_attempt_idx" ON "lecture_comprehension_attempts" USING btree ("student_id","lecture_id","attempt_number");--> statement-breakpoint
CREATE INDEX "lecture_comprehension_attempts_lecture_idx" ON "lecture_comprehension_attempts" USING btree ("lecture_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lecture_comprehension_questions_lecture_slot_idx" ON "lecture_comprehension_questions" USING btree ("lecture_id","slot");