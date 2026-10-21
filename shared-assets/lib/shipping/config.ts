/**
 * Shipping Configuration
 *
 * Box dimensions and product weights for DHL shipping calculations
 */

// ==================== BOX CONFIGURATION ====================

export const BOX_CONFIG = {
  /** Box dimensions in millimeters */
  dimensions: {
    length: 230,
    width: 155,
    height: 90,
  },
  /** Empty box weight in grams */
  weightGrams: 100,
} as const;

// ==================== PRODUCT WEIGHTS ====================

/**
 * Product weights in grams
 * Used to calculate total package weight for shipping
 */
export const PRODUCT_WEIGHTS = {
  /** Sauce bottles by capacity (ml) */
  bottles: {
    100: 280,  // 100ml bottle = 280g
    200: 450,  // 200ml bottle = 450g
  },

  /** Merchandise weights */
  merch: {
    tshirt: 250,  // T-shirt = 250g (all sizes)
    hoodie: {
      default: 800,  // Hoodie up to XL = 800g
      '2XL': 1000,   // Hoodie 2XL = 1000g
    },
  },
} as const;

// ==================== WEIGHT CALCULATION ====================

export interface OrderItem {
  productName: string;
  quantity: number;
  capacityMl?: number | null;
  selectedSize?: string | null;
}

/**
 * Determine product type from product name
 */
function getProductType(productName: string): 'bottle' | 'tshirt' | 'hoodie' | 'unknown' {
  const name = productName.toLowerCase();

  if (name.includes('hoodie') || name.includes('hoody')) {
    return 'hoodie';
  }
  if (name.includes('t-shirt') || name.includes('tshirt') || name.includes('tee')) {
    return 'tshirt';
  }
  // Assume sauce/bottle for other products (main product line)
  if (name.includes('sauce') || name.includes('hot') || name.includes('chili') || name.includes('chilli')) {
    return 'bottle';
  }

  return 'unknown';
}

/**
 * Get weight for a single product item in grams
 */
export function getProductWeight(item: OrderItem): number {
  const productType = getProductType(item.productName);

  switch (productType) {
    case 'bottle': {
      // Use capacity if available, otherwise default to 100ml
      const capacity = item.capacityMl || 100;
      const bottleWeight = PRODUCT_WEIGHTS.bottles[capacity as keyof typeof PRODUCT_WEIGHTS.bottles];
      return bottleWeight || PRODUCT_WEIGHTS.bottles[100]; // Fallback to 100ml weight
    }

    case 'tshirt':
      return PRODUCT_WEIGHTS.merch.tshirt;

    case 'hoodie': {
      // Check if 2XL size
      const size = item.selectedSize?.toUpperCase();
      if (size === '2XL' || size === 'XXL') {
        return PRODUCT_WEIGHTS.merch.hoodie['2XL'];
      }
      return PRODUCT_WEIGHTS.merch.hoodie.default;
    }

    default:
      // Unknown product - estimate as 100ml bottle weight
      console.warn(`[Shipping] Unknown product type for "${item.productName}", using default weight`);
      return PRODUCT_WEIGHTS.bottles[100];
  }
}

/**
 * Calculate total package weight for an order
 * Returns weight in kilograms (as required by DHL API)
 */
export function calculatePackageWeight(items: OrderItem[]): number {
  let totalGrams = BOX_CONFIG.weightGrams; // Start with box weight

  for (const item of items) {
    const itemWeight = getProductWeight(item);
    totalGrams += itemWeight * item.quantity;
  }

  // Convert to kg and round to 2 decimal places
  const weightKg = Math.round(totalGrams) / 1000;

  // DHL minimum weight is 0.01 kg
  return Math.max(0.01, weightKg);
}

/**
 * Get box dimensions for DHL API
 * Returns dimensions in centimeters (as required by DHL API)
 */
export function getBoxDimensions() {
  return {
    length: BOX_CONFIG.dimensions.length / 10, // mm to cm
    width: BOX_CONFIG.dimensions.width / 10,
    height: BOX_CONFIG.dimensions.height / 10,
  };
}
