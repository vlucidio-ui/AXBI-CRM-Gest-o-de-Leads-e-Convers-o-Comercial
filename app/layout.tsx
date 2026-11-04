import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AXBI CRM",
  description: "Gestão de leads e conversão comercial — AXBI Negócios Inteligentes",
  robots: { index: false, follow: false }
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0f3d5e" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
