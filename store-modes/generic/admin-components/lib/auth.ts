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

/**
 * Pages: who is this, verified. getClaims() checks the JWT's signature
 * (against the project's public keys, cached, so no round trip on
 * asymmetric-key projects) instead of trusting whatever the cookie says,
 * which is what Supabase warns getSession() does on the server.
 */
export async function requireShopOwner(locale: string) {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims.sub;

  if (!userId) {
    redirect(`/${locale}/auth/sign-in`);
  }

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .single();

  if (error || profile?.role !== 'shop_owner') {
    redirect(`/${locale}`);
  }

  if (!(await hasSecondFactor(supabase))) {
    redirect(`/${locale}/auth/mfa`);
  }

  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(`/${locale}/auth/sign-in`);
  }

  return { supabase, user };
}

/**
 * Server actions (writes): getUser() asks the Auth server, so a revoked
 * session is caught even if its token has not expired yet.
 */
export async function ensureShopOwner() {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: 'UNAUTHENTICATED' as const, supabase: null, user: null };
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  if (profile?.role !== 'shop_owner') {
    return { error: 'FORBIDDEN' as const, supabase: null, user: null };
  }

  // Server actions are callable without visiting a page, so they check the
  // second factor too; otherwise a password alone could edit the catalogue.
  if (!(await hasSecondFactor(supabase))) {
    return { error: 'MFA_REQUIRED' as const, supabase: null, user: null };
  }

  return { error: null, supabase, user };
}
