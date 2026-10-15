-- Private application submissions for Roblox Editors List.
-- Browser users must never receive direct read access to this table.
-- Cloudflare Pages Functions use the server-only Supabase service-role key.

create table if not exists public.editor_applications (
  id uuid primary key default gen_random_uuid(),
  display_name text not null check (char_length(display_name) between 2 and 50),
  platform text not null check (platform in ('TikTok', 'YouTube')),
  profile_url text not null,
  software text not null check (char_length(software) between 2 and 120),
  styles text[] not null check (cardinality(styles) between 1 and 8),
  examples_url text not null,
  notes text check (notes is null or char_length(notes) <= 1000),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

create index if not exists editor_applications_status_created_idx
  on public.editor_applications (status, created_at desc);

alter table public.editor_applications enable row level security;

-- Intentionally no anon/authenticated policies. All reads and writes go through
-- the server-side Cloudflare Functions, which check ADMIN_PASSWORD for reviews.
