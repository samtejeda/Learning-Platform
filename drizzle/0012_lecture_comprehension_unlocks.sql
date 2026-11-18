CREATE TABLE "lecture_comprehension_unlocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lecture_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"unlocked_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lecture_comprehension_unlocks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "lecture_comprehension_unlocks" ADD CONSTRAINT "lecture_comprehension_unlocks_lecture_id_lectures_id_fk" FOREIGN KEY ("lecture_id") REFERENCES "public"."lectures"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lecture_comprehension_unlocks" ADD CONSTRAINT "lecture_comprehension_unlocks_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lecture_comprehension_unlocks" ADD CONSTRAINT "lecture_comprehension_unlocks_unlocked_by_users_id_fk" FOREIGN KEY ("unlocked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "lecture_comprehension_unlocks_lecture_student_idx" ON "lecture_comprehension_unlocks" USING btree ("lecture_id","student_id");--> statement-breakpoint
CREATE INDEX "lecture_comprehension_unlocks_student_idx" ON "lecture_comprehension_unlocks" USING btree ("student_id");