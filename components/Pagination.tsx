import Link from "next/link";

export function Pagination({
  page,
  pageCount,
  searchParams
}: {
  page: number;
  pageCount: number;
  searchParams: Record<string, string | undefined>;
}) {
  const makeHref = (nextPage: number) => {
    const params = new URLSearchParams();
    Object.entries(searchParams).forEach(([key, value]) => {
      if (value && key !== "page") {
        params.set(key, value);
      }
    });
    params.set("page", String(nextPage));
    return `?${params.toString()}`;
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600">
      <span>
        第 {page} / {pageCount} 页
      </span>
      <div className="flex gap-2">
        <Link
          href={makeHref(Math.max(1, page - 1))}
          aria-disabled={page <= 1}
          className="focus-ring rounded-md border border-line bg-white px-3 py-2 aria-disabled:pointer-events-none aria-disabled:opacity-45"
        >
          上一页
        </Link>
        <Link
          href={makeHref(Math.min(pageCount, page + 1))}
          aria-disabled={page >= pageCount}
          className="focus-ring rounded-md border border-line bg-white px-3 py-2 aria-disabled:pointer-events-none aria-disabled:opacity-45"
        >
          下一页
        </Link>
      </div>
    </div>
  );
}
