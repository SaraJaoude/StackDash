import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import PrivacyPage, { generateMetadata as privacyMetadata } from "@/app/privacy/page";
import TermsPage, { generateMetadata as termsMetadata } from "@/app/terms/page";
import { LegalConsent } from "@/components/legal/legal-consent";
import { LegalDocument } from "@/components/legal/legal-document";
import { SiteFooter } from "@/components/site-footer";

import { legalLinks, legalPages, PRIVACY_UPDATED, requireOperator, TERMS_UPDATED } from "./legal";

// Synthetic, and deliberately not the hosted instance's values: the text must come from here.
const OPERATOR = {
  DEVMACRO_OPERATOR_NAME: "Example Operator Ltd",
  DEVMACRO_OPERATOR_EMAIL: "privacy@example.com",
  DEVMACRO_GOVERNING_LAW: "Scotland",
} as const;

function stubOperator(values: Partial<Record<keyof typeof OPERATOR, string>>): void {
  for (const name of Object.keys(OPERATOR) as (keyof typeof OPERATOR)[]) vi.stubEnv(name, values[name] ?? "");
}

/** What `fn` threw; fails the test when it returned instead. */
function thrownBy(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("Expected a throw, but the call returned.");
}

// notFound() throws this digest (node_modules/next/dist/client/components/http-access-fallback).
const NOT_FOUND = { digest: "NEXT_HTTP_ERROR_FALLBACK;404" };

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("with an operator configured", () => {
  it("the privacy policy names the operator and its contact address, and links each provider page", () => {
    stubOperator(OPERATOR);
    const html = renderToStaticMarkup(createElement(PrivacyPage));

    expect(html).toContain("<h1");
    expect(html).toContain("Example Operator Ltd runs DevMacro at this address");
    expect(html).toContain('href="mailto:privacy@example.com"');
    expect(html).toContain('href="/docs/providers/stripe"');
    expect(html).toContain('href="/docs/providers/vercel"');
    expect(privacyMetadata()).toMatchObject({ title: "Privacy policy" });
  });

  it("the terms of use name the operator, its contact address, and the governing law", () => {
    stubOperator(OPERATOR);
    const html = renderToStaticMarkup(createElement(TermsPage));

    expect(html).toContain("which Example Operator Ltd runs");
    expect(html).toContain('href="mailto:privacy@example.com"');
    expect(html).toContain("governed by the law of Scotland");
    expect(html).not.toContain("England");
    expect(termsMetadata()).toMatchObject({ title: "Terms of use" });
  });

  it("each page shows its own date, and the sitemap sends the same one", () => {
    stubOperator(OPERATOR);

    expect(renderToStaticMarkup(createElement(PrivacyPage))).toContain(`<time dateTime="${PRIVACY_UPDATED}">`);
    expect(renderToStaticMarkup(createElement(TermsPage))).toContain(`<time dateTime="${TERMS_UPDATED}">`);
    // The shell shows the date it is given, so a change to one document never moves the other's.
    const shell = renderToStaticMarkup(LegalDocument({ title: "Terms of use", updated: "2027-01-02", intro: "", children: null }));
    expect(shell).toContain('<time dateTime="2027-01-02">2027-01-02</time>');
    expect(legalPages().map(({ link, updated }) => [link.href, updated])).toEqual([
      ["/privacy", PRIVACY_UPDATED],
      ["/terms", TERMS_UPDATED],
    ]);
  });

  it("the footer, the sign-in line, and the sitemap links lead to both pages", () => {
    stubOperator(OPERATOR);
    const footer = renderToStaticMarkup(createElement(SiteFooter));
    const consent = renderToStaticMarkup(createElement(LegalConsent));

    for (const html of [footer, consent]) {
      expect(html).toContain('href="/privacy"');
      expect(html).toContain('href="/terms"');
    }
    expect(consent).toContain("By continuing, you agree to the");
    expect(legalLinks().map((link) => link.href)).toEqual(["/privacy", "/terms"]);
    expect(requireOperator()).toEqual({
      name: "Example Operator Ltd",
      email: "privacy@example.com",
      governingLaw: "Scotland",
    });
  });
});

describe("with no operator configured", () => {
  it.each([
    ["the privacy policy", () => PrivacyPage()],
    ["the privacy policy's metadata", () => privacyMetadata()],
    ["the terms of use", () => TermsPage()],
    ["the terms of use's metadata", () => termsMetadata()],
  ])("%s answers 404", (_title, render) => {
    stubOperator({});
    expect(thrownBy(render)).toMatchObject(NOT_FOUND);
  });

  it("the footer, the sign-in line, and the sitemap links leave both pages out", () => {
    stubOperator({});
    const footer = renderToStaticMarkup(createElement(SiteFooter));

    expect(footer).toContain('href="/sign-in"');
    expect(footer).not.toContain('href="/privacy"');
    expect(footer).not.toContain('href="/terms"');
    expect(renderToStaticMarkup(createElement(LegalConsent))).toBe("");
    expect(legalLinks()).toEqual([]);
    expect(legalPages()).toEqual([]);
  });

  it("a partial configuration fails loudly instead of rendering a page with no contact", () => {
    stubOperator({ DEVMACRO_OPERATOR_NAME: OPERATOR.DEVMACRO_OPERATOR_NAME });
    expect(() => requireOperator()).toThrow(/DEVMACRO_OPERATOR_EMAIL is not set; DEVMACRO_GOVERNING_LAW is not set/);
  });
});
