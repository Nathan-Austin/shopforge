# Database migrations

Every file here is copied into a generated shop's `supabase/migrations/` and
pushed in filename order. They replace the single `store-modes/<mode>/schema.sql`
that shops generated before 2026-11-06 were built from.

## Where the files come from

| Source | Copied to | Notes |
| --- | --- | --- |
| `store-modes/<mode>/migrations/0001_init.sql` | `0001_init.sql` | The base schema. The only migration that differs per store mode |
| `lib/migrations/00NN_*.sql` | same name | Feature migrations, shared by every store mode |
| `store-modes/<mode>/seeds.sql` | `0100_seeds.sql` | Example categories, brands and (chilli) pepper types |
| `store-modes/<mode>/brand-single.sql` | `0101_brand_single.sql` | Single-brand shops only |
| `lib/migrations/0102_storage_policies.sql` | same name | Policies on the `product-images` bucket |

A store mode may override any shared file by shipping one with the same name
in its own `migrations/` directory; the mode's copy wins.

## Numbering

- **0001–0099** — schema. Add the next free number here.
- **0100+** — seed data and storage policies, which always run last.

The gap is deliberate. Seeds used to be `0002_seeds.sql`, so a new schema
migration would eventually have collided with the number a live shop had
already applied. Keeping the two bands apart means a number, once shipped,
always means the same file.

## Adding a migration

Append a new file; never edit a shipped one. A shop that has already applied
`0007` must be able to reach the current schema by running only the files
numbered above it. Editing `0007` in place leaves those shops behind — that is
the failure this layout exists to prevent.

Every file must be safe to run twice: `create table if not exists`,
`create or replace function`, `drop policy if exists` before `create policy`,
`add column if not exists`. `test/check-schema.sh` applies the whole series
twice against a scratch Postgres and fails if the second pass errors.

## Upgrading a live shop

Copy the files your shop does not have yet into its own
`supabase/migrations/`, then run `npx supabase@3 db push --remote`. The header
of each file says what it adds and which migration it needs. Running one you
already have is harmless.
