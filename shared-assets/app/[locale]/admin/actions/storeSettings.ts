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

  const saved = await saveStoreSetting(supabase, 'shop', { name: formData.get('name')?.toString() ?? '' }, user?.id ?? null);
  if (!saved.ok) {
    return saved.error === 'invalid'
      ? { ok: false, error: 'invalid', issues: saved.issues }
      : { ok: false, error: 'failed', message: saved.message };
  }

  // The name is in the header and every page title, in every language.
  revalidatePath('/', 'layout');
  revalidatePath(`/${context.locale}/admin/settings`);
  return { ok: true };
}
