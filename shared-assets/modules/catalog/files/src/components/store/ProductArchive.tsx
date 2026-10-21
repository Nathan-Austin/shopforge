"use client";

import { useState, useMemo, useEffect, Suspense } from "react";
import { useTranslations } from "next-intl";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import type { StoreProduct, ChilliType, Category, StoreBrand } from "./types";
import { getEffectivePriceCents, isOnSale } from "@/lib/pricing";
import ProductCard from "./ProductCard";
import Chip from "./Chip";

interface ProductArchiveProps {
  products: StoreProduct[];
  chilliTypes: ChilliType[];
  categories: Category[];
  brands: StoreBrand[];
  locale: string;
}

type SortOption =
  | "popular"
  | "newest"
  | "mild-first"
  | "hot-first"
  | "price-asc"
  | "price-desc";

const HEAT_BAND_SLUGS = new Set([
  "mild",
  "medium",
  "hot",
  "very-hot",
  "superhot",
]);

const HEAT_ORDER = ["mild", "medium", "hot", "veryHot", "superHot"] as const;
type HeatBand = (typeof HEAT_ORDER)[number];

const resolveHeatRank = (value?: string | number | null): number | null => {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return value;

  const numeric = Number(value);
  return !Number.isNaN(numeric) ? numeric : null;
};

const resolveHeatCategory = (rank: number | null): string | null => {
  if (rank === null) return null;
  if (rank <= 4) return "mild";
  if (rank <= 7) return "medium";
  if (rank <= 9) return "hot";
  if (rank === 10) return "veryHot";
  return "superHot";
};

function ProductArchiveContent({
  products,
  chilliTypes,
  categories,
  brands,
  locale,
}: ProductArchiveProps) {
  const t = useTranslations("SauceArchive");
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [searchTerm, setSearchTerm] = useState(searchParams.get("q") || "");
  const [selectedHeatLevel, setSelectedHeatLevel] = useState(searchParams.get("heat") || "");
  const [selectedChilliType, setSelectedChilliType] = useState(searchParams.get("chilli") || "");
  const [selectedCategory, setSelectedCategory] = useState(searchParams.get("category") || "");
  // ?brand= may be a slug (e.g. links from the header); the Producer
  // dropdown is keyed by id, so resolve it or the dropdown shows "All".
  const [selectedBrand, setSelectedBrand] = useState(() => {
    const brand = searchParams.get("brand") || "";
    return brands.find((b) => b.slug === brand)?.id?.toString() ?? brand;
  });
  const [selectedCountry, setSelectedCountry] = useState(searchParams.get("country") || "");
  // "" = default view: popular, grouped by heat band. An explicit
  // ?sort=popular (header "Bestsellers") gives a flat bestseller list.
  const [sortBy, setSortBy] = useState<SortOption | "">((searchParams.get("sort") as SortOption) || "");
  const [displayCount, setDisplayCount] = useState(Number(searchParams.get("limit")) || 12);
  const [hideOutOfStock, setHideOutOfStock] = useState(searchParams.get("inStock") !== "0");
  const [onlySale, setOnlySale] = useState(searchParams.get("sale") === "1");
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Sync all filter state to URL so it persists when navigating back
  useEffect(() => {
    const params = new URLSearchParams();
    if (searchTerm) params.set("q", searchTerm);
    if (selectedHeatLevel) params.set("heat", selectedHeatLevel);
    if (selectedChilliType) params.set("chilli", selectedChilliType);
    if (selectedCategory) params.set("category", selectedCategory);
    if (selectedBrand) params.set("brand", selectedBrand);
    if (selectedCountry) params.set("country", selectedCountry);
    if (sortBy) params.set("sort", sortBy);
    if (displayCount !== 12) params.set("limit", String(displayCount));
    if (!hideOutOfStock) params.set("inStock", "0");
    if (onlySale) params.set("sale", "1");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [searchTerm, selectedHeatLevel, selectedChilliType, selectedCategory, selectedBrand, selectedCountry, sortBy, displayCount, hideOutOfStock, onlySale, pathname, router]);


  // Build type categories: replace heat band entries with a single "Sauces" option
  const typeCategories = useMemo(() => {
    const hasSauces = categories.some((c) => HEAT_BAND_SLUGS.has(c.slug));
    const nonHeatBand = categories.filter((c) => !HEAT_BAND_SLUGS.has(c.slug));
    return hasSauces
      ? [{ id: "sauces", name: "Sauces", slug: "sauces" }, ...nonHeatBand]
      : nonHeatBand;
  }, [categories]);

  // Derive unique countries from brands
  const countries = useMemo(() => {
    const uniqueCountries = new Set<string>();
    brands.forEach((brand) => {
      if (brand.country) {
        uniqueCountries.add(brand.country);
      }
    });
    return Array.from(uniqueCountries).sort();
  }, [brands]);


  const filteredAndSortedProducts = useMemo(() => {
    let filtered = products.filter((product) => {
      const matchesSearch =
        !searchTerm ||
        product.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        product.description?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        product.brand?.name?.toLowerCase().includes(searchTerm.toLowerCase());

      const productHeatRank = resolveHeatRank(product.heatLevel);
      const productHeatCategory = resolveHeatCategory(productHeatRank);

      const matchesHeatLevel =
        !selectedHeatLevel || productHeatCategory === selectedHeatLevel;

      const matchesChilliType =
        !selectedChilliType ||
        (Array.isArray(product.chilliTypes) &&
          product.chilliTypes.some(
            (ct) =>
              ct?.id?.toString() === selectedChilliType ||
              ct?.name === selectedChilliType,
          ));

      const allCategories = product.categories?.length
        ? product.categories
        : product.category
          ? [product.category]
          : [];
      const matchesCategory =
        !selectedCategory ||
        (selectedCategory === "sauces"
          ? allCategories.some((c) => HEAT_BAND_SLUGS.has(c.slug))
          : allCategories.some(
              (c) =>
                c.id?.toString() === selectedCategory ||
                c.slug === selectedCategory,
            ));

      const matchesBrand =
        !selectedBrand ||
        product.brand?.id?.toString() === selectedBrand ||
        product.brand?.slug === selectedBrand;

      const matchesCountry =
        !selectedCountry || product.brand?.country === selectedCountry;

      const matchesStock = !hideOutOfStock || (product.in_stock ?? true);

      const matchesSale =
        !onlySale ||
        (!!product.on_sale &&
          (isOnSale(product) || (product.variants ?? []).some((v) => isOnSale(product, v))));

      return (
        matchesSearch &&
        matchesHeatLevel &&
        matchesChilliType &&
        matchesCategory &&
        matchesBrand &&
        matchesCountry &&
        matchesStock &&
        matchesSale
      );
    });

    // When a heat-band filter is active, default to browsing that band in
    // ascending heat order -- sorting by popularity within an
    // already-heat-narrowed view doesn't match what picking "1-4" implies.
    // An explicit sort choice (price, newest, hot-first) still wins.
    if (sortBy === "mild-first" || (!sortBy && selectedHeatLevel)) {
      filtered = [...filtered].sort((a, b) => {
        const aLevel = resolveHeatRank(a.heatLevel);
        const bLevel = resolveHeatRank(b.heatLevel);
        return (aLevel ?? 999) - (bLevel ?? 999);
      });
    } else if (sortBy === "hot-first") {
      filtered = [...filtered].sort((a, b) => {
        const aLevel = resolveHeatRank(a.heatLevel);
        const bLevel = resolveHeatRank(b.heatLevel);
        return (bLevel ?? -1) - (aLevel ?? -1);
      });
    } else if (sortBy === "price-asc") {
      filtered = [...filtered].sort(
        (a, b) => getEffectivePriceCents(a) - getEffectivePriceCents(b),
      );
    } else if (sortBy === "price-desc") {
      filtered = [...filtered].sort(
        (a, b) => getEffectivePriceCents(b) - getEffectivePriceCents(a),
      );
    } else if (sortBy === "newest") {
      filtered = [...filtered].sort((a, b) => {
        const aDate = a.created_at ? new Date(a.created_at).getTime() : 0;
        const bDate = b.created_at ? new Date(b.created_at).getTime() : 0;
        return bDate - aDate;
      });
    } else {
      // Popular — most reviewed first, then highest rated
      filtered = [...filtered].sort(
        (a, b) =>
          (b.reviewCount ?? 0) - (a.reviewCount ?? 0) ||
          (b.avgRating ?? 0) - (a.avgRating ?? 0),
      );
    }

    return filtered;
  }, [
    products,
    searchTerm,
    selectedHeatLevel,
    selectedChilliType,
    selectedCategory,
    selectedBrand,
    selectedCountry,
    sortBy,
    hideOutOfStock,
    onlySale,
  ]);

  // Group by heat band when in default "popular" sort and no heat filter active.
  // Falls back to null (flat view) if no products have a heat level.
  const productGroups = useMemo(() => {
    if (sortBy || selectedHeatLevel) return null;

    const bandMap = new Map<HeatBand, StoreProduct[]>();
    const noBand: StoreProduct[] = [];

    for (const product of filteredAndSortedProducts) {
      const band = resolveHeatCategory(resolveHeatRank(product.heatLevel)) as HeatBand | null;
      if (band) {
        if (!bandMap.has(band)) bandMap.set(band, []);
        bandMap.get(band)!.push(product);
      } else {
        noBand.push(product);
      }
    }

    const groups: Array<{ band: HeatBand | null; products: StoreProduct[] }> = [];
    for (const band of HEAT_ORDER) {
      const prods = bandMap.get(band);
      if (prods?.length) {
        // Bands (Very Hot, Super Hot, etc.) span several heat levels each --
        // sort ascending within the band too, not just by popularity, so
        // e.g. a filtered "Extracts" list still reads mild-to-hot inside
        // "Super Hot" instead of jumping 20, 15, 12.
        const sorted = [...prods].sort(
          (a, b) => (resolveHeatRank(a.heatLevel) ?? 999) - (resolveHeatRank(b.heatLevel) ?? 999),
        );
        groups.push({ band, products: sorted });
      }
    }
    if (noBand.length) groups.push({ band: null, products: noBand });

    // Only use grouped view if at least one heat-banded group exists
    return groups.some((g) => g.band !== null) ? groups : null;
  }, [filteredAndSortedProducts, sortBy, selectedHeatLevel]);

  const activeFilters = useMemo(() => {
    const filters: Array<{ label: string; value: string; clear: () => void }> =
      [];
    if (selectedHeatLevel) {
      filters.push({
        label: `Heat: ${selectedHeatLevel}`,
        value: `heat-${selectedHeatLevel}`,
        clear: () => setSelectedHeatLevel(""),
      });
    }
    if (selectedCategory) {
      const cat = typeCategories.find(
        (cat) =>
          cat.id.toString() === selectedCategory ||
          cat.slug === selectedCategory,
      );
      const catName = cat?.name || selectedCategory;
      filters.push({
        label: `Type: ${catName}`,
        value: `cat-${selectedCategory}`,
        clear: () => setSelectedCategory(""),
      });
    }
    if (selectedBrand) {
      const brand = brands.find(
        (b) => b.id.toString() === selectedBrand || b.slug === selectedBrand,
      );
      const brandName = brand?.name || selectedBrand;
      filters.push({
        label: `Producer: ${brandName}`,
        value: `brand-${selectedBrand}`,
        clear: () => setSelectedBrand(""),
      });
    }
    if (selectedCountry) {
      filters.push({
        label: `Country: ${selectedCountry}`,
        value: `country-${selectedCountry}`,
        clear: () => setSelectedCountry(""),
      });
    }
    return filters;
  }, [
    selectedHeatLevel,
    selectedCategory,
    selectedBrand,
    selectedCountry,
    typeCategories,
    brands,
  ]);

  const selectedPepper = useMemo(() => {
    if (!selectedChilliType) return null;
    return chilliTypes.find((ct) => ct.id.toString() === selectedChilliType);
  }, [selectedChilliType, chilliTypes]);

  const hasActiveFilters =
    !!searchTerm ||
    !!selectedHeatLevel ||
    !!selectedChilliType ||
    !!selectedCategory ||
    !!selectedBrand ||
    !!selectedCountry ||
    onlySale ||
    !!sortBy;

  const secondaryFilterCount = activeFilters.length + (selectedChilliType ? 1 : 0);

  const clearActiveFilters = () => {
    setSearchTerm("");
    setSelectedHeatLevel("");
    setSelectedChilliType("");
    setSelectedCategory("");
    setSelectedBrand("");
    setSelectedCountry("");
  };

  const clearAllFilters = () => {
    clearActiveFilters();
    setSortBy("");
    setDisplayCount(12);
    setHideOutOfStock(true);
    setOnlySale(false);
  };

  const displayedProducts = filteredAndSortedProducts.slice(0, displayCount);
  const hasMore = filteredAndSortedProducts.length > displayCount;

  return (
    <div className="py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">
        {/* Filter Section */}
        <section className="border-b border-border pb-5 mb-8">

          {/* ── Mobile/tablet (< lg): search + sort always visible, rest collapsible ── */}
          <div className="lg:hidden flex flex-col gap-3">
            <label className="block text-sm font-medium text-foreground">
              {t("search.label")}
              <input
                type="search"
                placeholder={t("search.placeholder")}
                value={searchTerm}
                onChange={(e) => { clearActiveFilters(); setSearchTerm(e.target.value); }}
                className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2.5 text-base text-foreground focus:outline-none focus:ring-2 focus:ring-brand-red"
              />
            </label>

            <div className="flex gap-2 items-end">
              <label className="flex-1 min-w-0 block text-sm font-medium text-foreground">
                {t("search.filters.sort")}
                <select
                  value={sortBy || "popular"}
                  onChange={(e) => setSortBy(e.target.value as SortOption)}
                  className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2.5 text-base text-foreground focus:outline-none focus:ring-2 focus:ring-brand-red"
                >
                  <option value="popular">{t("search.filters.sortPopular")}</option>
                  <option value="newest">{t("search.filters.sortNewest")}</option>
                  <option value="mild-first">{t("search.filters.sortMildToHot")}</option>
                  <option value="hot-first">{t("search.filters.sortHotToMild")}</option>
                  <option value="price-asc">{t("search.filters.sortPriceLowHigh") || "Price: Low to High"}</option>
                  <option value="price-desc">{t("search.filters.sortPriceHighLow") || "Price: High to Low"}</option>
                </select>
              </label>
              <button
                onClick={() => setFiltersOpen((v) => !v)}
                aria-expanded={filtersOpen}
                aria-controls="mobile-filters-panel"
                className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-2.5 rounded-lg border text-sm font-semibold transition-colors ${
                  filtersOpen || secondaryFilterCount > 0
                    ? "border-brand-red bg-brand-red/5 text-brand-red"
                    : "border-border text-foreground hover:border-brand-red"
                }`}
              >
                Filters{secondaryFilterCount > 0 ? ` (${secondaryFilterCount})` : ""}
                <span className={`inline-block leading-none transition-transform duration-200 ${filtersOpen ? "rotate-180" : ""}`}>▾</span>
              </button>
            </div>

            {filtersOpen && (
              <div id="mobile-filters-panel" className="flex flex-col gap-3 border-t border-border pt-3">
                <label className="block text-sm font-medium text-foreground">
                  {t("search.filters.heatLevel")}
                  <select value={selectedHeatLevel} onChange={(e) => { clearActiveFilters(); setSelectedHeatLevel(e.target.value); }} className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2.5 text-base text-foreground focus:outline-none focus:ring-2 focus:ring-brand-red">
                    <option value="">All Heat Levels</option>
                    {["mild", "medium", "hot", "veryHot", "superHot"].map((level) => (
                      <option key={level} value={level}>{t(`search.filters.heatLevels.${level}`)}</option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm font-medium text-foreground">
                  Producer
                  <select value={selectedBrand} onChange={(e) => { clearActiveFilters(); setSelectedBrand(e.target.value); }} className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2.5 text-base text-foreground focus:outline-none focus:ring-2 focus:ring-brand-red">
                    <option value="">All Producers</option>
                    {brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}
                  </select>
                </label>
                <label className="block text-sm font-medium text-foreground">
                  {t("search.filters.country")}
                  <select value={selectedCountry} onChange={(e) => { clearActiveFilters(); setSelectedCountry(e.target.value); }} className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2.5 text-base text-foreground focus:outline-none focus:ring-2 focus:ring-brand-red">
                    <option value="">{t("search.filters.allCountries")}</option>
                    {countries.map((country) => <option key={country} value={country}>{country}</option>)}
                  </select>
                </label>
                <label className="block text-sm font-medium text-foreground">
                  {t("search.filters.sauceType")}
                  <select value={selectedCategory} onChange={(e) => { clearActiveFilters(); setSelectedCategory(e.target.value); }} className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2.5 text-base text-foreground focus:outline-none focus:ring-2 focus:ring-brand-red">
                    <option value="">{t("search.filters.allCategories")}</option>
                    {typeCategories.map((category) => <option key={category.slug} value={category.slug}>{category.name}</option>)}
                  </select>
                </label>
                <label className="block text-sm font-medium text-foreground">
                  {t("search.filters.pepper")}
                  <select value={selectedChilliType} onChange={(e) => { clearActiveFilters(); setSelectedChilliType(e.target.value); }} className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2.5 text-base text-foreground focus:outline-none focus:ring-2 focus:ring-brand-red">
                    <option value="">{t("search.filters.allChilliTypes")}</option>
                    {chilliTypes.map((chilliType) => <option key={chilliType.id} value={chilliType.id}>{chilliType.name}</option>)}
                  </select>
                </label>
              </div>
            )}
          </div>

          {/* ── Desktop (lg+): original 7-column grid ── */}
          <div className="hidden lg:grid lg:grid-cols-7 gap-3">
            <label className="block text-sm font-medium text-foreground">
              {t("search.label")}
              <input
                type="search"
                placeholder={t("search.placeholder")}
                value={searchTerm}
                onChange={(e) => { clearActiveFilters(); setSearchTerm(e.target.value); }}
                className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2.5 text-base text-foreground focus:outline-none focus:ring-2 focus:ring-brand-red"
              />
            </label>
            <label className="block text-sm font-medium text-foreground">
              {t("search.filters.heatLevel")}
              <select value={selectedHeatLevel} onChange={(e) => { clearActiveFilters(); setSelectedHeatLevel(e.target.value); }} className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2.5 text-base text-foreground focus:outline-none focus:ring-2 focus:ring-brand-red">
                <option value="">All Heat Levels</option>
                {["mild", "medium", "hot", "veryHot", "superHot"].map((level) => (
                  <option key={level} value={level}>{t(`search.filters.heatLevels.${level}`)}</option>
                ))}
              </select>
            </label>
            <label className="block text-sm font-medium text-foreground">
              Producer
              <select value={selectedBrand} onChange={(e) => { clearActiveFilters(); setSelectedBrand(e.target.value); }} className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2.5 text-base text-foreground focus:outline-none focus:ring-2 focus:ring-brand-red">
                <option value="">All Producers</option>
                {brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}
              </select>
            </label>
            <label className="block text-sm font-medium text-foreground">
              {t("search.filters.country")}
              <select value={selectedCountry} onChange={(e) => { clearActiveFilters(); setSelectedCountry(e.target.value); }} className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2.5 text-base text-foreground focus:outline-none focus:ring-2 focus:ring-brand-red">
                <option value="">{t("search.filters.allCountries")}</option>
                {countries.map((country) => <option key={country} value={country}>{country}</option>)}
              </select>
            </label>
            <label className="block text-sm font-medium text-foreground">
              {t("search.filters.sauceType")}
              <select value={selectedCategory} onChange={(e) => { clearActiveFilters(); setSelectedCategory(e.target.value); }} className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2.5 text-base text-foreground focus:outline-none focus:ring-2 focus:ring-brand-red">
                <option value="">{t("search.filters.allCategories")}</option>
                {typeCategories.map((category) => <option key={category.slug} value={category.slug}>{category.name}</option>)}
              </select>
            </label>
            <label className="block text-sm font-medium text-foreground">
              {t("search.filters.sort")}
              <select value={sortBy || "popular"} onChange={(e) => setSortBy(e.target.value as SortOption)} className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2.5 text-base text-foreground focus:outline-none focus:ring-2 focus:ring-brand-red">
                <option value="popular">{t("search.filters.sortPopular")}</option>
                <option value="newest">{t("search.filters.sortNewest")}</option>
                <option value="mild-first">{t("search.filters.sortMildToHot")}</option>
                <option value="hot-first">{t("search.filters.sortHotToMild")}</option>
                <option value="price-asc">{t("search.filters.sortPriceLowHigh") || "Price: Low to High"}</option>
                <option value="price-desc">{t("search.filters.sortPriceHighLow") || "Price: High to Low"}</option>
              </select>
            </label>
            <label className="block text-sm font-medium text-foreground">
              {t("search.filters.pepper")}
              <select value={selectedChilliType} onChange={(e) => { clearActiveFilters(); setSelectedChilliType(e.target.value); }} className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2.5 text-base text-foreground focus:outline-none focus:ring-2 focus:ring-brand-red">
                <option value="">{t("search.filters.allChilliTypes")}</option>
                {chilliTypes.map((chilliType) => <option key={chilliType.id} value={chilliType.id}>{chilliType.name}</option>)}
              </select>
            </label>
          </div>

          {/* Out of stock / Sale toggles */}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={() => setHideOutOfStock(!hideOutOfStock)}
              className={`inline-flex items-center gap-2 text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${
                hideOutOfStock
                  ? "bg-zinc-100 border-zinc-300 text-zinc-500 hover:border-brand-red hover:text-brand-red"
                  : "bg-brand-red/10 border-brand-red text-brand-red"
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${hideOutOfStock ? "bg-zinc-400" : "bg-brand-red"}`} />
              {hideOutOfStock ? t("search.filters.showOutOfStock") : t("search.filters.hideOutOfStock")}
            </button>
            <button
              onClick={() => setOnlySale(!onlySale)}
              className={`inline-flex items-center gap-2 text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${
                onlySale
                  ? "bg-brand-red/10 border-brand-red text-brand-red"
                  : "bg-zinc-100 border-zinc-300 text-zinc-500 hover:border-brand-red hover:text-brand-red"
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${onlySale ? "bg-brand-red" : "bg-zinc-400"}`} />
              {t("search.filters.onSale")}
            </button>
          </div>

          {/* Active Filter Chips */}
          {(activeFilters.length > 0 || selectedPepper) && (
            <div className="mt-3 flex flex-wrap gap-2 items-center">
              {selectedPepper && (
                <Chip variant="filter" onRemove={() => setSelectedChilliType("")}>
                  {selectedPepper.name}
                  {selectedPepper.heatLevel ? ` • ${selectedPepper.heatLevel}` : ""}
                </Chip>
              )}
              {activeFilters.map((filter) => (
                <Chip key={filter.value} variant="filter" onRemove={filter.clear}>
                  {filter.label}
                </Chip>
              ))}
            </div>
          )}

          {/* Results count + reset */}
          <div className="mt-3 flex items-center justify-between">
            <p className="text-sm text-text-muted">
              {productGroups
                ? `${filteredAndSortedProducts.length} ${t("results.sauces")}`
                : `${t("results.showing")} ${displayedProducts.length} ${t("results.of")} ${filteredAndSortedProducts.length} ${t("results.sauces")}`}
            </p>
            {hasActiveFilters && (
              <button
                onClick={clearAllFilters}
                className="text-xs font-semibold text-brand-red hover:underline underline-offset-4"
              >
                {t("results.clearFilters")}
              </button>
            )}
          </div>
        </section>

        {filteredAndSortedProducts.length === 0 && (
          <div className="text-center py-12">
            <div className="text-6xl mb-4">{selectedCategory === "merchandise" ? "👕" : "🌶️"}</div>
            <h3 className="text-xl font-bold text-foreground mb-4">
              {selectedCategory === "merchandise"
                ? t("results.noMerchandise")
                : t("results.noResults")}
            </h3>
            {selectedCategory !== "merchandise" && (
              <>
                <p className="text-text-muted">{t("results.adjustSearch")}</p>
                <button
                  onClick={clearAllFilters}
                  className="mt-4 px-4 py-2 rounded-lg border border-border bg-card text-foreground
                           transition-colors hover:border-brand-red hover:bg-brand-red/10"
                >
                  {t("results.clearFilters")}
                </button>
              </>
            )}
          </div>
        )}

        {productGroups ? (
          <div className="space-y-10">
            {productGroups.map(({ band, products }) => (
              <section key={band ?? "other"}>
                <div className="mb-5 flex items-center gap-3">
                  <h2 className="text-base font-bold tracking-widest uppercase text-brand-black whitespace-nowrap">
                    {band ? t(`search.filters.heatLevels.${band}`) : "Other Products"}
                  </h2>
                  <div className="flex-1 border-t border-zinc-200" />
                  <span className="text-xs font-medium text-zinc-400 whitespace-nowrap">{products.length}</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                  {products.map((product) => (
                    <ProductCard key={product.id} product={product} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <>
            {displayedProducts.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {displayedProducts.map((product) => (
                  <ProductCard key={product.id} product={product} />
                ))}
              </div>
            )}
            {hasMore && (
              <div className="mt-8 flex justify-center">
                <button
                  onClick={() => setDisplayCount((prev) => prev + 12)}
                  className="px-4 py-2 rounded-lg border border-border bg-card text-foreground
                           transition-colors font-medium hover:border-brand-red hover:bg-brand-red/10"
                >
                  {t("results.loadMore")}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default function ProductArchive(props: ProductArchiveProps) {
  return (
    <Suspense
      fallback={<div className="p-12 text-center">Loading catalogue...</div>}
    >
      <ProductArchiveContent {...props} />
    </Suspense>
  );
}
