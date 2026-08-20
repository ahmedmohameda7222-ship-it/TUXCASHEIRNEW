-- Keep cryptographic helpers in the standard Supabase extensions schema in both
-- managed Supabase and ephemeral PostgreSQL migration-chain tests.
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
