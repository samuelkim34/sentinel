import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Providers } from "../components/providers";
import "./globals.css";


export const metadata: Metadata = {
  title: "Sentinel",
  description: "Control spending authority for native Grok Bots against a Nessie sandbox account.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full font-sans text-base antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
