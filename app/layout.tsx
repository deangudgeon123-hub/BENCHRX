import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BENCHRX — Independent AI Agent Benchmarking",
  description:
    "Independent production testing for AI agents. Measure reliability, safety, cost and task performance before deployment.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
