import { describe, expect, it } from "vitest";
import { calculateShippingCost, type ShippingZone } from "@/lib/checkout/pricing";
import { buildProductSchema } from "@/lib/store/product-schema";

const brackets = (small: number, big: number) => [
  { maxWeightKg: 2, priceCents: small },
  { maxWeightKg: null, priceCents: big },
];

const zones: ShippingZone[] = [
  { id: "be", name: "Belgium", isDefault: false, countryCodes: ["BEL"], brackets: brackets(695, 995), freeShippingThresholdCents: 20000 },
  { id: "eu", name: "EU Zone 1", isDefault: false, countryCodes: ["DEU", "FRA", "GBR"], brackets: brackets(1495, 1995), freeShippingThresholdCents: 20000 },
  { id: "int", name: "International", isDefault: true, countryCodes: [], brackets: brackets(2995, 3995), freeShippingThresholdCents: null },
];

const product = {
  id: "p1",
  name: "Test Hot Sauce",
  slug: "test-hot-sauce",
  description: "Hot.",
  price_cents: 1200,
  currency: "EUR",
  on_sale: false,
  sale_price_cents: null,
  in_stock: true,
  weight_grams: 450,
  capacity_ml: 200,
  brand: { name: "Brand" },
};

const build = (overrides: Partial<Parameters<typeof buildProductSchema>[0]> = {}) =>
  buildProductSchema({
    locale: "nl",
    product,
    variants: [],
    images: ["https://img/1.jpg"],
    avgRating: 4.6,
    reviewCount: 3,
    zones,
    ...overrides,
  });

describe("buildProductSchema", () => {
  it("emits one offer per zoned country with alpha-2 codes, skipping the countryless default zone", () => {
    const { offers, hasMerchantReturnPolicy } = build();
    expect(offers["@type"]).toBe("AggregateOffer");
    expect(offers.offerCount).toBe(4);
    expect(offers.offers.map((o) => o.eligibleRegion.name)).toEqual(["BE", "DE", "FR", "GB"]);
    expect(hasMerchantReturnPolicy.applicableCountry).toEqual(["BE", "DE", "FR", "GB"]);
  });

  it("uses calculateShippingCost for each country's rate (incl. packaging weight)", () => {
    const { offers } = build();
    const weightKg = 0.65; // 450g bottle + 200g packaging
    for (const [alpha2, alpha3] of [["BE", "BEL"], ["DE", "DEU"]]) {
      const offer = offers.offers.find((o) => o.eligibleRegion.name === alpha2);
      expect(offer?.shippingDetails.shippingRate.value).toBe(
        (calculateShippingCost(alpha3, weightKg, 1200, zones) / 100).toFixed(2),
      );
    }
  });

  it("omits aggregateRating when there are no reviews", () => {
    expect(build().aggregateRating?.reviewCount).toBe(3);
    expect(build({ reviewCount: 0, avgRating: null }).aggregateRating).toBeUndefined();
  });

  it("uses the sale price and reflects the variant price range", () => {
    const schema = build({
      product: { ...product, on_sale: true },
      variants: [
        { price_cents: 1000, sale_price_cents: 800, weight_grams: 280, in_stock: true },
        { price_cents: 1800, sale_price_cents: null, weight_grams: 450, in_stock: true },
      ],
    });
    expect(schema.offers.lowPrice).toBe("8.00");
    expect(schema.offers.highPrice).toBe("18.00");
    expect(schema.offers.offers[0].price).toBe("8.00");
  });

  it("maps stock to availability", () => {
    expect(build().offers.availability).toBe("https://schema.org/InStock");
    expect(build({ product: { ...product, in_stock: false } }).offers.availability).toBe(
      "https://schema.org/OutOfStock",
    );
  });
});
