/**
 * Product field catalogue.
 *
 * Every field a product can have, in one place. The columns all exist in the
 * database (see supabase/migrations/0001_init.sql); `PRODUCT_FIELD_KEYS` in
 * ./config.ts decides which ones the admin form shows and the server actions
 * persist. That means a shop can switch a field on later without a migration.
 *
 * To add a field: add the column to the schema, add an entry here, and it
 * appears in the form and is saved automatically.
 */

import { PRODUCT_FIELD_KEYS } from './config';

export type ProductFieldType =
  /** Single-line text. */
  | 'text'
  /** Multi-line text. */
  | 'textarea'
  /** Whole number. */
  | 'integer'
  /** Money, entered in major units and stored as cents. */
  | 'cents'
  /** Number with decimals. */
  | 'decimal'
  /** Checkbox, stored as a boolean. */
  | 'boolean'
  /** Checkbox, stored as a timestamp (set when ticked, null when not). */
  | 'timestamp'
  /** Comma-separated input, stored as a text[]. */
  | 'stringList'
  /** Fixed set of values, stored as a text[]. */
  | 'multiSelect'
  /** Number plus a unit dropdown, stored in two columns. */
  | 'measure'
  /** The per-100g/ml nutrition grid, stored as jsonb. */
  | 'nutrition'
  /** Length/width/height in mm, stored as jsonb. */
  | 'dimensions';

export interface ProductFieldGroup {
  key: string;
  label: string;
}

export interface ProductField {
  key: string;
  label: string;
  help?: string;
  group: string;
  type: ProductFieldType;
  /** Database column on `products`. */
  column: string;
  /** Second column used by `measure` fields, for the unit. */
  unitColumn?: string;
  /** Choices for `multiSelect`, or units for `measure`. */
  options?: string[];
  /** Only offered for these store modes; omitted means all modes. */
  modes?: string[];
  /** Part of the default selection in the generator. */
  recommended?: boolean;
}

export const PRODUCT_FIELD_GROUPS: ProductFieldGroup[] = [
  { key: 'content', label: 'Content' },
  { key: 'pricing', label: 'Pricing' },
  { key: 'inventory', label: 'Inventory' },
  { key: 'status', label: 'Status' },
  { key: 'physical', label: 'Size and weight' },
  { key: 'food', label: 'Food and safety' },
  { key: 'variants', label: 'Variants' },
  { key: 'media', label: 'Media' },
  { key: 'discovery', label: 'Discovery and SEO' },
  { key: 'chilli', label: 'Chilli' }
];

/**
 * Always saved, never optional: a shop can't sell without them. They are not
 * offered in the generator's field picker.
 */
export const CORE_PRODUCT_COLUMNS = [
  'name',
  'slug',
  'price_cents',
  'currency',
  'image_url',
  'category_id',
  'brand_id'
] as const;

export const PRODUCT_FIELDS: ProductField[] = [
  // --- Content -------------------------------------------------------------
  {
    key: 'headline',
    label: 'Headline',
    help: 'Short tagline shown under the product name.',
    group: 'content',
    type: 'text',
    column: 'headline',
    recommended: true
  },
  {
    key: 'description',
    label: 'Short description',
    help: 'One or two sentences, used on listing pages.',
    group: 'content',
    type: 'textarea',
    column: 'description',
    recommended: true
  },
  {
    key: 'details',
    label: 'Full description',
    help: 'The long copy on the product page.',
    group: 'content',
    type: 'textarea',
    column: 'details',
    recommended: true
  },

  // --- Pricing -------------------------------------------------------------
  {
    key: 'compare_at_price',
    label: 'Compare-at price',
    help: 'Was / RRP, shown struck through next to the price.',
    group: 'pricing',
    type: 'cents',
    column: 'compare_at_price_cents',
    recommended: true
  },
  {
    key: 'cost_price',
    label: 'Cost price',
    help: 'What the item costs you. Admin only, never shown to customers.',
    group: 'pricing',
    type: 'cents',
    column: 'cost_price_cents'
  },
  {
    key: 'tax_rate',
    label: 'Tax / VAT rate (%)',
    group: 'pricing',
    type: 'decimal',
    column: 'tax_rate_percent'
  },

  // --- Inventory -----------------------------------------------------------
  {
    key: 'sku',
    label: 'SKU',
    group: 'inventory',
    type: 'text',
    column: 'sku',
    recommended: true
  },
  {
    key: 'barcode',
    label: 'Barcode (EAN / GTIN)',
    group: 'inventory',
    type: 'text',
    column: 'barcode'
  },
  {
    key: 'stock',
    label: 'Stock quantity',
    group: 'inventory',
    type: 'integer',
    column: 'stock',
    recommended: true
  },
  {
    key: 'track_inventory',
    label: 'Track inventory',
    help: 'Hide or block the product when stock reaches zero.',
    group: 'inventory',
    type: 'boolean',
    column: 'track_inventory',
    recommended: true
  },
  {
    key: 'allow_backorder',
    label: 'Allow backorders',
    group: 'inventory',
    type: 'boolean',
    column: 'allow_backorder'
  },
  {
    key: 'max_order_quantity',
    label: 'Maximum per order',
    group: 'inventory',
    type: 'integer',
    column: 'max_order_quantity'
  },

  // --- Status --------------------------------------------------------------
  {
    key: 'is_active',
    label: 'Published',
    help: 'Unpublished products are hidden from the shop.',
    group: 'status',
    type: 'boolean',
    column: 'is_active',
    recommended: true
  },
  {
    key: 'is_featured',
    label: 'Featured',
    help: 'Highlight on the home page or in a featured row.',
    group: 'status',
    type: 'boolean',
    column: 'is_featured',
    recommended: true
  },
  {
    key: 'archived',
    label: 'Archived',
    help: 'Keeps past orders intact while removing the product from the shop.',
    group: 'status',
    type: 'timestamp',
    column: 'archived_at',
    recommended: true
  },

  // --- Size and weight -----------------------------------------------------
  {
    key: 'net_content',
    label: 'Net content',
    help: 'What the customer receives, e.g. 250 ml or 180 g.',
    group: 'physical',
    type: 'measure',
    column: 'net_content',
    unitColumn: 'net_content_unit',
    options: ['ml', 'l', 'g', 'kg', 'pieces'],
    recommended: true
  },
  {
    key: 'weight_grams',
    label: 'Shipping weight (g)',
    help: 'Packed weight, used for shipping rates.',
    group: 'physical',
    type: 'integer',
    column: 'weight_grams',
    recommended: true
  },
  {
    key: 'dimensions',
    label: 'Dimensions (mm)',
    help: 'Length, width and height of the packed item.',
    group: 'physical',
    type: 'dimensions',
    column: 'dimensions_mm'
  },

  // --- Food and safety -----------------------------------------------------
  {
    key: 'ingredients',
    label: 'Ingredients',
    group: 'food',
    type: 'textarea',
    column: 'ingredients',
    recommended: true
  },
  {
    key: 'allergens',
    label: 'Allergens',
    group: 'food',
    type: 'stringList',
    column: 'allergens',
    recommended: true
  },
  {
    key: 'nutrition_info',
    label: 'Nutrition (per 100 g/ml)',
    group: 'food',
    type: 'nutrition',
    column: 'nutrition_info',
    recommended: true
  },
  {
    key: 'dietary_flags',
    label: 'Dietary',
    group: 'food',
    type: 'multiSelect',
    column: 'dietary_flags',
    options: [
      'vegan',
      'vegetarian',
      'gluten-free',
      'dairy-free',
      'nut-free',
      'organic'
    ],
    recommended: true
  },
  {
    key: 'storage_instructions',
    label: 'Storage instructions',
    group: 'food',
    type: 'textarea',
    column: 'storage_instructions'
  },
  {
    key: 'best_before',
    label: 'Shelf life / best before',
    group: 'food',
    type: 'text',
    column: 'best_before_text'
  },

  // --- Variants ------------------------------------------------------------
  {
    key: 'size_options',
    label: 'Size options',
    group: 'variants',
    type: 'stringList',
    column: 'size_options'
  },
  {
    key: 'color_options',
    label: 'Colour options',
    group: 'variants',
    type: 'stringList',
    column: 'color_options'
  },

  // --- Media ---------------------------------------------------------------
  {
    key: 'gallery_urls',
    label: 'Extra gallery images',
    help: 'Image URLs beyond the main one, one per line or comma separated.',
    group: 'media',
    type: 'stringList',
    column: 'gallery_urls'
  },
  {
    key: 'video_url',
    label: 'Video URL',
    group: 'media',
    type: 'text',
    column: 'video_url'
  },

  // --- Discovery and SEO ---------------------------------------------------
  {
    key: 'tags',
    label: 'Tags',
    group: 'discovery',
    type: 'stringList',
    column: 'tags',
    recommended: true
  },
  {
    key: 'country_of_origin',
    label: 'Country of origin',
    group: 'discovery',
    type: 'text',
    column: 'country_of_origin'
  },
  {
    key: 'meta_title',
    label: 'SEO title',
    group: 'discovery',
    type: 'text',
    column: 'meta_title'
  },
  {
    key: 'meta_description',
    label: 'SEO description',
    group: 'discovery',
    type: 'textarea',
    column: 'meta_description'
  },

  // --- Chilli --------------------------------------------------------------
  {
    key: 'heat_level',
    label: 'Heat level',
    help: 'On the scale set when the shop was generated. Stored as a number.',
    group: 'chilli',
    type: 'integer',
    column: 'heat_level',
    modes: ['chilli'],
    recommended: true
  },
  {
    key: 'scoville_shu',
    label: 'Scoville (SHU)',
    group: 'chilli',
    type: 'integer',
    column: 'scoville_shu',
    modes: ['chilli']
  }
];

const FIELDS_BY_KEY = new Map(PRODUCT_FIELDS.map((field) => [field.key, field]));

/** Every field this shop uses, in catalogue order. */
export function enabledProductFields(): ProductField[] {
  const enabled = new Set<string>(PRODUCT_FIELD_KEYS);
  return PRODUCT_FIELDS.filter((field) => enabled.has(field.key));
}

export function isProductFieldEnabled(key: string): boolean {
  return (PRODUCT_FIELD_KEYS as readonly string[]).includes(key);
}

export function getProductField(key: string): ProductField | undefined {
  return FIELDS_BY_KEY.get(key);
}

/** Enabled fields grouped for rendering, skipping groups with no fields. */
export function enabledProductFieldGroups(): {
  group: ProductFieldGroup;
  fields: ProductField[];
}[] {
  const fields = enabledProductFields();
  return PRODUCT_FIELD_GROUPS.map((group) => ({
    group,
    fields: fields.filter((field) => field.group === group.key)
  })).filter((entry) => entry.fields.length > 0);
}

/** Columns to select for the admin edit form. */
export function productSelectColumns(): string[] {
  const columns = [...CORE_PRODUCT_COLUMNS, 'id'];
  for (const field of enabledProductFields()) {
    columns.push(field.column);
    if (field.unitColumn) columns.push(field.unitColumn);
  }
  return Array.from(new Set(columns));
}

export const NUTRITION_KEYS = [
  { key: 'energy_kj', label: 'Energy (kJ)', step: '0.1' },
  { key: 'energy_kcal', label: 'Energy (kcal)', step: '0.1' },
  { key: 'fat_g', label: 'Fat (g)', step: '0.1' },
  { key: 'saturated_fat_g', label: 'Saturated fat (g)', step: '0.1' },
  { key: 'carbohydrate_g', label: 'Carbohydrate (g)', step: '0.1' },
  { key: 'sugar_g', label: 'Sugar (g)', step: '0.1' },
  { key: 'protein_g', label: 'Protein (g)', step: '0.1' },
  { key: 'salt_g', label: 'Salt (g)', step: '0.01' }
] as const;

export const DIMENSION_KEYS = [
  { key: 'length', label: 'Length' },
  { key: 'width', label: 'Width' },
  { key: 'height', label: 'Height' }
] as const;

function text(formData: FormData, name: string): string | null {
  const value = formData.get(name)?.toString().trim();
  return value ? value : null;
}

function number(formData: FormData, name: string): number | null {
  const raw = text(formData, name);
  if (raw === null) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function list(formData: FormData, name: string): string[] | null {
  const raw = text(formData, name);
  if (raw === null) return null;
  const values = raw
    .split(/[,\n]/)
    .map((value) => value.trim())
    .filter(Boolean);
  return values.length > 0 ? values : null;
}

/**
 * Builds the `products` row for the enabled fields from a submitted form.
 * Core columns are handled by the caller, which validates them.
 */
export function parseProductFields(formData: FormData): Record<string, unknown> {
  return parseProductFieldsFor(enabledProductFields(), formData);
}

/** The same parse against an explicit field list, which is what tests use. */
export function parseProductFieldsFor(
  fields: ProductField[],
  formData: FormData
): Record<string, unknown> {
  const row: Record<string, unknown> = {};

  for (const field of fields) {
    switch (field.type) {
      case 'text':
      case 'textarea':
        row[field.column] = text(formData, field.key);
        break;

      case 'integer': {
        const value = number(formData, field.key);
        row[field.column] = value === null ? null : Math.round(value);
        break;
      }

      case 'decimal':
        row[field.column] = number(formData, field.key);
        break;

      case 'cents': {
        // Entered in major units (12.50) and stored as cents.
        const value = number(formData, field.key);
        row[field.column] = value === null ? null : Math.round(value * 100);
        break;
      }

      case 'boolean':
        row[field.column] = formData.get(field.key) === 'on';
        break;

      case 'timestamp':
        row[field.column] =
          formData.get(field.key) === 'on' ? new Date().toISOString() : null;
        break;

      case 'stringList':
        row[field.column] = list(formData, field.key);
        break;

      case 'multiSelect': {
        const values = formData
          .getAll(field.key)
          .map((value) => value.toString())
          .filter(Boolean);
        row[field.column] = values.length > 0 ? values : null;
        break;
      }

      case 'measure': {
        row[field.column] = number(formData, field.key);
        if (field.unitColumn) {
          row[field.unitColumn] = text(formData, `${field.key}_unit`);
        }
        break;
      }

      case 'nutrition': {
        const nutrition: Record<string, number> = {};
        for (const entry of NUTRITION_KEYS) {
          const value = number(formData, entry.key);
          if (value !== null) nutrition[entry.key] = value;
        }
        row[field.column] =
          Object.keys(nutrition).length > 0 ? nutrition : null;
        break;
      }

      case 'dimensions': {
        const dimensions: Record<string, number> = {};
        for (const entry of DIMENSION_KEYS) {
          const value = number(formData, `${field.key}_${entry.key}`);
          if (value !== null) dimensions[entry.key] = value;
        }
        row[field.column] =
          Object.keys(dimensions).length > 0 ? dimensions : null;
        break;
      }
    }
  }

  return row;
}
