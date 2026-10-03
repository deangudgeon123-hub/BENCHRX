"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

export function BenchmarkPending({status = null}: {status?: string | null}) {
  const failed = status === "failed";
  const active = status === "queued" || status === "running";
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (!active) return;
    const tick = window.setInterval(() => setSeconds((value) => value + 1), 1000);
    const refresh = window.setInterval(() => window.location.reload(), 5000);

    return () => {
      window.clearInterval(tick);
      window.clearInterval(refresh);
    };
  }, [active]);

  return (
    <div className="mt-10 rounded-3xl border border-[var(--accent)]/20 bg-[var(--surface)] p-8 sm:p-10">
      <div className="flex items-center gap-3 text-[var(--accent)]">
        {active ? <Loader2 size={20} className="animate-spin" /> : null}
        <p className="text-xs font-bold uppercase tracking-[0.18em]">{failed ? "BENCHRX execution failed" : status === "queued" ? "Benchmark queued" : active ? "Benchmark running" : "No completed benchmark"}</p>
      </div>
      <h2 className="mt-4 text-2xl font-black">{failed ? "This run did not complete." : status === "queued" ? "Waiting for a benchmark worker." : active ? "We’re testing this agent now." : "Start a benchmark to see a result."}</h2>
      <p className="mt-3 max-w-2xl leading-7 text-[var(--muted)]">
        {failed ? "BENCHRX could not complete execution. This is not a behavioural failure of the agent. You can retry using Run benchmark again." : active ? "You can leave this page open. BENCHRX checks automatically every few seconds and will show the score as soon as the run finishes." : "There is no completed result to display."}
      </p>
      {active ? <p className="mt-4 text-sm font-semibold text-white/70">Waiting {seconds}s</p> : null}
    </div>
  );
}
