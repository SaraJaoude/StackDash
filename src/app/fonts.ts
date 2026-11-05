import { Geist, Geist_Mono } from "next/font/google";

// Loaded once and shared by the two documents the app renders: the root layout and the global
// not-found page, which renders its own <html> ("Using a font definitions file" in the next/font
// reference).
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/** Classes for the <html> element of every document. */
export const documentClassName = `${geistSans.variable} ${geistMono.variable} h-full antialiased`;
