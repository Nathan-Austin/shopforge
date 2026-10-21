-- Junction table: products <-> categories (many-to-many). products.category_id
-- stays as the primary category; this table holds every category a product is in.
CREATE TABLE IF NOT EXISTS product_categories (
  product_id  UUID NOT NULL REFERENCES products(id)  ON DELETE CASCADE,
  category_id UUID NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  PRIMARY KEY (product_id, category_id)
);

-- Seed from existing primary category_id
INSERT INTO product_categories (product_id, category_id)
SELECT id, category_id
FROM products
WHERE category_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- RLS (mirrors products_chilli_types pattern)
ALTER TABLE product_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "product_categories select"
  ON product_categories FOR SELECT USING (true);

CREATE POLICY "product_categories manage"
  ON product_categories FOR ALL USING (is_shop_owner());
