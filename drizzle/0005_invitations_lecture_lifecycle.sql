CREATE TABLE "course_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_id" uuid NOT NULL,
	"email" text NOT NULL,
	"invited_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accepted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "course_invitations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "lecture_progress" ADD COLUMN "watched_intervals" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "lecture_progress" ADD COLUMN "last_position_seconds" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "lecture_progress" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "lectures" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "lectures" ADD COLUMN "duration_seconds" real;--> statement-breakpoint
ALTER TABLE "lectures" ADD COLUMN "video_uploaded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "lectures" ADD COLUMN "published_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "course_invitations" ADD CONSTRAINT "course_invitations_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_invitations" ADD CONSTRAINT "course_invitations_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "course_invitations_course_email_idx" ON "course_invitations" USING btree ("course_id","email");--> statement-breakpoint
CREATE INDEX "course_invitations_email_idx" ON "course_invitations" USING btree ("email");