"use client";

import { useState, useTransition } from "react";

export function WatchButton({
  targetType,
  code,
  initialWatched
}: {
  targetType: "fund" | "wealth";
  code: string;
  initialWatched: boolean;
}) {
  const [watched, setWatched] = useState(initialWatched);
  const [isPending, startTransition] = useTransition();

  const toggle = () => {
    startTransition(async () => {
      const response = await fetch("/api/watchlist", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          targetType,
          code,
          watched: !watched
        })
      });

      if (response.ok) {
        const payload = (await response.json()) as { watched: boolean };
        setWatched(payload.watched);
      }
    });
  };

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={isPending}
      className="focus-ring rounded-md border border-steel bg-white px-3 py-2 text-sm font-medium text-steel transition hover:bg-steel hover:text-white disabled:cursor-wait disabled:opacity-60"
    >
      {watched ? "取消关注" : "加入关注"}
    </button>
  );
}
