import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AXBI CRM",
  description: "Gestão de leads e conversão comercial — AXBI Negócios Inteligentes",
  robots: { index: false, follow: false }
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#1C2433" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <head>
        {/* Fontes da identidade AXBI: Montserrat (interface) e Cormorant Garamond (marca). */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* No layout raiz a fonte vale para todas as páginas; o aviso do lint é para o roteador antigo. */}
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@600&family=Montserrat:wght@400;500;600;700&display=swap" />
      </head>
      <body>{children}</body>
    </html>
  );
}
