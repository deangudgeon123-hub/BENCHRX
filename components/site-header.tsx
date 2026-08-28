import Link from "next/link";

export function SiteHeader() {
  return (
    <header className="border-b border-white/8">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <Link href="/" className="text-sm font-black tracking-[0.24em]">
          BENCHRX
        </Link>
        <nav className="flex items-center gap-5 text-sm text-[var(--muted)]">
          <a href="#how-it-works" className="transition hover:text-white">How it works</a>
          <Link
            href="/benchmark"
            className="rounded-full border border-white/12 px-4 py-2 font-semibold text-white transition hover:border-[var(--accent)]/60"
          >
            Benchmark agent
          </Link>
        </nav>
      </div>
    </header>
  );
}
