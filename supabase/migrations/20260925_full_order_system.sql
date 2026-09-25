-- 能量工作室：完整訂單系統 migration

create sequence if not exists public.order_number_seq;

-- 訂單改由 serverless API 建立，避免訪客直接寫入資料庫。
drop policy if exists "Allow public order inserts" on public.orders;
drop policy if exists "Allow public order Inserts" on public.orders;
drop policy if exists "Allow public order Inserts authenticated" on public.orders;

alter table public.orders
  add column if not exists order_number text,
  add column if not exists material_path text,
  add column if not exists payment_status text not null default 'unpaid',
  add column if not exists stripe_session_id text;

update public.orders
set order_number = 'TON-' || to_char(created_at, 'YYYYMMDD') || '-' || lpad(nextval('public.order_number_seq')::text, 4, '0')
where order_number is null;

select setval(
  'public.order_number_seq',
  greatest(
    coalesce(
      (select max((regexp_match(order_number, '-([0-9]+)$'))[1]::bigint)
       from public.orders
       where order_number is not null),
      0
    ),
    0
  ),
  true
);

alter table public.orders
  alter column order_number set not null;

create unique index if not exists orders_order_number_key
  on public.orders(order_number);

create or replace function public.set_order_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.order_number is null or new.order_number = '' then
    new.order_number := 'TON-' || to_char(coalesce(new.created_at, now()), 'YYYYMMDD') || '-' || lpad(nextval('public.order_number_seq')::text, 4, '0');
  end if;
  return new;
end;
$$;

drop trigger if exists orders_set_order_number on public.orders;
create trigger orders_set_order_number
before insert on public.orders
for each row execute function public.set_order_number();

create or replace function public.lookup_order(
  p_order_number text,
  p_contact text
)
returns table (
  order_number text,
  created_at timestamptz,
  service text,
  package text,
  price numeric,
  customer_name text,
  contact_type text,
  details text,
  status text,
  payment_status text,
  material_path text
)
language sql
security definer
set search_path = public
as $$
  select
    o.order_number,
    o.created_at,
    o.service,
    o.package,
    o.price,
    o.customer_name,
    o.contact_type,
    o.details,
    o.status,
    o.payment_status,
    o.material_path
  from public.orders o
  where upper(o.order_number) = upper(trim(p_order_number))
    and lower(trim(o.contact)) = lower(trim(p_contact))
  limit 1;
$$;

revoke all on function public.lookup_order(text, text) from public;
grant execute on function public.lookup_order(text, text) to anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit)
values ('materials', 'materials', false, 524288000)
on conflict (id) do update set public = false, file_size_limit = 524288000;

create policy "Public can upload commission materials"
on storage.objects
for insert to anon
with check (bucket_id = 'materials');

create policy "Authenticated admins can read commission materials"
on storage.objects
for select to authenticated
using (bucket_id = 'materials');
