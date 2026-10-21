/**
 * Recover a shop_owner account locked out of MFA (lost authenticator device).
 *
 * Supabase/GoTrue blocks enrolling a replacement TOTP factor while a
 * verified factor already exists and the session hasn't reached aal2 — so a
 * shop owner who can't produce a code has no self-service way back in. This
 * script force-removes their MFA factors via the service-role admin API so
 * they can sign in with just their password and re-enroll from scratch.
 *
 * Usage (dry run — lists factors, deletes nothing):
 *   npx tsx scripts/mfa-recovery.ts owner@example.com
 *
 * Usage (actually deletes):
 *   npx tsx scripts/mfa-recovery.ts owner@example.com --confirm
 */

import * as dotenv from "dotenv";
import * as path from "path";
import { createAdminClient } from "../src/lib/supabase/admin";

dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

async function findUserByEmail(
  admin: ReturnType<typeof createAdminClient>,
  email: string,
) {
  const target = email.trim().toLowerCase();
  let page = 1;
  const perPage = 200;

  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(`Failed to list users: ${error.message}`);

    const match = data.users.find((u) => u.email?.toLowerCase() === target);
    if (match) return match;

    if (data.users.length < perPage) return null;
    page += 1;
  }
}

async function main() {
  const [, , email, ...rest] = process.argv;
  const confirm = rest.includes("--confirm");

  if (!email) {
    console.error("Usage: npx tsx scripts/mfa-recovery.ts <email> [--confirm]");
    process.exit(1);
  }

  const admin = createAdminClient();

  console.log(`Looking up user "${email}"...`);
  const user = await findUserByEmail(admin, email);

  if (!user) {
    console.error(`No user found with email "${email}".`);
    process.exit(1);
  }

  const { data: profile } = await admin
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "shop_owner") {
    console.error(
      `Refusing to run: "${email}" has role "${profile?.role ?? "unknown"}", not "shop_owner". ` +
        `This script only ever touches shop_owner accounts.`,
    );
    process.exit(1);
  }

  const { data: factorsData, error: factorsError } =
    await admin.auth.admin.mfa.listFactors({ userId: user.id });

  if (factorsError) {
    console.error(`Failed to list MFA factors: ${factorsError.message}`);
    process.exit(1);
  }

  const factors = factorsData.factors;

  if (factors.length === 0) {
    console.log(`"${email}" has no MFA factors enrolled. Nothing to do.`);
    return;
  }

  console.log(`\nFound ${factors.length} MFA factor(s) for ${email} (user ${user.id}):`);
  for (const f of factors) {
    console.log(
      `  - id: ${f.id}  type: ${f.factor_type}  status: ${f.status}  name: ${f.friendly_name ?? "—"}  created_at: ${f.created_at}`,
    );
  }

  if (!confirm) {
    console.log(
      `\nDry run — pass --confirm to actually delete these ${factors.length} factor(s).`,
    );
    return;
  }

  console.log("\nDeleting...");
  for (const f of factors) {
    const { error } = await admin.auth.admin.mfa.deleteFactor({
      id: f.id,
      userId: user.id,
    });
    console.log(
      error ? `  ✗ ${f.id}: ${error.message}` : `  ✓ deleted ${f.id}`,
    );
  }

  console.log(
    `\nDone. ${email} can now sign in with just their password and will be routed through MFA setup again on next login.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
