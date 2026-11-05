import type { Metadata, Viewport } from "next";
import { site } from "@/lib/site";
import { documentClassName } from "./fonts";
import "./globals.css";

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
    <html lang="en" className={documentClassName}>
      <body className="flex min-h-full flex-col">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[60] focus:rounded-md focus:bg-foreground focus:px-3 focus:py-2 focus:text-sm focus:text-background"
        >
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
