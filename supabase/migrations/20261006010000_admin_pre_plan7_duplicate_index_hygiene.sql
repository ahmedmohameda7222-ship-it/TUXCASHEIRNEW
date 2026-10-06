-- Pre-Plan-7 Admin hardening: remove standalone duplicate indexes identified by the
-- canonical Supabase performance advisor. The retained *_unique indexes are owned by
-- UNIQUE constraints from 20260817195500_tenant_integrity.sql and remain the referenced
-- tenant-integrity keys for same-shop foreign keys.

DROP INDEX IF EXISTS public.delivery_zones_shop_id_id_uq;
DROP INDEX IF EXISTS public.payment_methods_shop_id_id_uq;
