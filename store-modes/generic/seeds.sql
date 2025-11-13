insert into public.categories (name, slug, description)
values
  ('Featured', 'featured', 'Curated picks for the week.'),
  ('Essentials', 'essentials', 'Everyday products for any customer.'),
  ('Gifts', 'gifts', 'Packs and present-ready bundles.'),
  ('Accessories', 'accessories', 'Add-ons and merch to complement the line.')
on conflict (slug) do nothing;

insert into public.brands (name, slug, description)
values
  ('Bright Goods', 'bright-goods', 'Independent makers with vibrant products.'),
  ('Everyday Supply', 'everyday-supply', 'Simple staples produced in small batches.')
on conflict (slug) do nothing;
