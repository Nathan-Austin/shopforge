# International SEO, locale routing and structured data

Research and design notes for shopforge, written 2026-11-04. The first part is
what Google and the market do today, with sources; the second part is what
the generator now does about it and what is deliberately left for later.

The landscape moves, so the dates matter: every claim below is tied to a
source that was current on the day of writing. Re-check the "Things that
changed recently" list before relying on this a year from now.

## 1. Summary and recommendations

1. **Use one domain with country-language subpaths**: `/de-de/`, `/de-at/`,
   `/en-de/`. This is the structure Nike and IKEA use and the one most 2025
   to 2026 guidance recommends for a new rollout, because one domain
   concentrates all authority and is one deployment. ccTLDs (Amazon,
   Zalando) only pay off with local teams and local link building per
   country. ([Google: managing multi-regional sites][g-multiregional],
   [Swanky: international URL structure][swanky], [Incremys][incremys])
2. **Every indexable page carries the full hreflang set, itself included,
   plus `x-default`, and a self-referencing canonical.** Google ignores a
   whole cluster when one return link is missing; it treats hreflang as a
   hint, not a directive, so the canonical must agree with it. Nothing about
   this changed in 2025 or 2026; John Mueller said so explicitly after
   Google retired its own country domains. ([Google: localized versions][g-localized],
   [SER: nothing has changed][ser-nochange])
3. **Never redirect by IP or Accept-Language on a localized URL.** Googlebot
   crawls mostly from US IPs and sends no Accept-Language header, so a
   geo-redirect hides every non-US variant from it. Detect only at the
   neutral root (`/`), let the URL decide everywhere else, and offer a
   switcher. ([Google: locale-adaptive pages][g-locale-adaptive])
4. **Structured data is the cheapest Merchant Center integration there is.**
   Merchant Center can build and keep a product source from the site's own
   Product JSON-LD ("website crawl"), and uses it for automatic price and
   availability updates. A scheduled-fetch feed URL is the next step up and
   needs no credentials. The programmatic route is the new Merchant API
   only: the Content API for Shopping was shut down on 2026-08-18.
   ([GMC: add products automatically][gmc-auto], [GMC: automatic updates][gmc-autoupdate],
   [Content API sunset][content-sunset])
5. **Product pages need, at minimum, `Product.name`, `image`, and an `Offer`
   with `price` above zero, `priceCurrency` in ISO 4217, and should carry
   `availability`, `itemCondition`, `brand` as a `Brand`, `gtin*` or `mpn`,
   `sku`, `url`, `priceValidUntil` only when there is a real end date, and
   shipping and return details, preferably once under the Organization.**
   ([Google: merchant listing][g-merchant-listing], [GMC: supported structured data][gmc-sd])
6. **Headings matter for structure, not for a ranking bonus.** One clear
   product-name `<h1>` and descriptive `<h2>` sections is the whole
   requirement; Google has said for years that H1 versus H2 is not weighted
   and multiple or missing H1s are "not a critical issue". ([SEJ: headings][sej-headings])
7. **Per-country pricing and currency are a Merchant Center requirement
   before they are an SEO one.** The price and currency on the landing page
   must match the feed for that target country, and switching currency by
   IP is explicitly against the rules. A shop that sells to several
   countries in one currency is fine; one that wants local currencies needs
   price lists per market, which this generator does not have yet.
   ([GMC: supported languages and currencies][gmc-currencies])

## 2. Things that changed recently (2025 to 2026)

- **Google's country domains are gone** (google.fr, google.de redirect to
  google.com since 2025). Google's position: no change to international
  SEO or hreflang. ([SEJ: domain structure][sej-domains], [SER][ser-nochange])
- **Search Console's International Targeting report is gone** (since
  2022). There is no first-party hreflang validator any more; audit the
  rendered HTML with a crawler. ([Search Console help][gsc-intl])
- **Content API for Shopping was sunset on 2026-08-18.** Merchant API is
  the only programmatic interface; its data sources must be created
  explicitly before products can be inserted. ([Content API sunset][content-sunset],
  [Merchant API data sources][merchant-datasources])
- **Universal Commerce Protocol (UCP)** launched 2026-01-11: agentic
  checkout inside AI Mode and Gemini, US merchants first, opt-in per
  product via `native_commerce(checkout_eligibility)`. Needs a Merchant
  Center account with return policies configured. Out of scope here, but
  it is the direction of travel and it leans on the same feed data.
  ([GMC: UCP][gmc-ucp], [UCP merchant guide][ucp-guide])
- **Checkout Session `shipping_details` moved** to
  `collected_information.shipping_details` in Stripe's 2025-03-31 API
  version. Not SEO, but it bit this codebase's webhook and is fixed.
- **Structured data pruning:** FAQ rich results removed (2026-05-07),
  seven types retired in June 2025, sitelinks search box earlier. Product,
  Organization and BreadcrumbList are explicitly staying. Mobile results
  show only the root domain instead of a breadcrumb trail since January
  2025; desktop and the Search Console report are unchanged.
  ([Nautilinks: breadcrumbs 2026][breadcrumbs-2026], [AI Schema Gen: 2026 log][sd-log])
- **Product variants:** `ProductGroup` with `hasVariant`, `variesBy` and
  `productGroupID` has been supported since February 2024 and is the
  expected markup when variants have their own identifiers or URLs.
  ([Google: product variants][g-variants])
- **Organization-level shipping and returns:** `OnlineStore` with
  `hasShippingService` and `hasMerchantReturnPolicy` lets a shop state its
  policy once; offer-level `shippingDetails` is now the override. Google
  prefers Merchant Center settings over markup for both when both exist.
  ([Google: Organization][g-organization], [Google: return policy][g-returns])

## 3. URL structure: country-language subpaths

### What the big stores do

| Store | Structure | Example | Note |
|---|---|---|---|
| Nike | gTLD + country folder | `nike.com/gb/`, `nike.com/de/` | hreflang per folder, canonical to the folder |
| IKEA | gTLD + country/language | `ikea.com/de/de/`, `ikea.com/ch/fr/` | `ikea.fi` 301s into the folder; x-default is a selector page |
| Apple | gTLD + country folder | `apple.com/uk/`, `apple.com/de/` | |
| Amazon | ccTLD per country | `amazon.de`, `amazon.co.jp` | local payments, catalogue and legal per site |
| Zalando | ccTLD per country, language subdomains inside Switzerland | `zalando.ch`, `fr.zalando.ch`, `it.zalando.ch` | de-CH / fr-CH / it-CH is the textbook case for region codes |

Sources: [Swanky][swanky], [Incremys][incremys], [Zalando site data][zalando-ch].

### What shopforge does

- Locales are BCP 47 tags, lowercased in the URL: `en`, `de`, `de-at`,
  `en-de`. A plain language code is a language-only locale; a
  language-country code is a market.
- `hreflang` values use canonical casing: `de-AT`, `en-DE`, `de`. `html
  lang` matches. Google says case does not matter; readers and validators
  prefer this.
- Messages fall back by language: `de-at` loads `de.json` and overlays
  `de-at.json` if it exists, so a market needs only the strings that
  differ (currency wording, legal names), not a full copy.
- The default locale is always prefixed too (`/en/...`); `/` redirects to
  the best match from Accept-Language once, and that is the only place
  detection happens. Prefixed URLs are never redirected.
- `x-default` points at the default locale's page, which is also what the
  root redirect resolves to for unmatched visitors.

### What it does not do yet

- One currency per shop (a product decision taken on 2026-11-04). A market
  does not get its own price list, so `de-at` and `de-de` show the same
  euro prices. That satisfies Merchant Center for eurozone markets selling
  in euro; a GBP or CHF market would need per-market prices.
- Translated slugs: `/de-de/shop/ghost-pepper-sauce` keeps the slug. Google
  is fine with this; it is a product decision whether to localize slugs.
- Country-specific catalogue (hide a product in one market): not modelled.

## 4. hreflang, canonical and x-default rules the generator enforces

Each indexable page's `<head>` contains, generated from one helper so pages
and the sitemap cannot disagree:

```html
<link rel="canonical" href="https://shop.example/de-at/shop/ghost-pepper-sauce" />
<link rel="alternate" hreflang="en" href="https://shop.example/en/shop/ghost-pepper-sauce" />
<link rel="alternate" hreflang="de" href="https://shop.example/de/shop/ghost-pepper-sauce" />
<link rel="alternate" hreflang="de-AT" href="https://shop.example/de-at/shop/ghost-pepper-sauce" />
<link rel="alternate" hreflang="x-default" href="https://shop.example/en/shop/ghost-pepper-sauce" />
```

- Absolute URLs always (Google requires it). `NEXT_PUBLIC_SITE_URL` is the
  base; `metadataBase` is set from it in the root layout.
- The set is the same on every locale version of the page, so it is
  reciprocal and self-referencing by construction.
- The canonical is the page's own locale URL. Never the default locale,
  never the x-default.
- Pages that must not be indexed (cart, checkout, account, auth, admin,
  API) carry `noindex` and no hreflang set. Hreflang to a noindex page is
  a common audit error.
- The sitemap lists every locale version of every indexable page with the
  same `xhtml:link` alternates, generated from the same helper.
- next-intl's own `Link`-header alternates are switched off so there is one
  source of truth.

## 5. Structured data per page

All JSON-LD, one `<script type="application/ld+json">` per entity, rendered
server-side from the same data as the HTML so the two cannot drift.

| Page | Types | Notes |
|---|---|---|
| Home | `OnlineStore` (Organization), `WebSite` | Site name for Google, logo, same-as links, shipping policy once |
| `/shop` | `BreadcrumbList`, `ItemList` of product URLs | Carousel-eligible summary page; no `Product` on tiles, no ratings |
| `/shop/[slug]` | `BreadcrumbList`, `Product` with `Offer` | The merchant-listing payload, below |

### Product page payload

Required for merchant listings: `name`, `image` (absolute URLs),
`offers.price` above zero as a plain decimal string, `offers.priceCurrency`
ISO 4217, `offers.url` the canonical product URL, and the offer must be an
`Offer` (we are the seller).

Recommended and emitted when the data exists: `description`, `sku`,
`gtin` (8, 12, 13 or 14 digits, or `isbn`), `mpn` (the SKU when there is no
GTIN), `brand` as `{ "@type": "Brand", "name": ... }` (not `Thing`),
`category`, `availability` as a schema.org URL (`InStock`, `OutOfStock`,
`BackOrder`), `itemCondition` (`NewCondition`), `shippingDetails` with the
flat rate and destination countries, `hasMerchantReturnPolicy` when the
shop has configured one, `priceValidUntil` only for a real sale end date
(a past date hides the listing). Products with no identifier at all are
still valid; in a feed they would carry `identifier_exists = no`.

Sources: [Google: merchant listing][g-merchant-listing],
[GMC: supported attributes][gmc-sd], [GMC: product data spec][gmc-spec].

### Variants

Our variants are option lists (size, colour) on one product with one price
and no per-variant identifiers, so the page emits a single `Product`. When
variants get their own SKU, GTIN or price, the page should emit a
`ProductGroup` with `hasVariant`, `variesBy` and `productGroupID`, and each
variant its own `Offer`. ([Google: product variants][g-variants])

## 6. Google Merchant Center

### Getting products in

Three supported routes, in order of effort:

1. **Website crawl from structured data.** Verify and claim the site in
   Merchant Center, choose "Add products from your online store", and
   Google builds the product source from the Product JSON-LD. Requires
   `title`, `price`, `availability` and `image_link` in markup; `gtin`,
   `brand`, `mpn`, `description`, `condition` enrich it. Google does not
   promise how quickly changes are picked up. ([GMC: add products automatically][gmc-auto])
2. **Scheduled fetch of a feed URL.** RSS 2.0 with the `g:` namespace is
   still the documented XML format in Merchant Center Next; Google fetches
   it every 24 hours and one feed is needed per target country and content
   language. No credentials. This is what shopforge generates, one feed
   per locale. ([GMC: RSS 2.0 spec][gmc-rss], [GMC: upload products][gmc-upload])
3. **Merchant API.** Create a data source, insert products programmatically.
   Needs a Google Cloud project, a service account granted access in
   Merchant Center, and per-store credentials. Right for high-frequency
   inventory changes; a follow-up here, below. ([Merchant API data sources][merchant-datasources])

Whichever route, turn on **automatic item updates** so a stale feed price
is corrected from the page's structured data instead of the item being
disapproved. ([GMC: automatic updates][gmc-autoupdate])

### Multi-country rules

- One data source per target country and language; the same source can
  serve several countries that share a language and currency ("add
  multiple countries"). ([GMC: multiple countries][gmc-multi])
- Landing page language must match the data source language. Price and
  currency on the landing page must match the source for that country.
  Switching either by visitor location is against policy. ([GMC: currencies][gmc-currencies])
- Shipping settings in Merchant Center must be in the feed's currency.
- `feed_label` (or country of sale) is how Google Ads targets a market.

### Verification and monitoring

- Verify the site in Search Console, then claim it in Merchant Center from
  the same Google account. `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION` renders
  the meta tag.
- Search Console: "Merchant listings" and "Product snippets" reports under
  Shopping; Rich Results Test for one URL. There is no hreflang report;
  crawl the HTML.
- Merchant Center: Diagnostics for disapprovals; the two usual causes are
  price mismatch between feed and page, and a missing or wrong identifier.

## 7. Headings

Google uses headings to understand page structure and has repeatedly said
heading level carries no ranking weight and multiple or missing H1s are not
an issue. The useful discipline for a shop: one `<h1>` that is the product
or category name, `<h2>` for the sections a buyer scans (description,
ingredients, details, nutrition), no keyword stuffing. shopforge's product
and shop pages already follow this; the home page now has an `<h1>` with
the shop's name instead of the template placeholder. ([SEJ: Mueller on H1][sej-h1],
[SEJ: headings as a signal][sej-headings])

## 8. What the generator now does (2026-11-04)

- Locale config with language-country markets, message fallback by
  language, lowercase URL prefixes, correct `hreflang` and `html lang`.
- `canonical`, full `hreflang` set and `x-default` on every indexable page
  from one helper; `noindex` on cart, checkout, account, auth and admin;
  `robots.txt` and a multi-locale `sitemap.xml` with alternates.
- JSON-LD: `OnlineStore` + `WebSite` on the home page, `BreadcrumbList` +
  `ItemList` on `/shop`, `BreadcrumbList` + `Product`/`Offer`/`Brand` on
  the product page with GTIN, SKU, MPN, availability, condition and
  shipping. Visible breadcrumbs on the product page.
- `products_public` exposes `sku` and `barcode` (GTIN) because Merchant
  Center wants them public; cost price stays private.
- A Merchant Center feed per locale at `/api/feeds/google/<locale>.xml`
  (RSS 2.0), generated from the same product data and currency as the
  pages, refusing to publish an empty feed when the catalogue cannot be
  read (an empty feed would make Merchant Center delete every product).
- `/admin/seo`: the feed URLs, the sitemap URL, the verification status and
  a checklist, so the owner can paste the right things into Merchant
  Center and Search Console without reading this document.
- Unit tests for the alternates helper (reciprocity, self-reference,
  x-default, casing, noindex pages), the JSON-LD builders (required
  merchant-listing fields, ISO currency, GTIN shape, availability enum,
  escaping) and the feed.

## 9. Follow-ups, in rough priority

1. **Per-market prices and currency**, with the shop currency as a
   generator choice first (already on the roadmap). Without it a GBP or
   CHF market cannot pass Merchant Center review.
2. **Merchant API sync from the admin:** service-account JSON and merchant
   id as env vars, create the data source once, upsert on product save,
   delete on archive. Keep the feed URL as the fallback.
3. **`ProductGroup` for variants** once variants carry their own SKU or
   price.
4. **Return policy in config** so `hasMerchantReturnPolicy` can be emitted
   under the Organization (today it is omitted unless configured).
5. **Reviews and `AggregateRating`** on product pages; this is the single
   biggest visible rich-result difference and needs a reviews feature
   first.
6. **Translated slugs** per locale, with the alternates helper mapping
   them.
7. **UCP / agentic checkout** eligibility attributes in the feed when
   Google opens it beyond the US early-access programme.
8. **Locale switcher in the header** with the non-blocking "this page is
   also available in ..." hint Google prefers over redirects.

## Sources

[g-localized]: https://developers.google.com/search/docs/specialty/international/localized-versions
[g-multiregional]: https://developers.google.com/search/docs/specialty/international/managing-multi-regional-sites
[g-locale-adaptive]: https://developers.google.com/search/docs/specialty/international/locale-adaptive-pages
[g-merchant-listing]: https://developers.google.com/search/docs/appearance/structured-data/merchant-listing
[g-variants]: https://developers.google.com/search/docs/appearance/structured-data/product-variants
[g-organization]: https://developers.google.com/search/docs/appearance/structured-data/organization
[g-returns]: https://developers.google.com/search/docs/appearance/structured-data/return-policy
[g-sitenames]: https://developers.google.com/search/docs/appearance/site-names
[g-carousels]: https://developers.google.com/search/docs/appearance/structured-data/carousels-beta
[gmc-sd]: https://support.google.com/merchants/answer/6386198
[gmc-spec]: https://support.google.com/merchants/answer/7052112
[gmc-auto]: https://support.google.com/merchants/answer/12158480
[gmc-autoupdate]: https://support.google.com/merchants/answer/12157888
[gmc-upload]: https://support.google.com/merchants/answer/11586438
[gmc-rss]: https://support.google.com/merchants/answer/14987622
[gmc-multi]: https://support.google.com/merchants/answer/15404838
[gmc-currencies]: https://support.google.com/merchants/answer/160637
[gmc-ucp]: https://support.google.com/merchants/answer/16837055
[ucp-guide]: https://developers.google.com/merchant/ucp/guides/overview/merchant-center
[content-sunset]: https://developers.google.com/shopping-content/guides/deprecation-and-sunset
[merchant-datasources]: https://developers.google.com/merchant/api/guides/compatibility/data-sources
[gsc-intl]: https://support.google.com/webmasters/answer/12474899
[ser-nochange]: https://www.seroundtable.com/google-international-seo-no-change-39253.html
[sej-domains]: https://www.searchenginejournal.com/googles-new-domain-structure-whats-next-for-hreflang/544631/
[sej-headings]: https://www.searchenginejournal.com/google-heading-tags-important/377592/
[sej-h1]: https://www.searchenginejournal.com/google-h1-headings-seo/328459/
[swanky]: https://swankyagency.com/international-domain-url-structure/
[incremys]: https://www.incremys.com/en/resources/blog/international-seo
[zalando-ch]: https://www.netify.ai/resources/domains/zalando.ch
[breadcrumbs-2026]: https://nautilinks.co/en/glossary/schema-breadcrumb/
[sd-log]: https://www.aischemagen.com/blog/google-structured-data-changes-2026
[nextjs-metadata]: https://nextjs.org/docs/app/api-reference/functions/generate-metadata
[next-intl-routing]: https://next-intl.dev/docs/routing/configuration
