# Fund UX Optimization Design

## Scope

Implement the eight agreed UX improvements without adding database tables or changing the main collector flow. Use query-layer rules, reusable UI helpers, and the existing `Watchlist.note` decision payload where state is needed.

## Deliverables

1. Narrow the candidate pool so "重点观察" is genuinely selective, with clearer tiers and summary counts.
2. Reduce detail-page overload by keeping the highest-value decision panels visible and moving secondary panels behind disclosure controls.
3. Make data sample labels explicit, distinguishing recent/detail samples from full-history coverage where both can differ.
4. Prevent misleading fee output by showing "费率待确认" when rates cannot be parsed instead of displaying zero-cost estimates.
5. Turn watchlist saves into a decision queue by requiring observable buy, reject, and review notes through the existing decision form.
6. Replace free-form fund-type filtering with quick type chips while keeping keyword search available.
7. Make compare usable from an empty state with a guided search/add experience instead of only describing raw `targets` parameters.
8. Add a daily change summary that highlights new candidates, watched-fund changes, ranking moves, and data freshness after sync.

## Validation

Add focused tests for the reusable UX rule layer first, then wire the tested rules into pages. Verify with `npm run build` and spot-check `/funds`, `/funds/candidates`, a high-coverage fund detail page, `/compare`, and the daily summary entry point.
