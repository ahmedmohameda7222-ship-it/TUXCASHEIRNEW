-- TUX Operations V2 independent-audit parity correction.
-- Repository migration only. DO NOT apply to a remote project until the new V2 Supabase project exists.
-- Apply after:
--   20260817195000_operations_foundation.sql
--   20260817195500_tenant_integrity.sql

-- One Current Operator session per Business Day, matching local SQLite.
create unique index worker_sessions_one_open_per_business_day_idx
  on public.worker_sessions(business_day_id)
  where ended_at is null;

-- Manual Expense lifecycle is soft-delete/revision based locally. Preserve it losslessly remotely.
alter table public.expenses
  add column lifecycle_revision integer not null default 0 check (lifecycle_revision >= 0),
  add column lifecycle_updated_at timestamptz,
  add column lifecycle_updated_by_worker_id uuid,
  add column deleted_at timestamptz,
  add column deleted_by_worker_id uuid,
  add column snapshot_json jsonb;

alter table public.expenses
  add constraint expenses_manual_amount_positive_ck
    check (kind <> 'MANUAL' or amount_minor > 0),
  add constraint expenses_lifecycle_updated_worker_same_shop_fk
    foreign key (shop_id, lifecycle_updated_by_worker_id)
      references public.workers(shop_id, id),
  add constraint expenses_deleted_worker_same_shop_fk
    foreign key (shop_id, deleted_by_worker_id)
      references public.workers(shop_id, id),
  add constraint expenses_deleted_metadata_ck
    check (
      (deleted_at is null and deleted_by_worker_id is null) or
      (kind = 'MANUAL' and deleted_at is not null and deleted_by_worker_id is not null)
    );

-- The local Order is an immutable placement snapshot plus a revisioned operational lifecycle.
-- Current-state columns make that lifecycle queryable; snapshot_json preserves the authoritative
-- committed OrderSnapshot including nested modifier/combo snapshots without interpretation loss.
alter table public.orders
  add column configuration_version integer check (configuration_version is null or configuration_version > 0),
  add column operational_revision integer not null default 0 check (operational_revision >= 0),
  add column done_at timestamptz,
  add column cancelled_at timestamptz,
  add column cancelled_by_worker_id uuid,
  add column cancelled_by_worker_name_snapshot text,
  add column cancellation_reason text,
  add column cancellation_food_prepared boolean,
  add column cancellation_stock_restored boolean,
  add column returned_at timestamptz,
  add column returned_by_worker_id uuid,
  add column returned_by_worker_name_snapshot text,
  add column return_reason text,
  add column snapshot_json jsonb;

alter table public.orders
  add constraint orders_cancelled_worker_same_shop_fk
    foreign key (shop_id, cancelled_by_worker_id) references public.workers(shop_id, id),
  add constraint orders_returned_worker_same_shop_fk
    foreign key (shop_id, returned_by_worker_id) references public.workers(shop_id, id),
  add constraint orders_cancellation_metadata_ck
    check (
      (status <> 'CANCELLED') or
      (
        cancelled_at is not null and
        cancelled_by_worker_id is not null and
        btrim(coalesce(cancelled_by_worker_name_snapshot, '')) <> '' and
        btrim(coalesce(cancellation_reason, '')) <> '' and
        cancellation_food_prepared is not null and
        cancellation_stock_restored is not null
      )
    ),
  add constraint orders_return_metadata_ck
    check (
      (status <> 'RETURNED') or
      (
        returned_at is not null and
        returned_by_worker_id is not null and
        btrim(coalesce(returned_by_worker_name_snapshot, '')) <> '' and
        btrim(coalesce(return_reason, '')) <> ''
      )
    );

alter table public.order_items
  add column snapshot_json jsonb;

-- Modifier/combo/reconciliation-line snapshots do not own local UUIDs. Their stable local identity
-- is their parent plus committed position/method. Do not invent remote IDs for them.
alter table public.order_item_modifiers drop constraint order_item_modifiers_pkey;
alter table public.order_item_modifiers alter column id drop not null;
alter table public.order_item_modifiers
  add constraint order_item_modifiers_parent_position_pkey primary key (order_item_id, position);

alter table public.order_item_combo_beverages drop constraint order_item_combo_beverages_pkey;
alter table public.order_item_combo_beverages alter column id drop not null;
alter table public.order_item_combo_beverages
  add constraint order_item_combo_parent_unit_pkey primary key (order_item_id, unit_index);

alter table public.reconciliation_lines drop constraint reconciliation_lines_pkey;
alter table public.reconciliation_lines alter column id drop not null;
alter table public.reconciliation_lines
  add constraint reconciliation_lines_parent_method_pkey
    primary key (reconciliation_id, payment_method_id);

-- Every operational transition receives the immutable local outbox event UUID as its event row ID.
alter table public.order_status_events
  add column operational_revision integer check (operational_revision is null or operational_revision >= 0),
  add column from_status text check (from_status is null or from_status in ('ACTIVE', 'DONE', 'CANCELLED', 'RETURNED')),
  add column to_status text check (to_status is null or to_status in ('ACTIVE', 'DONE', 'CANCELLED', 'RETURNED')),
  add column worker_name_snapshot text,
  add column food_prepared boolean;

-- Durable exactly-once receiver receipt. The receiver inserts this in the SAME Postgres transaction
-- as every materialization mutation. A retry with the same event_id / idempotency key is a no-op
-- only when its payload hash matches; a conflicting reuse is a protocol conflict.
create table public.operations_sync_event_receipts (
  event_id uuid primary key,
  shop_id uuid not null references public.shops(id),
  idempotency_key text not null check (btrim(idempotency_key) <> ''),
  event_type text not null check (btrim(event_type) <> ''),
  payload_version integer not null check (payload_version > 0),
  payload_sha256 text not null check (btrim(payload_sha256) <> ''),
  envelope_json jsonb not null,
  received_at timestamptz not null default now(),
  applied_at timestamptz not null default now(),
  unique (shop_id, idempotency_key),
  unique (shop_id, event_id)
);
create index operations_sync_event_receipts_shop_applied_idx
  on public.operations_sync_event_receipts(shop_id, applied_at desc);

-- Keep the receiver table deny-by-default until the real V2 service-role/auth boundary is reviewed.
alter table public.operations_sync_event_receipts enable row level security;
