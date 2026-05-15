# Operational Portfolio Optimization Design

## Scope

Implement eight practical improvements on the existing SQLite/Prisma/Next stack: database backup and restore, stuck sync-job handling, portfolio rebalancing, cash ledger, advanced alert rules, data-source health, persisted dashboard snapshots, and decision review records.

## Design

1. Backups are filesystem copies of `data/wealth.sqlite` stored in `data/backups`. Restore creates a safety backup first, then replaces the active database.
2. Stuck sync jobs are running jobs older than a configurable hour threshold. They can be marked failed from the sync page; reruns reuse the existing backfill entry points where possible.
3. Rebalancing compares current target weights against configured `PortfolioTarget` rows and reports amount-level buy/sell/wait actions.
4. Cash uses `CashAccount` and `CashTransaction`, independent from product holdings but visible in portfolio totals.
5. Advanced alerts extend rule evaluation with consecutive drops, peer underperformance, new max drawdown, and position limit checks.
6. Data-source health is derived from recent `SyncJob` rows by source token/failure text and displayed in sync.
7. Dashboard snapshots persist JSON payloads in `DashboardSnapshot` so expensive summary-style data can be reused beyond in-memory caches.
8. Decision review records persist buy/reject/watch decisions with a review date and outcome note.

## Validation

Add failing tests for reusable rule helpers, backup helper behavior, and schema/init coverage first. Then implement minimal API and UI surfaces and verify with Node tests, Prisma generation, build, and HTTP smoke checks.
