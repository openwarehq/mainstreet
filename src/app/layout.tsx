import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "mainstreet — automated local web agency",
  description:
    "Finds local businesses with no website and builds them one. Discovery, spec and build with no approval gate.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="overflow-hidden">{children}</body>
    </html>
  );
}
