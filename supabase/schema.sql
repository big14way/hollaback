-- Hollaback schema for Supabase (Postgres). Run in the Supabase SQL editor.
-- The server uses the service role key; RLS is enabled with no public policies.

create extension if not exists pgcrypto;

create table if not exists merchants (
  id text primary key,
  name text not null,
  currency text not null default 'USD',
  created_at timestamptz not null default now()
);

insert into merchants (id, name) values ('demo', 'Kicks Lagos') on conflict (id) do nothing;

create table if not exists carts (
  id uuid primary key default gen_random_uuid(),
  merchant_id text not null references merchants(id),
  session_id text,
  shopper_name text,
  shopper_phone text,
  shopper_email text,
  consent boolean not null default false,
  items jsonb not null default '[]'::jsonb,
  total numeric(12,2) not null default 0,
  currency text not null default 'USD',
  paypal_order_id text,
  order_status text,
  payer_action_url text,
  pay_later_eligible boolean not null default true,
  status text not null default 'active'
    check (status in ('active','pending','abandoned','contacted','recovered','paid','declined','expired')),
  abandon_reason text,
  order_created_at timestamptz,
  abandoned_at timestamptz,
  recovered_at timestamptz,
  recovery_channel text,
  recovered_amount numeric(12,2),
  discount_pct numeric(5,2) not null default 0,
  invoice_id text,
  invoice_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists carts_session_idx on carts(session_id);
create index if not exists carts_order_idx on carts(paypal_order_id);
create index if not exists carts_invoice_idx on carts(invoice_id);

create table if not exists conversations (
  id uuid primary key default gen_random_uuid(),
  cart_id uuid not null references carts(id) on delete cascade,
  channel text not null,
  address text not null,
  status text not null default 'open' check (status in ('open','closed')),
  outcome text check (outcome in ('recovered','declined','no_reply','invoice_sent')),
  unanswered integer not null default 0,
  pay_later_offered boolean not null default false,
  started_at timestamptz not null default now(),
  ended_at timestamptz
);
create index if not exists conversations_address_idx on conversations(address, status);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  role text not null check (role in ('agent','shopper','system')),
  body text not null default '',
  tool_call jsonb,
  created_at timestamptz not null default clock_timestamp()
);
create index if not exists messages_conversation_idx on messages(conversation_id, created_at);

create table if not exists webhook_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  resource_id text,
  cart_id uuid references carts(id) on delete set null,
  payload jsonb not null,
  verified boolean not null default false,
  received_at timestamptz not null default now()
);

create table if not exists checkout_events (
  id uuid primary key default gen_random_uuid(),
  cart_id uuid not null references carts(id) on delete cascade,
  type text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp()
);

alter table merchants enable row level security;
alter table carts enable row level security;
alter table conversations enable row level security;
alter table messages enable row level security;
alter table webhook_events enable row level security;
alter table checkout_events enable row level security;
