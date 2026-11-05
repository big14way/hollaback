import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { ThemeSync } from "@/components/ThemeSync";

export const metadata: Metadata = {
  title: "Hollaback · Recovered checkouts",
  description: "Abandoned PayPal checkouts, the recovery agent's conversations, and recovered revenue.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ThemeSync />
        <header className="topbar">
          <Link href="/" className="brand">
            Hollaback
          </Link>
          <span className="tagline">Abandoned PayPal checkouts, brought back</span>
        </header>
        <main className="page">{children}</main>
      </body>
    </html>
  );
}
