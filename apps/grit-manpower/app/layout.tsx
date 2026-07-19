import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Grit Manpower",
  description: "Staff scheduling, clock-in/out, payroll, and employee records for SMEs.",
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
