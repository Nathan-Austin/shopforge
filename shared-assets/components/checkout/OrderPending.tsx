'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Shown on the success page while the Stripe webhook is still writing the
 * order. Stripe redirects the browser as soon as the card is accepted, and
 * the webhook usually lands a second or two later, so re-render the server
 * page a few times before giving up and leaving the generic thank-you.
 */
const RETRY_MS = 2500;
const MAX_RETRIES = 8;

export default function OrderPending({ message }: { message: string }) {
  const router = useRouter();

  useEffect(() => {
    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      if (attempts > MAX_RETRIES) {
        clearInterval(timer);
        return;
      }
      router.refresh();
    }, RETRY_MS);
    return () => clearInterval(timer);
  }, [router]);

  return (
    <p className="mt-4 text-sm text-gray-500" role="status" aria-live="polite">
      {message}
    </p>
  );
}
