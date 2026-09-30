-- TON618 Studio 作品資料表
create table if not exists public.works (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  category text not null check (category in ('video','music')),
  storage_path text not null unique,
  file_name text not null,
  extension text not null,
  mime_type text not null default 'application/octet-stream',
  created_at timestamptz not null default now()
);

alter table public.works enable row level security;

create policy "Public can view works records"
on public.works for select
to public
using (true);

create policy "Authenticated can insert works records"
on public.works for insert
to authenticated
with check (true);

create policy "Authenticated can update works records"
on public.works for update
to authenticated
using (true)
with check (true);

create policy "Authenticated can delete works records"
on public.works for delete
to authenticated
using (true);
