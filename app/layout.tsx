import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "理财与基金数据看板",
  description: "本地基金与银行理财每日数据看板"
};

const navItems = [
  { href: "/", label: "首页" },
  { href: "/portfolio", label: "持仓" },
  { href: "/funds", label: "基金" },
  { href: "/funds/rankings", label: "排行" },
  { href: "/funds/money", label: "货币" },
  { href: "/funds/exchange", label: "场内" },
  { href: "/funds/market", label: "市场" },
  { href: "/funds/ratings", label: "评级" },
  { href: "/funds/managers", label: "经理" },
  { href: "/wealth", label: "理财" },
  { href: "/compare", label: "对比" },
  { href: "/alerts", label: "提醒" },
  { href: "/sync", label: "采集状态" }
];

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>
        <header className="border-b border-line bg-white/90">
          <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center sm:justify-between lg:px-6">
            <Link href="/" className="text-xl font-semibold text-ink focus-ring rounded">
              理财与基金数据看板
            </Link>
            <nav className="flex flex-wrap gap-2">
              {navItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="focus-ring rounded-md border border-line bg-white px-3 py-2 text-sm text-slate-700 transition hover:border-steel hover:text-ink"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-6 lg:px-6">{children}</main>
        <footer className="mx-auto max-w-7xl px-4 pb-8 pt-2 text-sm text-slate-600 lg:px-6">
          数据仅供学习和信息展示，不构成投资建议。中国理财网公开披露内容仅按内部/非商业 MVP 使用。
        </footer>
      </body>
    </html>
  );
}
