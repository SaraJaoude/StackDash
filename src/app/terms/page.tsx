import type { Metadata } from "next";

import { LegalDocument, LegalLink, LegalSection } from "@/components/legal/legal-document";
import { requireOperator, TERMS_UPDATED } from "@/lib/legal";
import { privacyLink, site, termsLink } from "@/lib/site";
import { socialMetadata } from "@/lib/site-metadata";

/*
 * The terms of use (#339). The operator, contact, and governing law come from server configuration
 * (`operatorEnv`), and an instance without them answers 404. Prerendered like the privacy policy,
 * and 'navigation' keeps it that way (node_modules/next/dist/docs/01-app/02-guides/keeping-pages-static.md).
 */
export const ensureStatic = "navigation";

const description = `The terms for using ${site.name}: your account, the services you connect, what you publish, and acceptable use.`;

export function generateMetadata(): Metadata {
  requireOperator();
  return {
    title: "Terms of use",
    description,
    ...socialMetadata({ title: "Terms of use", description, path: termsLink.href }),
  };
}

export default function TermsPage() {
  const operator = requireOperator();
  const contact = <LegalLink href={`mailto:${operator.email}`}>{operator.email}</LegalLink>;

  return (
    <LegalDocument
      title="Terms of use"
      updated={TERMS_UPDATED}
      intro={
        <>
          These terms apply when you use {site.name} at this address, which {operator.name} runs. By signing in, you
          agree to them. How we handle your data is in the <LegalLink href={privacyLink.href}>privacy policy</LegalLink>.
          Questions go to {contact}.
        </>
      }
    >
      <LegalSection id="service" title="The service">
        <p>
          {site.name} shows the usage, spend, and activity of the developer services you connect, in one timeline,
          and alerts you when something changes. It is in an invite only test: features change, and parts of it may be
          unavailable, change, or be removed without notice. {site.name} does not charge for the service during the
          test.
        </p>
      </LegalSection>

      <LegalSection id="account" title="Your account">
        <p>
          You sign in with your own GitHub account, and you are responsible for what is done with your {site.name}{" "}
          account and in the workspaces you own. Keep your GitHub account and any API keys you create secure, and
          revoke a key you no longer use.
        </p>
      </LegalSection>

      <LegalSection id="connected-services" title="Services you connect">
        <p>
          Connect only accounts you are allowed to connect, and grant only access you are allowed to grant. Each
          service&apos;s own terms still apply to your account there. You can disconnect a service at any time.
        </p>
      </LegalSection>

      <LegalSection id="publishing" title="What you publish">
        <p>
          Nothing is public until an owner or admin of a workspace publishes it. Once published, a metric can be read
          by anyone until it is unpublished. Publish only what you have the right to share.
        </p>
      </LegalSection>

      <LegalSection id="acceptable-use" title="Acceptable use">
        <p>Do not:</p>
        <ul>
          <li>try to reach a workspace, account, or data that is not yours;</li>
          <li>interfere with the service or with other people using it;</li>
          <li>get around the invite list, rate limits, or other limits;</li>
          <li>use {site.name} to break the law or another service&apos;s terms.</li>
        </ul>
        <p>If you find a security problem, report it to {contact} rather than testing it against other people&apos;s data.</p>
      </LegalSection>

      <LegalSection id="figures" title="Figures and alerts">
        <p>
          Figures come from the services you connect. They can be late, estimated, or incomplete, and {site.name}{" "}
          labels a figure as estimated where it knows that it is. Alerts can arrive late or not at all. Check a figure
          with the service itself before you rely on it for a decision that matters, such as a payment.
        </p>
      </LegalSection>

      <LegalSection id="ending" title="Ending">
        <p>
          You can stop using {site.name} and delete your account at any time on the{" "}
          <LegalLink href="/account">account page</LegalLink>. {operator.name} may suspend or close an account that
          breaks these terms, and may end the test.
        </p>
      </LegalSection>

      <LegalSection id="liability" title="No warranty">
        <p>
          {site.name} is provided as it is, without warranties, as far as the law allows. As far as the law allows,{" "}
          {operator.name} is not liable for indirect or consequential loss, or for loss caused by figures or alerts that
          come from the services you connect. Nothing in these terms limits liability that the law does not allow to be
          limited.
        </p>
      </LegalSection>

      <LegalSection id="changes" title="Changes to these terms">
        <p>
          When these terms change, the date at the top changes with it. Using {site.name} after a change means you
          accept the new terms.
        </p>
      </LegalSection>

      <LegalSection id="governing-law" title="Governing law">
        <p>
          These terms are governed by the law of {operator.governingLaw}, and the courts of {operator.governingLaw}{" "}
          settle any dispute about them.
        </p>
      </LegalSection>

      <LegalSection id="contact" title="Contact">
        <p>Write to {operator.name} at {contact}.</p>
      </LegalSection>
    </LegalDocument>
  );
}
