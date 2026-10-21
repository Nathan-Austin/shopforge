import { Resend } from "resend";

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

/** Sender for all outgoing email, e.g. "My Shop <hello@myshop.com>". */
export const EMAIL_FROM = process.env.EMAIL_FROM || "Your Store <hello@example.com>";

export async function sendEmail({
  to,
  subject,
  html,
}: {
  to: string | string[];
  subject: string;
  html: string;
}) {
  if (!resend) {
    console.error("[Emails] Resend is not configured (RESEND_API_KEY missing)");
    return { success: false, error: "Not configured" };
  }

  try {
    const data = await resend.emails.send({
      from: EMAIL_FROM,
      to,
      subject,
      html,
    });

    return { success: true, data };
  } catch (error) {
    console.error("[Emails] Failed to send email:", error);
    return { success: false, error };
  }
}

export const SELLER_EMAIL = process.env.SELLER_EMAIL || "hello@example.com";
