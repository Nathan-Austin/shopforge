insert into public.brands (name, slug, description)
values ('Flagship Brand', 'flagship-brand', 'Default brand for single-store setups.')
on conflict (slug) do nothing;
