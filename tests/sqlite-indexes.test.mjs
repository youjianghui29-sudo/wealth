import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const schema = readFileSync("prisma/schema.prisma", "utf8");
const initDb = readFileSync("scripts/collector/init_db.py", "utf8");

const schemaIndexes = [
  "@@index([rangeKey, rankDate])",
  "@@index([fundCode, rangeKey, rankDate, createdAt])",
  "@@index([targetType, fundCode])",
  "@@index([targetType, registerCode])",
  "@@index([holdingId, tradeDate, id])",
  "@@index([targetType, updatedAt])",
  "@@index([targetType, fundCode, publishedAt])",
  "@@index([targetType, registerCode, publishedAt])",
  "@@index([enabled, createdAt])",
  "@@index([targetType, targetKey])",
  "model AlertAction",
  "@@unique([alertId])",
  "@@index([action, updatedAt])",
  "model CashAccount",
  "model CashTransaction",
  "model DashboardSnapshot",
  "model DecisionRecord",
  "@@index([accountId, transactionDate])",
  "@@unique([snapshotKey])",
  "@@index([targetType, targetKey, reviewDate])",
  "@@index([status, reviewDate])"
];

const sqliteIndexes = [
  "FundRankDaily_rangeKey_rankDate_idx",
  "FundRankDaily_fundCode_rangeKey_rankDate_createdAt_idx",
  "Watchlist_targetType_fundCode_idx",
  "Watchlist_targetType_registerCode_idx",
  "PortfolioTransaction_holdingId_tradeDate_id_idx",
  "PortfolioHolding_targetType_updatedAt_idx",
  "Announcement_targetType_fundCode_publishedAt_idx",
  "Announcement_targetType_registerCode_publishedAt_idx",
  "AlertRule_enabled_createdAt_idx",
  "AlertRule_targetType_targetKey_idx",
  "AlertAction_alertId_key",
  "AlertAction_action_updatedAt_idx",
  "CashAccount_name_key",
  "CashTransaction_accountId_transactionDate_idx",
  "DashboardSnapshot_snapshotKey_key",
  "DecisionRecord_targetType_targetKey_reviewDate_idx",
  "DecisionRecord_status_reviewDate_idx"
];

test("Prisma schema declares high-value compound indexes", () => {
  for (const index of schemaIndexes) {
    assert.ok(schema.includes(index), `missing schema index ${index}`);
  }
});

test("SQLite init script creates matching high-value compound indexes", () => {
  for (const index of sqliteIndexes) {
    assert.ok(initDb.includes(index), `missing SQLite init index ${index}`);
  }
});
