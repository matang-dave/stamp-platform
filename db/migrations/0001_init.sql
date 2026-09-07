-- Multi-tenant from day 1: every tenant-owned row carries cafe_id.
-- Tenancy rule: cafe_id is always derived server-side from the staff session
-- or the scanned pass — never accepted from client input.

create table cafes (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  slug          text not null unique,          -- used in enrollment URL /c/<slug>
  brand_color   text not null default '#000000',
  logo_url      text,
  stamps_required   int  not null default 10,
  voucher_expiry_days int,                     -- null = vouchers never expire
  status        text not null default 'active' check (status in ('active', 'disabled')),
  created_at    timestamptz not null default now()
);

create table staff (
  id            uuid primary key default gen_random_uuid(),
  cafe_id       uuid not null references cafes(id),
  name          text not null,
  role          text not null check (role in ('owner', 'barista')),
  pin_hash      text not null,
  status        text not null default 'active' check (status in ('active', 'disabled')),
  created_at    timestamptz not null default now()
);
create index staff_cafe_idx on staff(cafe_id);

create table passes (
  id            uuid primary key default gen_random_uuid(),
  cafe_id       uuid not null references cafes(id),
  platform      text not null check (platform in ('apple', 'google')),
  stamps        int  not null default 0,
  email         text,                          -- optional, GDPR: deletable
  marketing_consent_at timestamptz,            -- null = no consent given
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz
);
create index passes_cafe_idx on passes(cafe_id);

create table vouchers (
  id            uuid primary key default gen_random_uuid(),
  pass_id       uuid not null references passes(id),
  created_at    timestamptz not null default now(),
  expires_at    timestamptz,                   -- set from cafe config at earn time; never retroactive
  redeemed_at   timestamptz,
  redeemed_by   uuid references staff(id)
);
create index vouchers_pass_idx on vouchers(pass_id);

create table events (
  id            bigint generated always as identity primary key,
  cafe_id       uuid not null references cafes(id),
  staff_id      uuid references staff(id),
  pass_id       uuid references passes(id),
  action        text not null,                 -- stamp | stamp_bulk | voucher_earned | voucher_redeemed | enroll | ...
  detail        jsonb,
  created_at    timestamptz not null default now()
);
create index events_cafe_idx on events(cafe_id, created_at);

create table wallet_registrations (
  id            uuid primary key default gen_random_uuid(),
  pass_id       uuid not null references passes(id),
  platform      text not null check (platform in ('apple', 'google')),
  device_id     text not null,
  push_token    text not null,
  created_at    timestamptz not null default now(),
  unique (pass_id, device_id)
);
