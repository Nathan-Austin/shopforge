'use server';

import { revalidatePath } from 'next/cache';

import { LOCALES } from '@/i18n/config';
import { parseEmailBrand, TRANSACTIONAL_KINDS, type EmailBrandInput, type EmailBrandIssue } from '@/lib/email/brand';
import { saveEmailBrand as storeEmailBrand } from '@/lib/email/brandStore';
import { ensureShopOwner } from '../lib/auth';

/**
 * Saving the email brand: the logo, colours, font and footer address that
 * dress the receipt, shipping and refund emails and that new campaign
 * templates start from. The form posts plain fields; they are read into the
 * brand document here and checked with the same schema the sender trusts,
 * so nothing that would not render can be stored.
 */

interface Context {
  locale: string;
}

export type EmailBrandActionResult =
  | { ok: true }
  | { ok: false; error: 'not_authorized' | 'invalid' | 'failed'; issues?: EmailBrandIssue[]; message?: string };

function text(formData: FormData, name: string): string {
  return formData.get(name)?.toString().trim() ?? '';
}

/** The form's fields as a brand document, before validation. */
function brandFromForm(formData: FormData): EmailBrandInput {
  const footer: Record<string, string> = {};
  for (const locale of LOCALES) {
    const value = text(formData, `footer_${locale}`);
    if (value) footer[locale] = value;
  }
  const copy = {} as NonNullable<EmailBrandInput['copy']>;
  for (const kind of TRANSACTIONAL_KINDS) {
    const intro: Record<string, string> = {};
    const kindFooter: Record<string, string> = {};
    for (const locale of LOCALES) {
      const introText = text(formData, `copy_${kind}_intro_${locale}`);
      const footerText = text(formData, `copy_${kind}_footer_${locale}`);
      if (introText) intro[locale] = introText;
      if (footerText) kindFooter[locale] = footerText;
    }
    copy[kind] = { intro, footer: kindFooter };
  }
  const logoUrl = text(formData, 'logo_url');
  const logoWidth = Number.parseInt(text(formData, 'logo_width'), 10);
  return {
    brandColor: text(formData, 'brand_color').toLowerCase(),
    textColor: text(formData, 'text_color').toLowerCase(),
    backgroundColor: text(formData, 'background_color').toLowerCase(),
    contentColor: text(formData, 'content_color').toLowerCase(),
    fontFamily: text(formData, 'font_family') as EmailBrandInput['fontFamily'],
    logoUrl: logoUrl || null,
    ...(Number.isFinite(logoWidth) ? { logoWidth } : {}),
    footer,
    copy
  };
}

export async function saveEmailBrand(
  context: Context,
  _previous: EmailBrandActionResult | null,
  formData: FormData
): Promise<EmailBrandActionResult> {
  const { error, supabase, user } = await ensureShopOwner();
  if (error || !supabase) return { ok: false, error: 'not_authorized' };

  const parsed = parseEmailBrand(brandFromForm(formData));
  if (!parsed.ok) return { ok: false, error: 'invalid', issues: parsed.issues };

  const saved = await storeEmailBrand(supabase, parsed.brand, user?.id ?? null);
  if (!saved.ok) return { ok: false, error: 'failed', message: saved.message };

  revalidatePath(`/${context.locale}/admin/email/settings`);
  return { ok: true };
}
