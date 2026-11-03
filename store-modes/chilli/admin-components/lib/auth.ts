import { redirect } from 'next/navigation';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { AUTH_CONFIG } from '@/lib/auth/config';

/**
 * Whether this session has passed the second factor. With admin MFA off
 * every session counts; otherwise Supabase must report AAL2, which it
 * only does after a successful authenticator code in this session.
 */
async function hasSecondFactor(supabase: SupabaseClient): Promise<boolean> {
  if (AUTH_CONFIG.adminMfa !== 'required') return true;
  const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  return data?.currentLevel === 'aal2';
}

export async function requireShopOwner(locale: string) {
  const supabase = await createClient();
  const {
    data: { session }
  } = await supabase.auth.getSession();

  if (!session) {
    redirect(`/${locale}/auth/sign-in`);
  }

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', session.user.id)
    .single();

  if (error || profile?.role !== 'shop_owner') {
    redirect(`/${locale}`);
  }

  if (!(await hasSecondFactor(supabase))) {
    redirect(`/${locale}/auth/mfa`);
  }

  return { supabase, user: session.user };
}

export async function ensureShopOwner() {
  const supabase = await createClient();
  const {
    data: { session }
  } = await supabase.auth.getSession();

  if (!session) {
    return { error: 'UNAUTHENTICATED' as const, supabase: null, user: null };
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', session.user.id)
    .single();

  if (profile?.role !== 'shop_owner') {
    return { error: 'FORBIDDEN' as const, supabase: null, user: null };
  }

  // Server actions are callable without visiting a page, so they check the
  // second factor too; otherwise a password alone could edit the catalogue.
  if (!(await hasSecondFactor(supabase))) {
    return { error: 'MFA_REQUIRED' as const, supabase: null, user: null };
  }

  return { error: null, supabase, user: session.user };
}
