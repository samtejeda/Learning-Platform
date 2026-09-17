-- Keep public.users in lockstep with auth.users, and mirror the role into
-- the JWT so the proxy can gate by path prefix without a DB round-trip.
--
-- Three triggers:
--   1. auth.users INSERT            -> create the public.users profile row
--   2. auth.users UPDATE email/phone -> mirror confirmed contact changes
--   3. public.users INSERT/UPDATE role -> write role into auth.users.raw_app_meta_data
--
-- All functions are SECURITY DEFINER (they run as the migration owner,
-- `postgres`, which owns public.users and may update auth.users), pin
-- search_path to '' so every reference is schema-qualified, and have
-- EXECUTE revoked from PUBLIC/anon/authenticated so they can only fire
-- from their triggers.
--
-- `raw_user_meta_data` is client-settable, so full_name is length-capped;
-- `raw_app_meta_data` is server-only, which is why the role lives there.

-- 1. New auth user -> profile row (default role: student)
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.users (id, email, phone, full_name, role)
  VALUES (
    NEW.id,
    NULLIF(NEW.email, ''),
    NULLIF(NEW.phone, ''),
    LEFT(NULLIF(NEW.raw_user_meta_data ->> 'full_name', ''), 100),
    'student'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION public.handle_new_auth_user() FROM PUBLIC, anon, authenticated;--> statement-breakpoint

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;--> statement-breakpoint

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();--> statement-breakpoint

-- 2. Confirmed email/phone changes -> mirror into the profile row
CREATE OR REPLACE FUNCTION public.sync_auth_user_contact()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.users
  SET email = NULLIF(NEW.email, ''),
      phone = NULLIF(NEW.phone, ''),
      updated_at = now()
  WHERE id = NEW.id;
  RETURN NEW;
END;
$$;--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION public.sync_auth_user_contact() FROM PUBLIC, anon, authenticated;--> statement-breakpoint

DROP TRIGGER IF EXISTS on_auth_user_contact_updated ON auth.users;--> statement-breakpoint

CREATE TRIGGER on_auth_user_contact_updated
  AFTER UPDATE OF email, phone ON auth.users
  FOR EACH ROW
  WHEN (OLD.email IS DISTINCT FROM NEW.email OR OLD.phone IS DISTINCT FROM NEW.phone)
  EXECUTE FUNCTION public.sync_auth_user_contact();--> statement-breakpoint

-- 3. Role -> JWT app_metadata claim (takes effect on the next token refresh)
CREATE OR REPLACE FUNCTION public.sync_user_role_claim()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE auth.users
  SET raw_app_meta_data =
        COALESCE(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('role', NEW.role::text)
  WHERE id = NEW.id;
  RETURN NEW;
END;
$$;--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION public.sync_user_role_claim() FROM PUBLIC, anon, authenticated;--> statement-breakpoint

DROP TRIGGER IF EXISTS on_public_user_role_changed ON public.users;--> statement-breakpoint

CREATE TRIGGER on_public_user_role_changed
  AFTER INSERT OR UPDATE OF role ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.sync_user_role_claim();--> statement-breakpoint

-- Backfill: any auth users created before these triggers existed get a
-- profile row (student) and a role claim. Idempotent.
INSERT INTO public.users (id, email, phone, full_name, role)
SELECT
  u.id,
  NULLIF(u.email, ''),
  NULLIF(u.phone, ''),
  LEFT(NULLIF(u.raw_user_meta_data ->> 'full_name', ''), 100),
  'student'
FROM auth.users u
ON CONFLICT (id) DO NOTHING;--> statement-breakpoint

UPDATE auth.users a
SET raw_app_meta_data =
      COALESCE(a.raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('role', p.role::text)
FROM public.users p
WHERE p.id = a.id
  AND COALESCE(a.raw_app_meta_data ->> 'role', '') IS DISTINCT FROM p.role::text;
