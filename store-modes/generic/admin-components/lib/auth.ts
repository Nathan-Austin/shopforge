import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

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

  return { error: null, supabase, user: session.user };
}
