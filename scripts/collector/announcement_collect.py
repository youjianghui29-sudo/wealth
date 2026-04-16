from __future__ import annotations

from collector_common import date_iso, insert_announcement


def collect_announcements(conn, seed: bool = False) -> int:
    if seed:
        return seed_announcements(conn)
    return 0


def seed_announcements(conn) -> int:
    rows = 0
    funds = conn.execute("SELECT code, name FROM Fund ORDER BY code LIMIT 6").fetchall()
    for fund in funds:
        insert_announcement(
            conn,
            target_type="fund",
            fund_code=fund["code"],
            title=f"{fund['name']} 2026 年一季度报告",
            url="https://www.cninfo.com.cn/new/index",
            source="seed-cninfo",
            published_at=date_iso(),
        )
        rows += 1

    products = conn.execute("SELECT registerCode, name FROM WealthProduct ORDER BY registerCode LIMIT 6").fetchall()
    for product in products:
        insert_announcement(
            conn,
            target_type="wealth",
            register_code=product["registerCode"],
            title=f"{product['name']} 最新净值公告",
            url="https://www.chinawealth.com.cn/",
            source="seed-chinawealth",
            published_at=date_iso(),
        )
        rows += 1

    conn.commit()
    return rows
