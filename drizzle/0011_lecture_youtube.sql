CREATE TYPE "public"."video_source" AS ENUM('upload', 'youtube');--> statement-breakpoint
ALTER TABLE "lectures" ALTER COLUMN "video_storage_path" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "lectures" ADD COLUMN "video_source" "video_source" DEFAULT 'upload' NOT NULL;--> statement-breakpoint
ALTER TABLE "lectures" ADD COLUMN "youtube_video_id" text;--> statement-breakpoint
ALTER TABLE "lectures" ADD CONSTRAINT "lectures_video_source_check" CHECK ((
        "lectures"."video_source" = 'upload'
        AND "lectures"."youtube_video_id" IS NULL
        AND "lectures"."video_storage_path" IS NOT NULL
      ) OR (
        "lectures"."video_source" = 'youtube'
        AND "lectures"."youtube_video_id" IS NOT NULL
        AND "lectures"."youtube_video_id" ~ '^[A-Za-z0-9_-]{11}$'
        AND "lectures"."video_storage_path" IS NULL
        AND "lectures"."duration_seconds" IS NOT NULL
        AND "lectures"."duration_seconds" >= 1
        AND "lectures"."video_uploaded_at" IS NOT NULL
      ));