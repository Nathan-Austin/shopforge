import { calculateShippingCost, type ShippingZone } from "@/lib/checkout/pricing";
import { calculatePackageWeight } from "@/lib/shipping/config";
import { getEffectivePriceCents } from "@/lib/pricing";
import { toAlpha2 } from "@/lib/countries";

const origin = "https://example.com";

// Delivery estimate split into dispatch + transit. Countries listed in
// NEXT_PUBLIC_HOME_COUNTRIES (ISO alpha-3, comma-separated, e.g. "NLD,BEL")
// get the faster home-region transit time.
const HANDLING_DAYS = { min: 1, max: 2 };
const TRANSIT_DAYS_HOME = { min: 1, max: 5 };
const TRANSIT_DAYS_OTHER = { min: 2, max: 8 };
const HOME_COUNTRIES = new Set(
  (process.env.NEXT_PUBLIC_HOME_COUNTRIES ?? "")
    .split(",")
    .map((code) => code.trim().toUpperCase())
    .filter(Boolean),
);

interface SchemaProduct {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  price_cents: number;
  currency?: string | null;
  on_sale?: boolean | null;
  sale_price_cents?: number | null;
  in_stock?: boolean | null;
  weight_grams?: number | null;
  capacity_ml?: number | null;
  brand?: { name: string } | null;
}

interface SchemaVariant {
  price_cents: number;
  sale_price_cents?: number | null;
  weight_grams?: number | null;
  in_stock?: boolean | null;
}

interface BuildProductSchemaParams {
  locale: string;
  product: SchemaProduct;
  variants: SchemaVariant[];
  images: string[];
  avgRating: number | null;
  reviewCount: number;
  zones: ShippingZone[];
}

const money = (cents: number) => (cents / 100).toFixed(2);

/**
 * Every country checkout has an explicit zone for, as alpha-3 (DB) + alpha-2
 * (schema.org). The catch-all default zone has no countries, so it's skipped.
 */
export function getShippingCountries(zones: ShippingZone[]) {
  const seen = new Set<string>();
  const countries: { alpha3: string; alpha2: string }[] = [];
  for (const zone of zones) {
    for (const code of zone.countryCodes) {
      const alpha3 = code.toUpperCase();
      const alpha2 = toAlpha2(alpha3);
      if (!alpha2 || seen.has(alpha3)) continue;
      seen.add(alpha3);
      countries.push({ alpha3, alpha2 });
    }
  }
  return countries;
}

const days = ({ min, max }: { min: number; max: number }) => ({
  "@type": "QuantitativeValue",
  minValue: min,
  maxValue: max,
  unitCode: "DAY",
});

/**
 * Product.offers: one Offer per shipping country, wrapped in an AggregateOffer
 * (a bare Offer array trips Search Console's "missing offerCount"). Each
 * offer's shipping rate comes from calculateShippingCost — the same function
 * checkout charges with — for a single unit at `priceCents` / `weightKg`.
 */
export function buildAggregateOffer({
  priceCents,
  lowPriceCents,
  highPriceCents,
  currency,
  inStock,
  url,
  weightKg,
  zones,
}: {
  priceCents: number;
  lowPriceCents: number;
  highPriceCents: number;
  currency: string;
  inStock: boolean;
  url: string;
  weightKg: number;
  zones: ShippingZone[];
}) {
  const availability = inStock
    ? "https://schema.org/InStock"
    : "https://schema.org/OutOfStock";
  const offers = getShippingCountries(zones).map(({ alpha3, alpha2 }) => ({
    "@type": "Offer",
    price: money(priceCents),
    priceCurrency: currency,
    availability,
    itemCondition: "https://schema.org/NewCondition",
    url,
    eligibleRegion: { "@type": "Country", name: alpha2 },
    seller: { "@id": `${origin}/#organization` },
    shippingDetails: {
      "@type": "OfferShippingDetails",
      shippingDestination: { "@type": "DefinedRegion", addressCountry: alpha2 },
      shippingRate: {
        "@type": "MonetaryAmount",
        value: money(calculateShippingCost(alpha3, weightKg, priceCents, zones)),
        currency,
      },
      deliveryTime: {
        "@type": "ShippingDeliveryTime",
        handlingTime: days(HANDLING_DAYS),
        transitTime: days(
          HOME_COUNTRIES.has(alpha3) ? TRANSIT_DAYS_HOME : TRANSIT_DAYS_OTHER,
        ),
      },
    },
  }));

  return {
    "@type": "AggregateOffer",
    priceCurrency: currency,
    lowPrice: money(lowPriceCents),
    highPrice: money(highPriceCents),
    offerCount: offers.length,
    availability,
    offers,
  };
}

/** Returns terms from /shipping-returns, applied to every shipped-to country. */
export function buildReturnPolicy(zones: ShippingZone[]) {
  return {
    "@type": "MerchantReturnPolicy",
    applicableCountry: getShippingCountries(zones).map((c) => c.alpha2),
    returnPolicyCategory: "https://schema.org/MerchantReturnFiniteReturnWindow",
    merchantReturnDays: 14,
    returnMethod: "https://schema.org/ReturnByMail",
    returnFees: "https://schema.org/ReturnShippingFeesCustomerResponsibility",
  };
}

/**
 * Product node for a shop detail page. Variants are folded into one
 * AggregateOffer price range rather than a ProductGroup — the variants only
 * differ by size/price, and per-country offers are priced (and shipped) at
 * the cheapest purchasable option.
 */
export function buildProductSchema({
  locale,
  product,
  variants,
  images,
  avgRating,
  reviewCount,
  zones,
}: BuildProductSchemaParams) {
  const url = `${origin}/${locale}/shop/${product.slug}`;
  const productInStock = product.in_stock ?? true;

  const options = variants.length
    ? variants.map((variant) => ({
        priceCents: getEffectivePriceCents(product, variant),
        weightGrams: variant.weight_grams ?? product.weight_grams,
        inStock: productInStock && (variant.in_stock ?? true),
      }))
    : [
        {
          priceCents: getEffectivePriceCents(product),
          weightGrams: product.weight_grams,
          inStock: productInStock,
        },
      ];
  const prices = options.map((o) => o.priceCents);
  const inStockOptions = options.filter((o) => o.inStock);
  const representative = [...(inStockOptions.length ? inStockOptions : options)].sort(
    (a, b) => a.priceCents - b.priceCents,
  )[0];

  const weightKg = calculatePackageWeight([
    {
      productName: product.name,
      quantity: 1,
      capacityMl: product.capacity_ml,
      weightGrams: representative.weightGrams,
    },
  ]);

  return {
    "@context": "https://schema.org",
    "@type": "Product",
    "@id": `${url}#product`,
    name: product.name,
    ...(product.description ? { description: product.description } : {}),
    ...(images.length ? { image: images } : {}),
    sku: product.slug,
    url,
    ...(product.brand?.name
      ? { brand: { "@type": "Brand", name: product.brand.name } }
      : {}),
    offers: buildAggregateOffer({
      priceCents: representative.priceCents,
      lowPriceCents: Math.min(...prices),
      highPriceCents: Math.max(...prices),
      currency: product.currency ?? "EUR",
      inStock: inStockOptions.length > 0,
      url,
      weightKg,
      zones,
    }),
    hasMerchantReturnPolicy: buildReturnPolicy(zones),
    // Google rejects aggregateRating with a zero count.
    ...(reviewCount > 0 && avgRating != null
      ? {
          aggregateRating: {
            "@type": "AggregateRating",
            ratingValue: avgRating.toFixed(1),
            reviewCount,
            bestRating: 5,
            worstRating: 1,
          },
        }
      : {}),
  };
}

/** JSON for a `<script type="application/ld+json">`, with `<` escaped so content can't close the tag. */
export function serializeSchema(schema: unknown): string {
  return JSON.stringify(schema).replace(/</g, "\\u003c");
}
