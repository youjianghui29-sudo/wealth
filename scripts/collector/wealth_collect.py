from __future__ import annotations

import datetime as dt
import json
import os
import re
from pathlib import Path
from typing import Any

from collector_common import (
    clean_text,
    date_iso,
    deterministic_walk,
    insert_announcement,
    parse_date,
    seed_dates,
    to_float,
    upsert_wealth_nav,
    upsert_wealth_product,
)


SEED_PRODUCTS = [
    ("Z7002623000001", "招银理财稳健添利 1 号", "招银理财", "R2", "开放式净值型"),
    ("Z7001022000002", "工银理财核心优选固收", "工银理财", "R2", "开放式净值型"),
    ("Z7001821000003", "中银理财稳富日日开", "中银理财", "R1", "开放式净值型"),
    ("Z7003324000004", "建信理财嘉鑫固收增强", "建信理财", "R3", "封闭式净值型"),
    ("Z7001123000005", "农银理财安心灵动", "农银理财", "R2", "开放式净值型"),
    ("Z7002922000006", "交银理财稳享现金管理", "交银理财", "R1", "开放式净值型"),
]


def collect_wealth_products(conn, seed: bool = False) -> int:
    if seed:
        return seed_wealth(conn)

    local_json = os.getenv("WEALTH_PRODUCTS_JSON")
    if local_json and Path(local_json).exists():
        return import_wealth_json(conn, Path(local_json))

    records = fetch_chinawealth_records()
    if not records:
        raise RuntimeError("未能从中国理财网页面解析到结构化产品数据，可使用 --seed 验证页面")

    rows = 0
    seen: set[str] = set()
    for record in records:
        register_code = pick(record, "登记编码", "产品登记编码", "registerCode", "cpdjbm", "prdCode", "prodRegCode")
        name = pick(record, "产品名称", "name", "cpms", "prdName", "prodName")
        if not register_code or not name or not valid_register_code(register_code) or register_code in seen:
            continue
        seen.add(register_code)

        date_value = pick(record, "净值日期", "披露日期", "navDate", "publishDate", "updateDate")
        nav_date = date_iso(parse_date(date_value) or dt.date.today())
        notice_url = pick(record, "noticeUrl", "detailurl", "url")
        upsert_wealth_product(
            conn,
            register_code=register_code,
            name=name,
            issuer=pick(record, "发行机构", "管理人", "issuer", "bankName", "orgName"),
            risk_level=normalize_risk(pick(record, "风险等级", "riskLevel", "risk", "prodRiskLevelName")),
            operation_mode=pick(record, "运作模式", "operationMode", "operateMode", "prodOperateModeName"),
            product_type=pick(record, "产品类型", "productType", "type", "prodTypeName"),
            sale_status=pick(record, "销售状态", "产品状态", "saleStatus", "status"),
            latest_disclosure_at=nav_date,
            source_url=notice_url if notice_url and notice_url != "--" else "https://www.chinawealth.com.cn/",
            performance_benchmark=pick(record, "业绩比较基准", "performanceBenchmark", "benchmark", "perfBenchmark"),
            min_purchase_amount=to_float(pick(record, "起购金额", "minPurchaseAmount", "purchaseAmount", "prodMinBuyAmt")),
            investment_term=pick(record, "投资期限", "产品期限", "investmentTerm", "term", "prodTerm"),
            open_date=date_iso(parse_date(pick(record, "开放日", "openDate", "prodOpenDate"))) if parse_date(pick(record, "开放日", "openDate", "prodOpenDate")) else None,
            next_open_date=date_iso(parse_date(pick(record, "下一开放日", "nextOpenDate", "nextOpenDay"))) if parse_date(pick(record, "下一开放日", "nextOpenDate", "nextOpenDay")) else None,
            redeem_arrival=pick(record, "赎回到账", "赎回到账日", "redeemArrival", "arrivalDay"),
            manager_name=pick(record, "管理人", "manager", "managerName", "orgName"),
            custodian_name=pick(record, "托管人", "custodian", "custodianName"),
            fee_summary=pick(record, "费率", "费用", "feeSummary", "fee"),
            asset_allocation=pick(record, "资产配置", "投资资产", "assetAllocation", "investAsset"),
            liquidity_note=pick(record, "流动性安排", "开放安排", "liquidityNote"),
        )
        upsert_wealth_nav(
            conn,
            register_code=register_code,
            nav_date=nav_date,
            net_value=to_float(pick(record, "最新净值", "单位净值", "netValue", "nav", "prodNetVal", "prodNewVal")),
            accumulated_value=to_float(pick(record, "累计净值", "accumulatedValue", "accNav", "newValue")),
            daily_change=None,
            daily_change_rate=None,
            change_source="source",
        )
        notice_title = pick(record, "noticeTitle", "announcement", "biaoti")
        if notice_url and notice_url != "--" and notice_title and notice_title != "--":
            insert_announcement(
                conn,
                target_type="wealth",
                register_code=register_code,
                title=notice_title,
                url=notice_url,
                source="chinawealth",
                published_at=nav_date,
            )
        rows += 1

    conn.commit()
    return rows


def fetch_chinawealth_records() -> list[dict[str, Any]]:
    try:
        import requests
    except ImportError as exc:
        raise RuntimeError("缺少 Python 依赖 requests，请运行 pip install -r requirements.txt") from exc

    timeout = int(os.getenv("WEALTH_HTTP_TIMEOUT_SECONDS", "20"))
    session = requests.Session()
    session.trust_env = False
    product_paths = [
        "/wealthprod/onsaleProduct_EN.json",
        "/wealthprod/durationProduct_EN.json",
        "/wealthprod/retireProduct_EN.json",
        "/wealthprod/personProduct_EN.json",
    ]
    json_records: list[dict[str, Any]] = []
    for path in product_paths:
        try:
            response = session.get(f"https://www.chinawealth.com.cn{path}", headers={"User-Agent": "Mozilla/5.0"}, timeout=timeout)
            response.raise_for_status()
            payload = response.json()
            if isinstance(payload, list):
                json_records.extend(item for item in payload if isinstance(item, dict))
        except Exception:
            continue
    if json_records:
        return json_records

    urls = [
        "https://xinxipilu.chinawealth.com.cn/queryMenu/selectedProducts",
        "https://www.chinawealth.com.cn/lcweb/management/proScreen",
        "https://www.chinawealth.com.cn/",
    ]
    headers = {
        "User-Agent": "Mozilla/5.0 wealth-dashboard/0.1",
        "Accept": "text/html,application/json;q=0.9,*/*;q=0.8",
    }
    errors: list[str] = []
    for url in urls:
        try:
            response = session.get(url, headers=headers, timeout=timeout)
            response.raise_for_status()
            records = extract_records(response.text)
        except Exception as exc:
            errors.append(f"{url}: {exc}")
            continue
        if records:
            return records
    if errors:
        raise RuntimeError("; ".join(errors))
    return []


def extract_records(text: str) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for script_match in re.finditer(r"<script[^>]*>(.*?)</script>", text, re.S | re.I):
        script = script_match.group(1)
        if "登记编码" not in script and "register" not in script.lower() and "product" not in script.lower():
            continue
        for array_text in re.findall(r"(\[[\s\S]{20,}?\])", script):
            try:
                payload = json.loads(array_text)
            except Exception:
                continue
            records.extend(flatten_records(payload))

    if not records and "登记编码" in text:
        table_rows = re.findall(r"<tr[^>]*>(.*?)</tr>", text, re.S | re.I)
        for row in table_rows:
            cells = [clean_text(re.sub(r"<[^>]+>", "", cell)) for cell in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", row, re.S | re.I)]
            cells = [cell for cell in cells if cell]
            if len(cells) >= 3:
                records.append({"产品名称": cells[0], "登记编码": cells[1], "发行机构": cells[2]})
    return records[:500]


def flatten_records(payload: Any) -> list[dict[str, Any]]:
    found: list[dict[str, Any]] = []
    if isinstance(payload, dict):
        if looks_like_product(payload):
            found.append(payload)
        for value in payload.values():
            found.extend(flatten_records(value))
    elif isinstance(payload, list):
        for value in payload:
            found.extend(flatten_records(value))
    return found


def looks_like_product(record: dict[str, Any]) -> bool:
    keys = " ".join(str(key) for key in record.keys())
    return any(token in keys for token in ("登记编码", "registerCode", "prdCode", "产品名称", "prdName"))


def valid_register_code(value: str) -> bool:
    text = value.strip()
    if any(token in text for token in ('"', "'", "+", "登记编码", "prodRegCode")):
        return False
    return bool(re.fullmatch(r"[A-Z0-9]{8,32}", text))


def pick(record: dict[str, Any], *keys: str) -> str | None:
    lowered = {str(key).lower(): value for key, value in record.items()}
    for key in keys:
        if key in record:
            return clean_text(record[key])
        value = lowered.get(key.lower())
        if value is not None:
            return clean_text(value)
    return None


def normalize_risk(value: str | None) -> str | None:
    if not value:
        return None
    chinese_levels = {"一": "1", "二": "2", "三": "3", "四": "4", "五": "5"}
    for word, level in chinese_levels.items():
        if word in value:
            return f"R{level}"
    match = re.search(r"R\s*([1-5])", value, re.I)
    if match:
        return f"R{match.group(1)}"
    match = re.search(r"([1-5])", value)
    return f"R{match.group(1)}" if match else value


def import_wealth_json(conn, path: Path) -> int:
    payload = json.loads(path.read_text(encoding="utf-8"))
    records = payload if isinstance(payload, list) else payload.get("records", [])
    rows = 0
    for record in records:
        register_code = pick(record, "registerCode", "登记编码", "prodRegCode")
        name = pick(record, "name", "产品名称", "prodName")
        if not register_code or not name or not valid_register_code(register_code):
            continue
        nav_date = date_iso(parse_date(pick(record, "navDate", "净值日期")) or dt.date.today())
        upsert_wealth_product(
            conn,
            register_code=register_code,
            name=name,
            issuer=pick(record, "issuer", "发行机构", "orgName"),
            risk_level=normalize_risk(pick(record, "riskLevel", "风险等级", "prodRiskLevelName")),
            operation_mode=pick(record, "operationMode", "运作模式", "prodOperateModeName"),
            product_type=pick(record, "productType", "产品类型", "prodTypeName"),
            sale_status=pick(record, "saleStatus", "产品状态"),
            latest_disclosure_at=nav_date,
            source_url=pick(record, "sourceUrl"),
            source="json",
            performance_benchmark=pick(record, "performanceBenchmark", "业绩比较基准", "benchmark"),
            min_purchase_amount=to_float(pick(record, "minPurchaseAmount", "起购金额")),
            investment_term=pick(record, "investmentTerm", "投资期限", "产品期限"),
            open_date=date_iso(parse_date(pick(record, "openDate", "开放日"))) if parse_date(pick(record, "openDate", "开放日")) else None,
            next_open_date=date_iso(parse_date(pick(record, "nextOpenDate", "下一开放日"))) if parse_date(pick(record, "nextOpenDate", "下一开放日")) else None,
            redeem_arrival=pick(record, "redeemArrival", "赎回到账"),
            manager_name=pick(record, "managerName", "管理人"),
            custodian_name=pick(record, "custodianName", "托管人"),
            fee_summary=pick(record, "feeSummary", "费率", "费用"),
            asset_allocation=pick(record, "assetAllocation", "资产配置"),
            liquidity_note=pick(record, "liquidityNote", "流动性安排"),
        )
        upsert_wealth_nav(
            conn,
            register_code=register_code,
            nav_date=nav_date,
            net_value=to_float(pick(record, "netValue", "最新净值", "prodNetVal", "prodNewVal")),
            accumulated_value=to_float(pick(record, "accumulatedValue", "累计净值", "newValue")),
            daily_change=None,
            daily_change_rate=None,
            change_source="source",
            source="json",
        )
        rows += 1
    conn.commit()
    return rows


def seed_wealth(conn) -> int:
    dates = seed_dates(36)
    rows = 0
    for index, (code, name, issuer, risk, mode) in enumerate(SEED_PRODUCTS, start=1):
        upsert_wealth_product(
            conn,
            register_code=code,
            name=name,
            issuer=issuer,
            risk_level=risk,
            operation_mode=mode,
            product_type="固定收益类",
            sale_status="存续",
            latest_disclosure_at=date_iso(dates[-1]),
            source_url="https://www.chinawealth.com.cn/",
            source="seed",
        )
        values = deterministic_walk(1 + index * 0.025, len(dates), index * 29)
        previous = None
        for date, value in zip(dates, values):
            change = None if previous is None else value - previous
            rate = None if previous is None else (value / previous - 1) * 100
            upsert_wealth_nav(
                conn,
                register_code=code,
                nav_date=date_iso(date),
                net_value=round(value, 6),
                accumulated_value=round(value + 0.04 * index, 6),
                daily_change=round(change, 6) if change is not None else None,
                daily_change_rate=round(rate, 3) if rate is not None else None,
                change_source="seed",
                source="seed",
            )
            previous = value
        rows += 1
    conn.commit()
    return rows
