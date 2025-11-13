insert into public.categories (name, slug, description)
values
  ('Classic Hot Sauce', 'classic-hot-sauce', 'Everyday pepper sauces for any meal.'),
  ('Fermented', 'fermented', 'Complex tang from slow fermentation.'),
  ('Smoky', 'smoky', 'Smoldering sauces with fire-roasted peppers.'),
  ('Fruit-Forward', 'fruit-forward', 'Bright, juicy blends with tropical fruit.')
on conflict (slug) do nothing;

insert into public.chilli_types (name, slug, heat_level, description)
values
  ('Jalapeño', 'jalapeno', 'Mild', 'Balanced green pepper heat.'),
  ('Habanero', 'habanero', 'Hot', 'Fiery citrus aroma and heat.'),
  ('Ghost Pepper', 'ghost-pepper', 'Extreme', 'Naga jolokia intensity for thrill seekers.'),
  ('Carolina Reaper', 'carolina-reaper', 'Extreme', 'World-beating heat with fruity notes.')
on conflict (slug) do nothing;
