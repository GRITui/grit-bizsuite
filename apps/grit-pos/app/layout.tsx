import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Grit POS",
  description: "Channel-agnostic point-of-sale for SMEs — front-of-house checkout, QR dine-in, and pickup links.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
