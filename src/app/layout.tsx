import type { Metadata, Viewport } from "next";
import { site } from "@/lib/site";
import { documentClassName } from "./fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: `${site.name}: coming soon`,
  description: site.description,
};

export const viewport: Viewport = {
  themeColor: "#0a0a0a",
  colorScheme: "dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={documentClassName}>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
