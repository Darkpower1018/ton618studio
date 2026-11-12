-- TON618: allow member discounts and coupon codes to target selected services.
-- An empty services array means the offer applies to every service.

alter table public.discounts
  add column if not exists services text[] not null default '{}'::text[];

alter table public.coupons
  add column if not exists services text[] not null default '{}'::text[];

comment on column public.discounts.services is
  'Service names eligible for this member discount; empty array means all services.';

comment on column public.coupons.services is
  'Service names eligible for this coupon; empty array means all services.';
