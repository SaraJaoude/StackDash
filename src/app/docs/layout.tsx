import { SiteFooter } from "@/components/site-footer";
import { SiteNav } from "@/components/site-nav";

// Each docs page renders its own <main id="main" tabIndex={-1}>, beside the doc list where it has one.
export default function DocsLayout({ children }: LayoutProps<"/docs">) {
  return (
    <>
      <SiteNav anchorBase="/" />
      {children}
      <SiteFooter anchorBase="/" />
    </>
  );
}
