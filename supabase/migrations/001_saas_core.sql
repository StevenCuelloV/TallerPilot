-- TallerPilot / Taller Motor Pro - núcleo SaaS multiempresa
-- Ejecutar con Supabase CLI o desde el editor SQL de un proyecto nuevo.
create extension if not exists pgcrypto;

create table public.plans (
  id text primary key,
  name text not null,
  description text not null default '',
  monthly_price_cop integer not null check (monthly_price_cop >= 0),
  annual_price_cop integer not null check (annual_price_cop >= 0),
  limits jsonb not null default '{}'::jsonb,
  features jsonb not null default '[]'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.plans (id,name,description,monthly_price_cop,annual_price_cop,limits,features) values
('esencial','Esencial','Para talleres pequeños que están organizando su operación.',79000,790000,
 '{"users":3,"monthlyOrders":150,"storageGb":2,"locations":1}',
 '["Clientes y vehículos","Órdenes y evidencias","Cotizaciones PDF","WhatsApp manual","Contabilidad básica"]'),
('profesional','Profesional','La operación completa para un taller tecnificado en crecimiento.',149000,1490000,
 '{"users":10,"monthlyOrders":500,"storageGb":10,"locations":1}',
 '["Todo en Esencial","Roles y auditoría","Portal de seguimiento","Automatización de WhatsApp","Reportes avanzados"]'),
('empresarial','Empresarial','Para centros automotrices con varias áreas o sedes.',299000,2990000,
 '{"users":30,"monthlyOrders":2000,"storageGb":50,"locations":3}',
 '["Todo en Profesional","Hasta 3 sedes","MFA obligatorio","Integraciones y API","Soporte prioritario"]')
on conflict (id) do update set
  name=excluded.name, description=excluded.description,
  monthly_price_cop=excluded.monthly_price_cop, annual_price_cop=excluded.annual_price_cop,
  limits=excluded.limits, features=excluded.features;

create table public.workshops (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  legal_name text,
  nit text not null,
  email text not null,
  phone text,
  whatsapp text,
  address text,
  city text,
  status text not null default 'trial' check (status in ('trial','active','past_due','suspended','cancelled')),
  trial_ends_at timestamptz default (now() + interval '14 days'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (nit)
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  document_type text,
  document_number text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  workshop_id uuid not null references public.workshops(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','admin','advisor','technician','accountant','viewer')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (workshop_id,user_id)
);

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  workshop_id uuid not null unique references public.workshops(id) on delete cascade,
  plan_id text not null references public.plans(id),
  status text not null default 'trialing' check (status in ('trialing','pending','active','past_due','cancelled','expired')),
  billing_period text not null check (billing_period in ('monthly','annual')),
  provider text not null default 'wompi',
  provider_payment_source_id text,
  current_period_starts_at timestamptz,
  current_period_ends_at timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.payment_transactions (
  id uuid primary key default gen_random_uuid(),
  workshop_id uuid not null references public.workshops(id) on delete cascade,
  subscription_id uuid references public.subscriptions(id) on delete set null,
  provider text not null default 'wompi',
  reference text not null unique,
  provider_transaction_id text unique,
  amount_in_cents bigint not null check (amount_in_cents > 0),
  currency char(3) not null default 'COP',
  status text not null default 'PENDING',
  billing_period text not null check (billing_period in ('monthly','annual')),
  raw_event jsonb,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  workshop_id uuid not null references public.workshops(id) on delete cascade,
  kind text not null default 'person',
  document_type text not null,
  document_number text not null,
  name text not null,
  phone text not null,
  email text,
  address text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workshop_id,document_number)
);

create table public.vehicles (
  id uuid primary key default gen_random_uuid(),
  workshop_id uuid not null references public.workshops(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  plate text not null,
  brand text,
  model text,
  model_year integer,
  color text,
  mileage integer default 0,
  vin text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workshop_id,plate)
);

create table public.work_orders (
  id uuid primary key default gen_random_uuid(),
  workshop_id uuid not null references public.workshops(id) on delete cascade,
  order_number bigint generated always as identity,
  customer_id uuid not null references public.customers(id),
  vehicle_id uuid not null references public.vehicles(id),
  assigned_user_id uuid references auth.users(id),
  service_area text not null,
  stage text not null default 'Ingreso',
  progress smallint not null default 0 check (progress between 0 and 100),
  reason text,
  diagnosis text,
  final_diagnosis text,
  mileage integer,
  fuel_level text,
  received_items text,
  affected_areas jsonb not null default '[]'::jsonb,
  paint_color text,
  estimated_delivery_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workshop_id,order_number)
);

create table public.order_notes (
  id uuid primary key default gen_random_uuid(),
  workshop_id uuid not null references public.workshops(id) on delete cascade,
  order_id uuid not null references public.work_orders(id) on delete cascade,
  author_user_id uuid references auth.users(id),
  audience text not null default 'internal' check (audience in ('internal','customer','both')),
  body text not null,
  created_at timestamptz not null default now()
);

create table public.order_evidence (
  id uuid primary key default gen_random_uuid(),
  workshop_id uuid not null references public.workshops(id) on delete cascade,
  order_id uuid not null references public.work_orders(id) on delete cascade,
  author_user_id uuid references auth.users(id),
  phase text not null check (phase in ('entry','diagnosis','process','before','after','delivery')),
  storage_path text not null,
  caption text,
  created_at timestamptz not null default now()
);

create table public.quotes (
  id uuid primary key default gen_random_uuid(),
  workshop_id uuid not null references public.workshops(id) on delete cascade,
  order_id uuid not null references public.work_orders(id) on delete cascade,
  status text not null default 'draft' check (status in ('draft','sent','approved','rejected','expired')),
  tax_rate numeric(5,2) not null default 19,
  approved_at timestamptz,
  approval_ip inet,
  approval_token_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.quote_items (
  id uuid primary key default gen_random_uuid(),
  workshop_id uuid not null references public.workshops(id) on delete cascade,
  quote_id uuid not null references public.quotes(id) on delete cascade,
  kind text not null check (kind in ('part','service','material','labor','other')),
  description text not null,
  quantity numeric(12,2) not null check (quantity > 0),
  unit_price_cop bigint not null check (unit_price_cop >= 0),
  created_at timestamptz not null default now()
);

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  workshop_id uuid not null references public.workshops(id) on delete cascade,
  order_id uuid references public.work_orders(id),
  number text not null,
  status text not null default 'draft',
  total_cop bigint not null default 0,
  next_maintenance_at date,
  external_provider_id text,
  created_at timestamptz not null default now(),
  unique (workshop_id,number)
);

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  workshop_id uuid not null references public.workshops(id) on delete cascade,
  order_id uuid references public.work_orders(id),
  category text not null,
  description text not null,
  amount_cop bigint not null check (amount_cop > 0),
  expense_date date not null default current_date,
  created_at timestamptz not null default now()
);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  workshop_id uuid not null references public.workshops(id) on delete cascade,
  actor_user_id uuid references auth.users(id),
  action text not null,
  entity_type text not null,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  ip_hash text,
  created_at timestamptz not null default now()
);

create index memberships_user_idx on public.memberships(user_id,active);
create index customers_workshop_idx on public.customers(workshop_id,created_at desc);
create index vehicles_workshop_idx on public.vehicles(workshop_id,plate);
create index work_orders_workshop_idx on public.work_orders(workshop_id,stage,created_at desc);
create index order_notes_order_idx on public.order_notes(workshop_id,order_id,created_at);
create index order_evidence_order_idx on public.order_evidence(workshop_id,order_id,created_at);
create index payments_workshop_idx on public.payment_transactions(workshop_id,created_at desc);
create index audit_workshop_idx on public.audit_logs(workshop_id,created_at desc);

create or replace function public.is_workshop_member(target_workshop uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select exists(select 1 from public.memberships m where m.workshop_id=target_workshop and m.user_id=auth.uid() and m.active); $$;

create or replace function public.has_workshop_role(target_workshop uuid, allowed_roles text[])
returns boolean language sql stable security definer set search_path = public
as $$ select exists(select 1 from public.memberships m where m.workshop_id=target_workshop and m.user_id=auth.uid() and m.active and m.role=any(allowed_roles)); $$;

alter table public.profiles enable row level security;
alter table public.workshops enable row level security;
alter table public.memberships enable row level security;
alter table public.subscriptions enable row level security;
alter table public.payment_transactions enable row level security;
alter table public.customers enable row level security;
alter table public.vehicles enable row level security;
alter table public.work_orders enable row level security;
alter table public.order_notes enable row level security;
alter table public.order_evidence enable row level security;
alter table public.quotes enable row level security;
alter table public.quote_items enable row level security;
alter table public.invoices enable row level security;
alter table public.expenses enable row level security;
alter table public.audit_logs enable row level security;

create policy profiles_self_read on public.profiles for select using (id=auth.uid());
create policy profiles_self_update on public.profiles for update using (id=auth.uid()) with check (id=auth.uid());
create policy workshops_member_read on public.workshops for select using (public.is_workshop_member(id));
create policy memberships_member_read on public.memberships for select using (public.is_workshop_member(workshop_id));
create policy memberships_admin_write on public.memberships for all using (public.has_workshop_role(workshop_id,array['owner','admin'])) with check (public.has_workshop_role(workshop_id,array['owner','admin']));
create policy subscriptions_admin_read on public.subscriptions for select using (public.has_workshop_role(workshop_id,array['owner','admin','accountant']));
create policy payments_admin_read on public.payment_transactions for select using (public.has_workshop_role(workshop_id,array['owner','admin','accountant']));

create policy customers_read on public.customers for select using (public.is_workshop_member(workshop_id));
create policy customers_write on public.customers for all using (public.has_workshop_role(workshop_id,array['owner','admin','advisor'])) with check (public.has_workshop_role(workshop_id,array['owner','admin','advisor']));
create policy vehicles_read on public.vehicles for select using (public.is_workshop_member(workshop_id));
create policy vehicles_write on public.vehicles for all using (public.has_workshop_role(workshop_id,array['owner','admin','advisor'])) with check (public.has_workshop_role(workshop_id,array['owner','admin','advisor']));
create policy orders_read on public.work_orders for select using (public.is_workshop_member(workshop_id));
create policy orders_create on public.work_orders for insert with check (public.has_workshop_role(workshop_id,array['owner','admin','advisor']));
create policy orders_update on public.work_orders for update using (public.has_workshop_role(workshop_id,array['owner','admin','advisor','technician'])) with check (public.has_workshop_role(workshop_id,array['owner','admin','advisor','technician']));
create policy orders_delete on public.work_orders for delete using (public.has_workshop_role(workshop_id,array['owner','admin']));
create policy notes_read on public.order_notes for select using (public.is_workshop_member(workshop_id));
create policy notes_create on public.order_notes for insert with check (public.has_workshop_role(workshop_id,array['owner','admin','advisor','technician','accountant']));
create policy evidence_read on public.order_evidence for select using (public.is_workshop_member(workshop_id));
create policy evidence_write on public.order_evidence for all using (public.has_workshop_role(workshop_id,array['owner','admin','advisor','technician'])) with check (public.has_workshop_role(workshop_id,array['owner','admin','advisor','technician']));
create policy quotes_read on public.quotes for select using (public.is_workshop_member(workshop_id));
create policy quotes_write on public.quotes for all using (public.has_workshop_role(workshop_id,array['owner','admin','advisor'])) with check (public.has_workshop_role(workshop_id,array['owner','admin','advisor']));
create policy quote_items_read on public.quote_items for select using (public.is_workshop_member(workshop_id));
create policy quote_items_write on public.quote_items for all using (public.has_workshop_role(workshop_id,array['owner','admin','advisor'])) with check (public.has_workshop_role(workshop_id,array['owner','admin','advisor']));
create policy invoices_read on public.invoices for select using (public.is_workshop_member(workshop_id));
create policy invoices_write on public.invoices for all using (public.has_workshop_role(workshop_id,array['owner','admin','advisor','accountant'])) with check (public.has_workshop_role(workshop_id,array['owner','admin','advisor','accountant']));
create policy expenses_read on public.expenses for select using (public.has_workshop_role(workshop_id,array['owner','admin','accountant']));
create policy expenses_write on public.expenses for all using (public.has_workshop_role(workshop_id,array['owner','admin','accountant'])) with check (public.has_workshop_role(workshop_id,array['owner','admin','accountant']));
create policy audit_read on public.audit_logs for select using (public.has_workshop_role(workshop_id,array['owner','admin']));

-- plans son públicos para mostrar precios; las mutaciones se hacen exclusivamente desde backend.
alter table public.plans enable row level security;
create policy plans_public_read on public.plans for select using (active=true);

-- IMPORTANTE: subscriptions, payments y audit_logs se escriben con service_role desde el backend.
-- Nunca exponga SUPABASE_SERVICE_ROLE_KEY en el frontend.
