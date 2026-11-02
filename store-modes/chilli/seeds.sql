insert into public.categories (name, slug, description)
values
  ('Classic Hot Sauce', 'classic-hot-sauce', 'Everyday pepper sauces for any meal.'),
  ('Fermented', 'fermented', 'Complex tang from slow fermentation.'),
  ('Smoky', 'smoky', 'Smoldering sauces with fire-roasted peppers.'),
  ('Fruit-Forward', 'fruit-forward', 'Bright, juicy blends with tropical fruit.')
on conflict (slug) do nothing;

-- heat_level is numeric. __HEAT_n__ is written on a 0-10 basis and rescaled
-- by the generator to whatever heat scale the shop chose.
insert into public.chilli_types (name, slug, heat_level, description)
values
  ('Jalapeño', 'jalapeno', __HEAT_3__, 'Balanced green pepper heat.'),
  ('Habanero', 'habanero', __HEAT_7__, 'Fiery citrus aroma and heat.'),
  ('Ghost Pepper', 'ghost-pepper', __HEAT_9__, 'Naga jolokia intensity for thrill seekers.'),
  ('Carolina Reaper', 'carolina-reaper', __HEAT_10__, 'World-beating heat with fruity notes.')
on conflict (slug) do nothing;
