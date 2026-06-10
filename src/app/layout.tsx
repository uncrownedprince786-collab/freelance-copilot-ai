import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lead Hunter | AI-Powered Freelance Intelligence",
  description: "Authentic freelance opportunities from Upwork, Freelancer, and more. AI-scored and filtered for quality.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}