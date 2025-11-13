insert into public.brands (name, slug, description, country)
values ('House Brand', 'house-brand', 'Default brand for single-store mode.', 'US')
on conflict (slug) do nothing;
