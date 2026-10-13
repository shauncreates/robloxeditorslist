-- Roblox Editors List data migration for Cloudflare Pages Functions.
-- This can be applied to the same Supabase project as Seeshaun Hub.
-- The service-role key must only be configured as a Cloudflare secret, never in browser code.

create table if not exists public.roblox_editor_site_data (
  id text primary key check (id = 'site-data'),
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.roblox_editor_site_data enable row level security;

-- No anon/authenticated policies are intentionally created: the Cloudflare server
-- reads and writes using the service-role key. Keep that key private.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'editor-avatars',
  'editor-avatars',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;
