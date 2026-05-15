from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from typing import Any

import pandas as pd

from collector_common import connect, ensure_schema_exists, parse_date, utc_now


COLUMN_ALIASES = {
    "targetType": ["标的类型", "类型", "资产类型", "targetType", "target_type"],
    "targetKey": ["基金代码", "产品代码", "登记编码", "代码", "标的代码", "targetKey", "target_key", "code"],
    "transactionType": ["交易类型", "业务类型", "操作", "类型", "transactionType", "transaction_type"],
    "tradeDate": ["交易日期", "确认日期", "申请日期", "日期", "tradeDate", "trade_date"],
    "applicationDate": ["申请日期", "下单日期", "委托日期", "applicationDate", "application_date"],
    "shares": ["确认份额", "交易份额", "份额", "持有份额", "shares"],
    "price": ["确认净值", "成交净值", "单位净值", "净值", "价格", "price"],
    "amount": ["成交金额", "交易金额", "确认金额", "金额", "本金", "amount"],
    "fee": ["手续费", "交易费用", "费用", "申购费", "赎回费", "fee"],
    "note": ["备注", "说明", "note"],
}

TYPE_ALIASES = {
    "buy": {"buy", "买入", "申购", "认购", "定投", "转入"},
    "sell": {"sell", "卖出", "赎回", "强赎", "转出"},
    "dividend": {"dividend", "分红", "现金分红", "红利", "派息"},
    "fee": {"fee", "手续费", "费用", "补扣费用"},
}


def clean_header(value: Any) -> str:
    return str(value or "").strip().replace(" ", "").replace("_", "").lower()


def value_at(row: pd.Series, mapping: dict[str, str], key: str) -> Any:
    column = mapping.get(key)
    if not column:
        return None
    value = row.get(column)
    if value is None:
        return None
    try:
        if pd.isna(value):
            return None
    except TypeError:
        pass
    return value


def to_text(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, float) and math.isfinite(value) and value.is_integer():
        return str(int(value))
    text = str(value).strip()
    if not text or text.lower() in {"nan", "none", "null"}:
        return None
    return text


def to_float(value: Any) -> float | None:
    text = to_text(value)
    if text is None:
        return None
    cleaned = text.replace(",", "").replace("¥", "").replace("元", "").replace("%", "")
    try:
        parsed = float(cleaned)
    except ValueError:
        return None
    return parsed if math.isfinite(parsed) else None


def normalize_target_key(value: Any, target_type: str | None) -> str | None:
    text = to_text(value)
    if not text:
        return None
    if target_type == "fund" and text.replace(".", "", 1).isdigit():
        try:
            return str(int(float(text))).zfill(6)
        except ValueError:
            return text.zfill(6)
    if text.replace(".", "", 1).isdigit() and len(str(int(float(text)))) <= 6:
        return str(int(float(text))).zfill(6)
    return text


def normalize_target_type(value: Any, target_key: str | None, default_type: str | None) -> str | None:
    text = to_text(value)
    if text:
        if "理财" in text or "wealth" in text.lower():
            return "wealth"
        if "基金" in text or "fund" in text.lower():
            return "fund"
    if default_type in {"fund", "wealth"}:
        return default_type
    if target_key and target_key.isdigit() and len(target_key) == 6:
        return "fund"
    return "wealth" if target_key else None


def normalize_transaction_type(value: Any) -> str | None:
    text = to_text(value)
    if not text:
        return None
    compact = text.replace(" ", "").lower()
    for normalized, aliases in TYPE_ALIASES.items():
        if compact in {alias.lower() for alias in aliases}:
            return normalized
        if any(alias.lower() in compact for alias in aliases):
            return normalized
    return None


def build_mapping(columns: list[str]) -> dict[str, str]:
    normalized_columns = {clean_header(column): column for column in columns}
    mapping: dict[str, str] = {}
    for key, aliases in COLUMN_ALIASES.items():
        for alias in aliases:
            column = normalized_columns.get(clean_header(alias))
            if column:
                mapping[key] = column
                break
    return mapping


def normalize_mapping(mapping_json: str | None, columns: list[str]) -> dict[str, str] | None:
    if not mapping_json:
        return None
    try:
        payload = json.loads(mapping_json)
    except json.JSONDecodeError:
        return None
    if not isinstance(payload, dict):
        return None
    column_set = set(columns)
    mapping: dict[str, str] = {}
    for key in COLUMN_ALIASES:
        value = payload.get(key)
        if isinstance(value, str) and value in column_set:
            mapping[key] = value
    return mapping


def read_table(path: Path) -> pd.DataFrame:
    suffix = path.suffix.lower()
    if suffix in {".xlsx", ".xls"}:
        return pd.read_excel(path)
    if suffix == ".tsv":
        return pd.read_csv(path, sep="\t")
    return pd.read_csv(path, sep=None, engine="python")


def preview_transactions(path: Path, mapping_json: str | None = None) -> dict[str, Any]:
    df = read_table(path)
    columns = [str(column) for column in df.columns]
    mapping = normalize_mapping(mapping_json, columns) or build_mapping(columns)
    sample_rows = []
    for _, row in df.head(20).iterrows():
        sample_rows.append({
            str(column): to_text(row.get(column)) for column in columns
        })
    return {
        "columns": columns,
        "detectedMapping": mapping,
        "sampleRows": sample_rows,
        "rowCount": int(len(df)),
    }


def lookup_name(conn, target_type: str, target_key: str) -> str | None:
    if target_type == "fund":
        row = conn.execute("SELECT name FROM Fund WHERE code = ?", (target_key,)).fetchone()
        return row["name"] if row else None
    row = conn.execute("SELECT name FROM WealthProduct WHERE registerCode = ?", (target_key,)).fetchone()
    return row["name"] if row else None


def upsert_holding(conn, target_type: str, target_key: str, display_name: str | None) -> int:
    now = utc_now()
    conn.execute(
        """
        INSERT INTO PortfolioHolding
          (targetType, targetKey, fundCode, registerCode, displayName, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(targetType, targetKey) DO UPDATE SET
          displayName = COALESCE(excluded.displayName, PortfolioHolding.displayName),
          updatedAt = excluded.updatedAt
        """,
        (
            target_type,
            target_key,
            target_key if target_type == "fund" else None,
            target_key if target_type == "wealth" else None,
            display_name,
            now,
            now,
        ),
    )
    row = conn.execute(
        "SELECT id FROM PortfolioHolding WHERE targetType = ? AND targetKey = ?",
        (target_type, target_key),
    ).fetchone()
    return int(row["id"])


def transaction_exists(conn, holding_id: int, transaction_type: str, trade_date: str, shares: float | None, price: float | None, amount: float | None, fee: float | None) -> bool:
    row = conn.execute(
        """
        SELECT id
        FROM PortfolioTransaction
        WHERE holdingId = ?
          AND transactionType = ?
          AND tradeDate = ?
          AND IFNULL(shares, -999999999) = IFNULL(?, -999999999)
          AND IFNULL(price, -999999999) = IFNULL(?, -999999999)
          AND IFNULL(amount, -999999999) = IFNULL(?, -999999999)
          AND IFNULL(fee, -999999999) = IFNULL(?, -999999999)
        LIMIT 1
        """,
        (holding_id, transaction_type, trade_date, shares, price, amount, fee),
    ).fetchone()
    return row is not None


def import_transactions(
    path: Path,
    default_target_type: str | None = None,
    mapping_json: str | None = None,
    dry_run: bool = False,
) -> dict[str, Any]:
    conn = connect()
    ensure_schema_exists(conn)
    try:
      df = read_table(path)
      columns = [str(column) for column in df.columns]
      mapping = normalize_mapping(mapping_json, columns) or build_mapping(columns)
      required = {"targetKey", "transactionType", "tradeDate"}
      missing = sorted(required - set(mapping))
      if missing:
          return {"inserted": 0, "skipped": 0, "errors": [f"缺少必要列: {', '.join(missing)}"]}

      inserted = 0
      skipped = 0
      errors: list[str] = []
      for index, row in df.iterrows():
          target_key_raw = value_at(row, mapping, "targetKey")
          target_type_raw = value_at(row, mapping, "targetType")
          target_type = normalize_target_type(target_type_raw, None, default_target_type)
          target_key = normalize_target_key(target_key_raw, target_type)
          target_type = normalize_target_type(target_type_raw, target_key, default_target_type)
          transaction_type = normalize_transaction_type(value_at(row, mapping, "transactionType"))
          parsed_date = parse_date(value_at(row, mapping, "tradeDate"))
          if not target_type or not target_key or not transaction_type or not parsed_date:
              skipped += 1
              errors.append(f"第 {index + 2} 行缺少代码、交易类型或日期")
              continue

          display_name = lookup_name(conn, target_type, target_key)
          if not display_name:
              skipped += 1
              errors.append(f"第 {index + 2} 行未找到标的: {target_key}")
              continue

          shares = to_float(value_at(row, mapping, "shares"))
          price = to_float(value_at(row, mapping, "price"))
          amount = to_float(value_at(row, mapping, "amount"))
          fee = to_float(value_at(row, mapping, "fee"))
          application_date = parse_date(value_at(row, mapping, "applicationDate"))
          raw_note = to_text(value_at(row, mapping, "note"))
          note_parts = []
          if application_date:
              note_parts.append(f"申请日期：{application_date.isoformat()}")
          if raw_note:
              note_parts.append(raw_note)
          note = "\n".join(note_parts) if note_parts else None
          trade_date = parsed_date.isoformat()
          if dry_run:
              inserted += 1
              continue
          holding_id = upsert_holding(conn, target_type, target_key, display_name)
          if transaction_exists(conn, holding_id, transaction_type, trade_date, shares, price, amount, fee):
              skipped += 1
              continue
          if not dry_run:
              conn.execute(
                  """
                  INSERT INTO PortfolioTransaction
                    (holdingId, targetType, targetKey, transactionType, tradeDate, shares, price, amount, fee, note, createdAt)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                  """,
                  (holding_id, target_type, target_key, transaction_type, trade_date, shares, price, amount, fee, note, utc_now()),
              )
          inserted += 1
      if not dry_run:
          conn.commit()
      return {"inserted": inserted, "skipped": skipped, "errors": errors[:20]}
    finally:
        conn.close()


def main() -> int:
    parser = argparse.ArgumentParser(description="Import portfolio transactions from CSV/TSV/Excel")
    parser.add_argument("file")
    parser.add_argument("--default-target-type", choices=["fund", "wealth"], default=None)
    parser.add_argument("--mapping-json", default=None)
    parser.add_argument("--preview", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    if args.preview:
        result = preview_transactions(Path(args.file), mapping_json=args.mapping_json)
    else:
        result = import_transactions(
            Path(args.file),
            default_target_type=args.default_target_type,
            mapping_json=args.mapping_json,
            dry_run=args.dry_run,
        )
    print(json.dumps(result, ensure_ascii=False), flush=True)
    return 1 if result.get("inserted", 0) == 0 and result.get("errors") else 0


if __name__ == "__main__":
    raise SystemExit(main())
