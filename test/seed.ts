import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

// Dev-only accounts for integration tests. Created directly in auth.users
// (the 0003 trigger then creates public.users) with fixed ids so runs are
// idempotent. Emails use the reserved example.test domain, so they can
// never collide with a real person. Never run against production.

export const SEED = {
  profA: { id: "a0000000-0000-4000-8000-000000000001", email: "prof-a@example.test", role: "professor" },
  profB: { id: "a0000000-0000-4000-8000-000000000002", email: "prof-b@example.test", role: "professor" },
  admin: { id: "a0000000-0000-4000-8000-000000000003", email: "admin@example.test", role: "admin" },
  student: { id: "a0000000-0000-4000-8000-000000000011", email: "student-1@example.test", role: "student" },
  student2: { id: "a0000000-0000-4000-8000-000000000012", email: "student-2@example.test", role: "student" },
} as const;

export type SeedUser = (typeof SEED)[keyof typeof SEED];

export async function createAuthUser(u: { id: string; email: string; role: string; fullName?: string }) {
  await db.execute(sql`
    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change, email_change_token_new, email_change_token_current
    ) VALUES (
      '00000000-0000-0000-0000-000000000000', ${u.id}::uuid, 'authenticated', 'authenticated',
      ${u.email}, crypt('integration-test-password', gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('full_name', ${u.fullName ?? u.email.split("@")[0]}::text),
      now(), now(), '', '', '', '', ''
    )
    ON CONFLICT (id) DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO auth.identities (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    VALUES (gen_random_uuid(), ${u.id}, ${u.id}::uuid,
      jsonb_build_object('sub', ${u.id}::text, 'email', ${u.email}::text), 'email', now(), now(), now())
    ON CONFLICT (provider_id, provider) DO NOTHING
  `);
  // The 0003 trigger created public.users with role 'student'; promote.
  await db.execute(sql`UPDATE public.users SET role = ${u.role}::user_role WHERE id = ${u.id}::uuid`);
}

export async function deleteAuthUser(id: string) {
  // public.users has no FK to auth.users (trigger-maintained), so remove both.
  await db.execute(sql`DELETE FROM public.users WHERE id = ${id}::uuid`);
  await db.execute(sql`DELETE FROM auth.users WHERE id = ${id}::uuid`);
}

export async function seedUsers() {
  for (const u of Object.values(SEED)) await createAuthUser(u);
}

/** Remove everything the seeded users own so each run starts clean. */
export async function resetSeedData() {
  const ids = Object.values(SEED).map((u) => u.id);
  await db.execute(sql`DELETE FROM public.courses WHERE professor_id IN ${ids}`);
  await db.execute(sql`DELETE FROM public.course_invitations WHERE email LIKE '%@example.test'`);
  await db.execute(sql`DELETE FROM public.rate_limit_buckets WHERE key LIKE 'invite:%' OR key LIKE 'lecture_progress:%'`);
}
