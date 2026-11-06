/** Single source of truth for site-wide constants. Update links here, nowhere else. */
export const site = {
  name: "DevMacro",
  tagline: "The big picture of your developer stack",
  description:
    "DevMacro is an open-source dashboard with one timeline and one alert for your whole developer stack: deploys, stars, signups, payments, and errors in one feed, and alerts by email, Slack, Discord, or webhook. Publish the stats you choose, and see spend and allowances where each provider reports them.",
  githubUrl: "https://github.com/eddiejaoude/DevMacro",
  founder: {
    name: "Eddie Jaoude",
    url: "https://github.com/eddiejaoude",
  },
} as const;

/** Every platform with a brand mark: the landing page's hero preview and live feed, and each provider. */
export type Platform =
  | "Vercel"
  | "GitHub"
  | "GitHub Actions"
  | "GitHub Copilot"
  | "Resend"
  | "Stripe"
  | "Supabase"
  | "DigitalOcean"
  | "PostHog"
  | "Polar"
  | "Sentry"
  | "Railway"
  | "GitLab";

export interface NavLink {
  label: string;
  href: string;
}

// Homepage sections in page order. The footer renders all of them; the header renders the
// subset in HEADER_LABELS so the two lists cannot drift apart.
export const sectionLinks: readonly NavLink[] = [
  { label: "The problem", href: "#problem" },
  { label: "How it works", href: "#how-it-works" },
  { label: "Features", href: "#features" },
  { label: "Integrations", href: "#integrations" },
  { label: "Security", href: "#security" },
  { label: "Open source", href: "#open-source" },
  { label: "Share progress", href: "#share" },
  { label: "Roadmap", href: "#roadmap" },
  { label: "FAQ", href: "#faq" },
];

const HEADER_LABELS = new Set(["How it works", "Features", "Integrations", "Security", "Roadmap"]);
export const navLinks: readonly NavLink[] = sectionLinks.filter((link) => HEADER_LABELS.has(link.label));

// A sectionLinks rename must fail loudly, not silently shrink the header.
if (navLinks.length !== HEADER_LABELS.size) {
  throw new Error("HEADER_LABELS names a label missing from sectionLinks: update both together");
}

// Pages outside the landing page. Kept apart from sectionLinks, which are all in-page anchors.
export const docsLink: NavLink = { label: "Docs", href: "/docs" };
export const signInLink: NavLink = { label: "Sign in", href: "/sign-in" };
