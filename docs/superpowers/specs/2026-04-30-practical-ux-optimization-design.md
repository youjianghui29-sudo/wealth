# Practical UX Optimization Design

## Scope

Implement six practical usability improvements on top of the existing fund and wealth dashboard: portfolio transaction accuracy, persistent alert actions, single-fund backfill shortcuts, comparison conclusions, mobile-friendly card views for key tables, and a daily brief entry point.

## Design

1. Portfolio accuracy uses deterministic transaction signatures to skip duplicate manual/API inserts and exposes a reconciliation summary for each holding by comparing manual holding fields with transaction-derived shares and net cost.
2. Alert actions are persisted in a new `AlertAction` table and accessed through an API, so handled, snoozed, and rejected alerts behave consistently across the home page and alert center.
3. Single fund detail pages reuse the existing backfill API and `BackfillButton` component to start targeted history/profile backfills directly from the data-quality area.
4. Comparison pages add a small conclusion layer above the metric table. The rule layer chooses relative winners and reports when data is insufficient.
5. Main data-heavy pages keep desktop tables but add mobile card layouts for fund lists, candidate pools, portfolio holdings, comparison targets, and alert items.
6. A `/brief` page exposes the latest generated markdown daily brief and gives the user a direct command when no brief is available.

## Validation

Add test-first coverage for reusable rules and schema/index changes, then verify with the existing Node tests and `npm run build`.
