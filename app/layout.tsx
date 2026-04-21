import type { Metadata } from "next";
import Link from "next/link";
import { CompareTray } from "@/components/CompareTray";
import "./globals.css";

export const metadata: Metadata = {
  title: "理财与基金数据看板",
  description: "本地基金与银行理财每日数据看板"
};

const navItems = [
  { href: "/", label: "首页" },
  { href: "/portfolio", label: "我的持仓" },
  { href: "/funds", label: "基金" },
  { href: "/wealth", label: "理财" },
  { href: "/sync", label: "数据" }
];

const fundLinks = [
  { href: "/funds/candidates", label: "观察候选池" },
  { href: "/funds/rankings", label: "收益排行" },
  { href: "/funds/money", label: "货币基金" },
  { href: "/funds/exchange", label: "场内基金" },
  { href: "/funds/ratings", label: "基金评级" },
  { href: "/funds/managers", label: "基金经理" },
  { href: "/funds/market", label: "规模结构" },
  { href: "/funds/announcements", label: "公告中心" },
  { href: "/funds/dividends", label: "分红配送" }
];

const toolLinks = [
  { href: "/compare", label: "产品对比" },
  { href: "/alerts", label: "提醒中心" }
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
            <nav className="flex flex-wrap items-center gap-2">
              {navItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="focus-ring rounded-md border border-line bg-white px-3 py-2 text-sm text-slate-700 transition hover:border-steel hover:text-ink"
                >
                  {item.label}
                </Link>
              ))}
              <details className="nav-menu relative">
                <summary className="focus-ring list-none rounded-md border border-line bg-white px-3 py-2 text-sm text-slate-700 transition hover:border-steel hover:text-ink">
                  基金工具
                </summary>
                <div className="absolute right-0 z-20 mt-2 grid w-44 gap-1 rounded-md border border-line bg-white p-2 shadow-panel">
                  {fundLinks.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      className="focus-ring rounded-md px-3 py-2 text-sm text-slate-700 hover:bg-paper hover:text-ink"
                    >
                      {item.label}
                    </Link>
                  ))}
                </div>
              </details>
              <details className="nav-menu relative">
                <summary className="focus-ring list-none rounded-md border border-line bg-white px-3 py-2 text-sm text-slate-700 transition hover:border-steel hover:text-ink">
                  工具
                </summary>
                <div className="absolute right-0 z-20 mt-2 grid w-36 gap-1 rounded-md border border-line bg-white p-2 shadow-panel">
                  {toolLinks.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      className="focus-ring rounded-md px-3 py-2 text-sm text-slate-700 hover:bg-paper hover:text-ink"
                    >
                      {item.label}
                    </Link>
                  ))}
                </div>
              </details>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-6 lg:px-6">{children}</main>
        <CompareTray />
        <footer className="mx-auto max-w-7xl px-4 pb-8 pt-2 text-sm text-slate-600 lg:px-6">
          数据仅供学习和信息展示，不构成投资建议。中国理财网公开披露内容仅按内部/非商业 MVP 使用。
        </footer>
      </body>
    </html>
  );
}
