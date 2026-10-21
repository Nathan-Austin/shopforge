import { Resend } from "resend";

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const AUDIENCE_ID = process.env.RESEND_AUDIENCE_ID;

/**
 * Mirrors a mailing_list row into the Resend audience used for broadcasts.
 * Resend's contact create endpoint upserts by email, so this is safe to
 * call on every subscribe/unsubscribe — no separate update path needed.
 */
export async function upsertResendContact({
  email,
  firstName,
  lastName,
  unsubscribed = false,
}: {
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  unsubscribed?: boolean;
}) {
  if (!resend || !AUDIENCE_ID) {
    console.warn("[ResendContacts] Not configured (RESEND_API_KEY or RESEND_AUDIENCE_ID missing)");
    return { success: false as const };
  }

  const { error } = await resend.contacts.create({
    email: email.toLowerCase(),
    firstName: firstName || undefined,
    lastName: lastName || undefined,
    unsubscribed,
    segments: [{ id: AUDIENCE_ID }],
  });

  if (error) {
    console.error("[ResendContacts] Upsert failed:", error);
    return { success: false as const, error };
  }

  return { success: true as const };
}
