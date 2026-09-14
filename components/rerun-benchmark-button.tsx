"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RotateCw } from "lucide-react";

type Props = {
  slug: string;
  latestCompletedRunId?: string | null;
};

export function RerunBenchmarkButton({ slug, latestCompletedRunId = null }: Props) {
  const router = useRouter();
  const [isRunning, setIsRunning] = useState(false);
  const [message, setMessage] = useState("");
  const [targetRunId, setTargetRunId] = useState<string | null>(null);

  useEffect(() => {
    if (!isRunning) return;

    if (targetRunId && latestCompletedRunId === targetRunId) {
      setIsRunning(false);
      setMessage("Benchmark complete. Latest score is shown above.");
      return;
    }

    const timer = window.setInterval(() => {
      router.refresh();
    }, 4000);

    const stop = window.setTimeout(() => {
      setIsRunning(false);
      setMessage("The benchmark is taking longer than expected. Refresh again in a moment if it is still processing.");
      router.refresh();
    }, 10 * 60_000);

    return () => {
      window.clearInterval(timer);
      window.clearTimeout(stop);
    };
  }, [isRunning, latestCompletedRunId, router, targetRunId]);

  async function handleRerun() {
    setMessage("");
    setTargetRunId(null);
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

      const runId = typeof data?.benchmarkRun?.id === "string" ? data.benchmarkRun.id : null;
      setTargetRunId(runId);
      setMessage("New benchmark started. This page will keep checking until the completed result is shown.");
      router.refresh();
    } catch (error) {
      setIsRunning(false);
      setTargetRunId(null);
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
