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

import { CHECKOUT_CONFIG } from '@/lib/checkout/config';
import type { GeneratedConfig } from './schema';

export const GENERATED_CONFIG: GeneratedConfig = {
  checkout: CHECKOUT_CONFIG
};
