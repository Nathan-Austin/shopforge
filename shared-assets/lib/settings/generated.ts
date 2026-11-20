/**
 * The shop's generated configuration, handed to the settings fallbacks.
 *
 * A shop keeps working before its owner has saved anything, so every
 * setting falls back to what the generator wrote. This file is the one
 * place that knows those files exist: ./schema stays pure (it only
 * validates what it is given) and ./store passes this in.
 *
 * A setting that falls back to an environment variable needs nothing here.
 */

import { AUTH_CONFIG } from '@/lib/auth/config';
import { CHECKOUT_CONFIG } from '@/lib/checkout/config';
import { HEAT_SCALE, PRODUCT_FIELD_KEYS, STORE_MODE } from '@/lib/products/config';
import { SHIPPING_CONFIG } from '@/lib/shipping/config';
import type { GeneratedConfig } from './schema';

export const GENERATED_CONFIG: GeneratedConfig = {
  mode: STORE_MODE,
  checkout: CHECKOUT_CONFIG,
  auth: AUTH_CONFIG,
  productFields: PRODUCT_FIELD_KEYS,
  heat: HEAT_SCALE,
  shipping: SHIPPING_CONFIG
};
