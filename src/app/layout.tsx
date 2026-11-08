import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin", "latin-ext"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Șeptică",
  applicationName: "Șeptică",
  appleWebApp: { capable: true, title: "Șeptică", statusBarStyle: "default" },
  other: { "apple-mobile-web-app-capable": "yes" },
  // Explicit instead of app/apple-icon.tsx (its link came out as "/apple-icon", without the basePath).
  // Setting icons drops the file-based favicon link, so it is listed here too.
  icons: {
    icon: { url: `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/favicon.ico`, sizes: "48x48", type: "image/x-icon" },
    apple: { url: `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/icons/180`, sizes: "180x180", type: "image/png" },
  },
  description: "Șeptică multiplayer între prieteni, 2-4 jucători, și pe echipe.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f4f5" },
    { media: "(prefers-color-scheme: dark)", color: "#09090b" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ro" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
