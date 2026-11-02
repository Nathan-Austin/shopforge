import Stripe from 'stripe';

let stripe: Stripe | null = null;

export function getStripeServerClient() {
  if (!stripe) {
    const secretKey = process.env.STRIPE_SECRET_KEY;

    if (!secretKey) {
      throw new Error('STRIPE_SECRET_KEY is not configured');
    }

    // No apiVersion: the SDK pins the API version it was built for, so
    // upgrading the stripe package keeps the types and the API in step.
    stripe = new Stripe(secretKey, {
      typescript: true,
    });
  }

  return stripe;
}
