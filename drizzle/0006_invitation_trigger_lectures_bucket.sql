-- 1. Invitation → enrollment activation.
--
-- A professor invites a student by email (course_invitations). When an
-- account with that email exists, app code enrolls immediately; when it
-- doesn't, this trigger does it the moment public.users gains a matching
-- email (creation via the auth trigger in 0003, or a later confirmed email
-- change). Same conventions as 0003: SECURITY DEFINER, pinned search_path,
-- EXECUTE revoked so it can only fire from its trigger.

CREATE OR REPLACE FUNCTION public.activate_course_invitations()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.email IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.enrollments (student_id, course_id)
  SELECT NEW.id, i.course_id
  FROM public.course_invitations i
  WHERE i.email = lower(NEW.email)
    AND i.accepted_at IS NULL
  ON CONFLICT (student_id, course_id) DO NOTHING;

  UPDATE public.course_invitations
  SET accepted_at = now()
  WHERE email = lower(NEW.email)
    AND accepted_at IS NULL;

  RETURN NEW;
END;
$$;--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION public.activate_course_invitations() FROM PUBLIC, anon, authenticated;--> statement-breakpoint

DROP TRIGGER IF EXISTS on_public_user_email_set ON public.users;--> statement-breakpoint

CREATE TRIGGER on_public_user_email_set
  AFTER INSERT OR UPDATE OF email ON public.users
  FOR EACH ROW
  WHEN (NEW.email IS NOT NULL)
  EXECUTE FUNCTION public.activate_course_invitations();--> statement-breakpoint

-- 2. Private bucket for lecture videos.
--
-- public = false and NO storage.objects policies: anon/authenticated can't
-- read, list, or write anything in it. All access goes through the server
-- (lib/storage), which issues short-lived signed upload/download URLs after
-- checking ownership/enrollment. The size cap (2 GiB) is a ceiling; the
-- project's plan-level object limit still applies (50 MB on the free tier).

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'lectures',
  'lectures',
  false,
  2147483648,
  ARRAY['video/mp4', 'video/webm', 'video/quicktime']
)
ON CONFLICT (id) DO UPDATE
SET public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;
