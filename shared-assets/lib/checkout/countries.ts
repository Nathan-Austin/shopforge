/**
 * The countries a shop can deliver to.
 *
 * Only the ISO 3166-1 alpha-2 codes are listed here: every name comes from
 * `Intl.DisplayNames`, so there is nothing to translate and the checkout
 * select and the admin picker say the same thing in the reader's language.
 *
 * The list is written out rather than derived from `Intl` at runtime,
 * because the set of regions a runtime knows differs between Node and
 * browser versions, and the shop's valid countries must not. It is the set
 * `store_settings:checkout` accepts (lib/settings/schema.ts) and the set
 * `/admin/settings` offers. Groupings (EU), pseudo-regions and codes
 * withdrawn from the standard (AN, YU, …) are left out.
 *
 * Stripe supports nearly all of these for `shipping_address_collection`.
 * One it does not is refused when the payment session is created, not here.
 */

const CODES = `
  AC AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA
  BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW
  BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CP CQ CR CU
  CV CW CX CY CZ DE DG DJ DK DM DO DZ EA EC EE EG EH ER
  ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM
  GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU IC ID IE
  IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN
  KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC
  MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW
  MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE
  PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW
  SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV
  SX SY SZ TA TC TD TF TG TH TJ TK TL TM TN TO TR TT TV
  TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS XK
  YE YT ZA ZM ZW
`;

/** Every code a shop may deliver to, in alphabetical order. */
export const COUNTRY_CODES: readonly string[] = Object.freeze(CODES.trim().split(/\s+/));

const CODE_SET = new Set(COUNTRY_CODES);

/** Whether a string is one of the codes above (uppercase, exactly two letters). */
export function isCountryCode(code: string): boolean {
  return CODE_SET.has(code);
}

/** The country's name in the reader's language, falling back to the code. */
export function countryName(code: string, locale: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** The codes sorted by what they are called in `locale`, for a picker. */
export function countriesByName(locale: string): { code: string; name: string }[] {
  const collator = new Intl.Collator(locale);
  return COUNTRY_CODES.map((code) => ({ code, name: countryName(code, locale) })).sort((a, b) =>
    collator.compare(a.name, b.name)
  );
}
