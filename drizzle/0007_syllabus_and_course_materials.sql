CREATE TYPE "public"."material_kind" AS ENUM('file', 'link');--> statement-breakpoint
CREATE TABLE "course_materials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_id" uuid NOT NULL,
	"kind" "material_kind" NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"storage_path" text,
	"mime_type" text,
	"url" text,
	"order" integer DEFAULT 0 NOT NULL,
	"uploaded_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "course_materials" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "syllabus_storage_path" text;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "syllabus_uploaded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "course_materials" ADD CONSTRAINT "course_materials_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "course_materials_course_order_idx" ON "course_materials" USING btree ("course_id","order");--> statement-breakpoint

-- Private bucket for syllabus PDFs and course material files, separate from
-- `lectures` (which stays video-only/progress-tracked). Same deny-all model:
-- public = false and NO storage.objects policies, so anon/authenticated
-- can't read, list, or write anything in it directly. All access goes
-- through the server (lib/storage), which issues short-lived signed
-- upload/download URLs after checking ownership/enrollment.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'course-files',
  'course-files',
  false,
  2147483648,
  ARRAY[
    'application/pdf',
    'image/png', 'image/jpeg', 'image/webp', 'image/gif',
    'video/mp4', 'video/webm', 'video/quicktime',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  ]
)
ON CONFLICT (id) DO UPDATE
SET public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;