import { Suspense } from 'react';

import SignUpForm from '@/components/auth/SignUpForm';
import { getAuthSettings } from '@/lib/settings/store';

// Read on every request, not baked in: the owner can change how customers
// sign in at /admin/settings.
export const dynamic = 'force-dynamic';

export default async function SignUpPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const { customerSignIn } = await getAuthSettings();

  // useSearchParams needs a Suspense boundary above it.
  return (
    <Suspense fallback={null}>
      <SignUpForm locale={locale} customerSignIn={customerSignIn} />
    </Suspense>
  );
}
