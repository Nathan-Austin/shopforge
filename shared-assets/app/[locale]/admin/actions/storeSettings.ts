'use server';

import { revalidatePath } from 'next/cache';

import type { SettingIssue } from '@/lib/settings/schema';
import { saveStoreSetting } from '@/lib/settings/store';
import { ensureShopOwner } from '../lib/auth';

/**
 * Saving the sections of /admin/settings. One action per section, each a
 * thin wrapper: the form's fields in, the shared schema decides, and
 * saveStoreSetting() writes the row and expires the cached copy.
 */

interface Context {
  locale: string;
}

export type StoreSettingsActionResult =
  | { ok: true }
  | { ok: false; error: 'not_authorized' | 'invalid' | 'failed'; issues?: SettingIssue[]; message?: string };

export async function saveShopSettings(
  context: Context,
  _previous: StoreSettingsActionResult | null,
  formData: FormData
): Promise<StoreSettingsActionResult> {
  const { error, supabase, user } = await ensureShopOwner();
  if (error || !supabase) return { ok: false, error: 'not_authorized' };

  const saved = await saveStoreSetting(
    supabase,
    'shop',
    {
      name: formData.get('name')?.toString() ?? '',
      brands: formData.get('brands')?.toString() ?? ''
    },
    user?.id ?? null
  );
  if (!saved.ok) {
    return saved.error === 'invalid'
      ? { ok: false, error: 'invalid', issues: saved.issues }
      : { ok: false, error: 'failed', message: saved.message };
  }

  // A single-brand shop with no brands at all gets one named after the
  // shop, so a product saved without a brand still lands on something
  // presentable. The generated single shop ships this row as a seed; a
  // shop switched to single at runtime gets it here. Existing brands are
  // never touched, and failing to add it never fails the save.
  if (saved.value.brands === 'single') {
    const { count, error: countError } = await supabase.from('brands').select('id', { count: 'exact', head: true });
    if (!countError && count === 0) {
      const { error: brandError } = await supabase.from('brands').insert({ name: saved.value.name, slug: 'house-brand' });
      if (brandError) console.error('Could not create the house brand:', brandError.message);
    }
  }

  // The name is in the header and every page title, in every language.
  revalidatePath('/', 'layout');
  revalidatePath(`/${context.locale}/admin/settings`);
  return { ok: true };
}

export async function saveCheckoutSettings(
  context: Context,
  _previous: StoreSettingsActionResult | null,
  formData: FormData
): Promise<StoreSettingsActionResult> {
  const { error, supabase, user } = await ensureShopOwner();
  if (error || !supabase) return { ok: false, error: 'not_authorized' };

  const saved = await saveStoreSetting(
    supabase,
    'checkout',
    {
      shippingAddress: formData.get('shippingAddress')?.toString() ?? '',
      // Unticked boxes send nothing, so an empty list means "none picked"
      // and the schema refuses it.
      allowedCountries: formData.getAll('countries').map((value) => value.toString())
    },
    user?.id ?? null
  );
  if (!saved.ok) {
    return saved.error === 'invalid'
      ? { ok: false, error: 'invalid', issues: saved.issues }
      : { ok: false, error: 'failed', message: saved.message };
  }

  // The checkout page and the delivery countries in every page's
  // structured data.
  revalidatePath('/', 'layout');
  revalidatePath(`/${context.locale}/admin/settings`);
  return { ok: true };
}
