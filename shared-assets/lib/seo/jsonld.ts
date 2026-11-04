/**
 * JSON-LD builders.
 *
 * Pure functions that turn shop data into schema.org objects Google's
 * merchant listing and rich result features read: Product with Offer and
 * Brand, BreadcrumbList, ItemList for the shop grid, OnlineStore and
 * WebSite for the home page. Everything is built from the same data the
 * page renders, so the markup cannot say something the page does not.
 *
 * What Google needs for a merchant listing (developers.google.com/search/
 * docs/appearance/structured-data/merchant-listing): Product.name, image,
 * offers as an Offer with price > 0 and an ISO 4217 priceCurrency. The rest
 * (gtin, sku, brand, availability, condition, shipping, returns) is
 * recommended and emitted whenever the data exists.
 */

export type JsonLdObject = Record<string, unknown>;

/** ISO 4217 is three uppercase letters. */
export const CURRENCY_PATTERN = /^[A-Z]{3}$/;

export type Availability = 'InStock' | 'OutOfStock' | 'BackOrder' | 'PreOrder';

/** schema.org availability from the shop's stock status. */
export function availabilityFor(status: 'in_stock' | 'low_stock' | 'backorder' | 'sold_out'): Availability {
  switch (status) {
    case 'sold_out':
      return 'OutOfStock';
    case 'backorder':
      return 'BackOrder';
    default:
      return 'InStock';
  }
}

/**
 * Picks the GTIN property for a barcode by its length (GS1: 8, 12, 13 or
 * 14 digits). Anything else is not a GTIN and is left out rather than
 * submitted wrong: Google disapproves products with invalid GTINs.
 */
export function gtinProperty(barcode: string | null | undefined): Record<string, string> {
  const digits = (barcode ?? '').replace(/[\s-]/g, '');
  if (!/^\d+$/.test(digits)) return {};
  switch (digits.length) {
    case 8:
      return { gtin8: digits };
    case 12:
      return { gtin12: digits };
    case 13:
      return { gtin13: digits };
    case 14:
      return { gtin14: digits };
    default:
      return {};
  }
}

/** Price as schema.org wants it: a decimal string with a dot, no symbol. */
export function priceString(cents: number): string {
  return (Math.max(0, Math.round(cents)) / 100).toFixed(2);
}

export interface ProductJsonLdInput {
  /** Canonical URL of the product page, absolute. */
  url: string;
  name: string;
  description?: string | null;
  /** Absolute image URLs, main image first. */
  images: string[];
  sku?: string | null;
  /** EAN/UPC/GTIN as stored. */
  barcode?: string | null;
  brand?: string | null;
  category?: string | null;
  priceCents: number;
  /** ISO 4217, any case. */
  currency: string;
  availability: Availability;
  /** ISO 8601 date, only when the price really ends then. */
  priceValidUntil?: string | null;
  shipping?: {
    /** Flat rate in cents; 0 for free. */
    rateCents: number;
    currency: string;
    /** ISO 3166-1 alpha-2 destination countries. */
    countries: string[];
  } | null;
  returnPolicy?: {
    /** ISO 3166-1 alpha-2. */
    country: string;
    days: number;
    /** Who pays return shipping. */
    fees: 'free' | 'customer';
  } | null;
  sellerName: string;
}

export function productJsonLd(input: ProductJsonLdInput): JsonLdObject {
  const currency = input.currency.toUpperCase();
  const offer: JsonLdObject = {
    '@type': 'Offer',
    url: input.url,
    price: priceString(input.priceCents),
    priceCurrency: currency,
    availability: `https://schema.org/${input.availability}`,
    itemCondition: 'https://schema.org/NewCondition',
    seller: { '@type': 'Organization', name: input.sellerName }
  };
  if (input.priceValidUntil) offer.priceValidUntil = input.priceValidUntil;
  if (input.shipping && input.shipping.countries.length > 0) {
    offer.shippingDetails = {
      '@type': 'OfferShippingDetails',
      shippingRate: {
        '@type': 'MonetaryAmount',
        value: priceString(input.shipping.rateCents),
        currency: input.shipping.currency.toUpperCase()
      },
      shippingDestination: input.shipping.countries.map((country) => ({
        '@type': 'DefinedRegion',
        addressCountry: country.toUpperCase()
      }))
    };
  }
  if (input.returnPolicy) {
    offer.hasMerchantReturnPolicy = {
      '@type': 'MerchantReturnPolicy',
      applicableCountry: input.returnPolicy.country.toUpperCase(),
      returnPolicyCategory: 'https://schema.org/MerchantReturnFiniteReturnWindow',
      merchantReturnDays: input.returnPolicy.days,
      returnMethod: 'https://schema.org/ReturnByMail',
      returnFees:
        input.returnPolicy.fees === 'free'
          ? 'https://schema.org/FreeReturn'
          : 'https://schema.org/ReturnShippingFees'
    };
  }

  const product: JsonLdObject = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: input.name,
    url: input.url,
    image: input.images,
    offers: offer
  };
  if (input.description) product.description = input.description;
  const sku = input.sku?.trim();
  if (sku) {
    product.sku = sku;
    // Google wants gtin or mpn; the SKU is the manufacturer part number a
    // small shop actually has.
    product.mpn = sku;
  }
  Object.assign(product, gtinProperty(input.barcode));
  if (input.brand?.trim()) product.brand = { '@type': 'Brand', name: input.brand.trim() };
  if (input.category?.trim()) product.category = input.category.trim();
  return product;
}

export interface BreadcrumbItem {
  name: string;
  /** Absolute URL; omit for the current page. */
  url?: string | null;
}

export function breadcrumbJsonLd(items: BreadcrumbItem[]): JsonLdObject {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      ...(item.url ? { item: item.url } : {})
    }))
  };
}

/** A category or shop grid: the detail-page URLs, in display order. */
export function itemListJsonLd(input: { name: string; url: string; items: { name: string; url: string }[] }): JsonLdObject {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: input.name,
    url: input.url,
    numberOfItems: input.items.length,
    itemListElement: input.items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      url: item.url
    }))
  };
}

export interface OnlineStoreInput {
  name: string;
  url: string;
  logo?: string | null;
  sameAs?: string[];
  email?: string | null;
  shipping?: ProductJsonLdInput['shipping'];
  returnPolicy?: ProductJsonLdInput['returnPolicy'];
}

/** The shop itself, on the home page: site name, logo, store-wide policies. */
export function onlineStoreJsonLd(input: OnlineStoreInput): JsonLdObject {
  const store: JsonLdObject = {
    '@context': 'https://schema.org',
    '@type': 'OnlineStore',
    name: input.name,
    url: input.url
  };
  if (input.logo) store.logo = input.logo;
  if (input.sameAs?.length) store.sameAs = input.sameAs;
  if (input.email) store.email = input.email;
  if (input.shipping && input.shipping.countries.length > 0) {
    store.hasShippingService = {
      '@type': 'ShippingService',
      shippingRate: {
        '@type': 'MonetaryAmount',
        value: priceString(input.shipping.rateCents),
        currency: input.shipping.currency.toUpperCase()
      },
      shippingDestination: input.shipping.countries.map((country) => ({
        '@type': 'DefinedRegion',
        addressCountry: country.toUpperCase()
      }))
    };
  }
  if (input.returnPolicy) {
    store.hasMerchantReturnPolicy = {
      '@type': 'MerchantReturnPolicy',
      applicableCountry: input.returnPolicy.country.toUpperCase(),
      returnPolicyCategory: 'https://schema.org/MerchantReturnFiniteReturnWindow',
      merchantReturnDays: input.returnPolicy.days,
      returnFees:
        input.returnPolicy.fees === 'free'
          ? 'https://schema.org/FreeReturn'
          : 'https://schema.org/ReturnShippingFees'
    };
  }
  return store;
}

/** Site name for Google; one WebSite node on the home page only. */
export function webSiteJsonLd(input: { name: string; url: string; inLanguage: string }): JsonLdObject {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: input.name,
    url: input.url,
    inLanguage: input.inLanguage
  };
}

/**
 * JSON for a <script type="application/ld+json">. `<` is escaped so a
 * product name containing "</script>" cannot end the block early.
 */
export function serializeJsonLd(value: JsonLdObject): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/ /g, '\\u2028').replace(/ /g, '\\u2029');
}

/**
 * Checks a Product object against the merchant listing minimums, so a
 * test (or an admin check) can say exactly what is missing rather than
 * waiting for Search Console to.
 */
export function merchantListingProblems(product: JsonLdObject): string[] {
  const problems: string[] = [];
  if (product['@type'] !== 'Product') problems.push('type is not Product');
  if (!product.name) problems.push('missing name');
  const images = product.image;
  if (!Array.isArray(images) || images.length === 0) problems.push('missing image');
  else if (images.some((url) => typeof url !== 'string' || !/^https?:\/\//.test(url))) problems.push('image is not an absolute URL');

  const offer = product.offers as JsonLdObject | undefined;
  if (!offer || offer['@type'] !== 'Offer') {
    problems.push('offers is not an Offer');
    return problems;
  }
  const price = Number(offer.price);
  if (!(typeof offer.price === 'string' && /^\d+\.\d{2}$/.test(offer.price)) || !(price > 0)) {
    problems.push('offer price must be a positive decimal string');
  }
  if (typeof offer.priceCurrency !== 'string' || !CURRENCY_PATTERN.test(offer.priceCurrency)) {
    problems.push('priceCurrency is not ISO 4217');
  }
  if (typeof offer.availability !== 'string' || !offer.availability.startsWith('https://schema.org/')) {
    problems.push('availability is not a schema.org value');
  }
  if (typeof offer.url !== 'string' || !/^https?:\/\//.test(offer.url)) problems.push('offer url is not absolute');
  if (typeof offer.priceValidUntil === 'string' && Date.parse(offer.priceValidUntil) < Date.now()) {
    problems.push('priceValidUntil is in the past');
  }
  const brand = product.brand as JsonLdObject | undefined;
  if (brand && brand['@type'] !== 'Brand') problems.push('brand is not a Brand');
  for (const key of ['gtin8', 'gtin12', 'gtin13', 'gtin14']) {
    const value = product[key];
    if (value !== undefined && !/^\d+$/.test(String(value))) problems.push(`${key} is not numeric`);
  }
  return problems;
}
