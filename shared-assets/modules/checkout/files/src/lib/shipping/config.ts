/**
 * Shipping Configuration
 *
 * Box dimensions and product weights for shipping calculations
 */

// ==================== PACKAGING ====================

/** Packaging weight in grams based on product weight (before packaging) */
export function getPackagingWeight(productWeightGrams: number): number {
  if (productWeightGrams < 2000) return 200;
  return 250;
}

// ==================== PRODUCT WEIGHTS ====================

/**
 * Product weights in grams
 * Used to calculate total package weight for shipping
 */
export const PRODUCT_WEIGHTS = {
  /** Sauce bottles by capacity (ml) */
  bottles: {
    100: 280, // 100ml bottle = 280g
    200: 450, // 200ml bottle = 450g
  },

  /** Merchandise weights */
  merch: {
    tshirt: 250, // T-shirt = 250g (all sizes)
    hoodie: {
      default: 800, // Hoodie up to XL = 800g
      "2XL": 1000, // Hoodie 2XL = 1000g
    },
  },
} as const;

// ==================== WEIGHT CALCULATION ====================

export interface OrderItem {
  productName: string;
  quantity: number;
  capacityMl?: number | null;
  selectedSize?: string | null;
  weightGrams?: number | null;
}

/**
 * Determine product type from product name
 */
function getProductType(
  productName: string,
): "bottle" | "tshirt" | "hoodie" | "unknown" {
  const name = productName.toLowerCase();

  if (name.includes("hoodie") || name.includes("hoody")) {
    return "hoodie";
  }
  if (
    name.includes("t-shirt") ||
    name.includes("tshirt") ||
    name.includes("tee")
  ) {
    return "tshirt";
  }
  // Assume sauce/bottle for other products (main product line)
  if (
    name.includes("sauce") ||
    name.includes("hot") ||
    name.includes("chili") ||
    name.includes("chilli")
  ) {
    return "bottle";
  }

  return "unknown";
}

/**
 * Get weight for a single product item in grams
 */
export function getProductWeight(item: OrderItem): number {
  // 1. Priority: Explicit weight from database
  if (item.weightGrams && item.weightGrams > 0) {
    return item.weightGrams;
  }

  // 2. Fallback: Estimate based on product type
  const productType = getProductType(item.productName);

  switch (productType) {
    case "bottle": {
      // Use capacity if available, otherwise default to 100ml
      const capacity = item.capacityMl || 100;
      const bottleWeight =
        PRODUCT_WEIGHTS.bottles[
          capacity as keyof typeof PRODUCT_WEIGHTS.bottles
        ];
      return bottleWeight || PRODUCT_WEIGHTS.bottles[100]; // Fallback to 100ml weight
    }

    case "tshirt":
      return PRODUCT_WEIGHTS.merch.tshirt;

    case "hoodie": {
      // Check if 2XL size
      const size = item.selectedSize?.toUpperCase();
      if (size === "2XL" || size === "XXL") {
        return PRODUCT_WEIGHTS.merch.hoodie["2XL"];
      }
      return PRODUCT_WEIGHTS.merch.hoodie.default;
    }

    default:
      // Unknown product - estimate as 100ml bottle weight
      console.warn(
        `[Shipping] Unknown product type for "${item.productName}", using default weight`,
      );
      return PRODUCT_WEIGHTS.bottles[100];
  }
}

/**
 * Calculate total package weight for an order
 * Returns weight in kilograms
 */
export function calculatePackageWeight(items: OrderItem[]): number {
  let productGrams = 0;

  for (const item of items) {
    productGrams += getProductWeight(item) * item.quantity;
  }

  const totalGrams = productGrams + getPackagingWeight(productGrams);
  return Math.max(0.01, Math.round(totalGrams) / 1000);
}
