# ADR 0010: Atomic inbound Operations configuration snapshots

## Status

Accepted — 2026-08-20

## Context

Operations must eventually receive menu/payment/order-type/delivery/recipe/inventory configuration from a remote administration plane without coupling worker commands to cloud availability or exposing a half-updated catalog.

## Decision

`OperationsConfigurationSyncService` consumes an `InboundConfigurationProvider` through `discoverVersion()` and `fetchCompleteConfiguration()`. A complete bundle is deep-validated at runtime, including tenant identity, UUID/value constraints and referential integrity, before any local write. A newer valid bundle replaces the local snapshot and configuration-owned inventory metadata in one local transaction. Missing, invalid, unavailable, cross-shop or older bundles preserve the last known good configuration.

Development provisioning uses the same `installProvisionedConfiguration()` atomic path rather than a private schema shortcut.

## Consequences

The future backend transport may change independently. Worker-facing Operations can continue offline with the last valid configuration. Partial remote tables are never incrementally rendered as a menu.
