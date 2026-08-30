"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RotateCw } from "lucide-react";

type Props = {
  slug: string;
};

export function RerunBenchmarkButton({ slug }: Props) {
  const router = useRouter();
  const [isRunning, setIsRunning] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!isRunning) return;

    const timer = window.setInterval(() => {
      router.refresh();
    }, 4000);

    const stop = window.setTimeout(() => {
      setIsRunning(false);
      setMessage("If the run is still processing, refresh again in a moment.");
      router.refresh();
    }, 90_000);

    return () => {
      window.clearInterval(timer);
      window.clearTimeout(stop);
    };
  }, [isRunning, router]);

  async function handleRerun() {
    setMessage("");
    setIsRunning(true);

    try {
      const response = await fetch(`/api/agents/${slug}/rerun`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Could not start another benchmark.");
      }

      setMessage("New benchmark started. This page will keep checking for the result.");
      router.refresh();
    } catch (error) {
      setIsRunning(false);
      setMessage(error instanceof Error ? error.message : "Could not start another benchmark.");
    }
  }

  return (
    <div className="flex flex-col items-start gap-2 sm:items-end">
      <button
        type="button"
        onClick={handleRerun}
        disabled={isRunning}
        className="inline-flex items-center justify-center gap-2 rounded-full bg-[var(--accent)] px-5 py-2.5 text-sm font-black text-black transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isRunning ? <Loader2 size={16} className="animate-spin" /> : <RotateCw size={16} />}
        {isRunning ? "Benchmark running..." : "Run benchmark again"}
      </button>
      {message ? <p className="max-w-sm text-xs leading-5 text-[var(--muted)] sm:text-right">{message}</p> : null}
    </div>
  );
}
