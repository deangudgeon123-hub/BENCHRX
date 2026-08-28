"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

export function BenchmarkPending() {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const tick = window.setInterval(() => setSeconds((value) => value + 1), 1000);
    const refresh = window.setInterval(() => window.location.reload(), 5000);

    return () => {
      window.clearInterval(tick);
      window.clearInterval(refresh);
    };
  }, []);

  return (
    <div className="mt-10 rounded-3xl border border-[var(--accent)]/20 bg-[var(--surface)] p-8 sm:p-10">
      <div className="flex items-center gap-3 text-[var(--accent)]">
        <Loader2 size={20} className="animate-spin" />
        <p className="text-xs font-bold uppercase tracking-[0.18em]">Benchmark running</p>
      </div>
      <h2 className="mt-4 text-2xl font-black">We’re testing this agent now.</h2>
      <p className="mt-3 max-w-2xl leading-7 text-[var(--muted)]">
        You can leave this page open. BENCHRX checks automatically every few seconds and will show the score as soon as the run finishes.
      </p>
      <p className="mt-4 text-sm font-semibold text-white/70">Waiting {seconds}s</p>
    </div>
  );
}
