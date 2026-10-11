# TUX Admin — populated local workspace

To run the Admin with an independent, realistic set of business records:

```bash
npm run dev:admin:fixtures
```

The browser presents Maadi and Zamalek locations, catalog products, inventory, suppliers, purchase orders, customers, loyalty, promotions, orders, delivery riders and zones, staff, approvals, audit, bank and cash, end-day, expenses and reporting.

This launch mode is opt-in and local only. The `/api/admin/*` browser adapter is active only when Vite sets `DEV` **and** `VITE_TUX_ADMIN_FIXTURES=true`. Production builds and the server-side API keep their existing authentication, CSRF, service-role and canonical Supabase behavior. No rows are inserted into Supabase. No payments, PINs, credentials, messages or operational commands are sent to external systems.

All records are synthetic. Changes are retained in memory during the current page lifecycle and reset on reload. No visible label is added to the Admin UI. Use `npm run dev:admin` for ordinary live-BFF development.

The fixture data is intended for interface review and interaction testing, not for asserting real company balances or accounting reports.
