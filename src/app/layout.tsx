import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { SkipLink } from "@/components/skip-link";
import { site } from "@/lib/site";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// The public origin is configuration, not code: the domain is not registered yet, and
// self-hosters serve from their own. Unset means no absolute URLs in metadata.
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;

const title = `${site.name} · ${site.tagline}`;

export const metadata: Metadata = {
  metadataBase: siteUrl ? new URL(siteUrl) : null,
  title: {
    default: title,
    template: `%s · ${site.name}`,
  },
  description: site.description,
  openGraph: {
    type: "website",
    siteName: site.name,
    title,
    description: site.description,
  },
  twitter: {
    card: "summary",
    title,
    description: site.description,
  },
};

export const viewport: Viewport = {
  themeColor: "#0a0a0a",
  colorScheme: "dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <SkipLink targetId="main" placement="focus:left-4 focus:top-4 focus:z-[60]">
          Skip to content
        </SkipLink>
        {children}
      </body>
    </html>
  );
}
