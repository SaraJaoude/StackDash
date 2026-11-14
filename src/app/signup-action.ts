"use server";

import { Resend } from "resend";

export type SignupState =
  | { status: "idle" }
  | { status: "invalid"; email: string }
  | { status: "failed"; email: string; reference: string }
  | { status: "saved" };

// A person takes longer than this to type an address and press the button; a script does not.
const MIN_FILL_MS = 2000;
// Resend's limit on a contact's email address.
const MAX_EMAIL_LENGTH = 320;
// One @, text on both sides, and a dot in the domain. It also refuses the characters that would
// change the request path, because the SDK puts the address in Resend URLs without encoding it.
const EMAIL_PATTERN = /^[^\s@/?#%]+@[^\s@/?#%]+\.[^\s@/?#%]+$/;

/**
 * Adds an email address to the launch list: a Resend contact in the RESEND_SEGMENT_ID segment
 * (#440). Single opt-in, so nothing is sent now. A bot that fills the honeypot or submits too fast
 * is told it worked, so it has nothing to retry against. The address never goes in a log.
 */
export async function signUp(_previous: SignupState, formData: FormData): Promise<SignupState> {
  const email = String(formData.get("email") ?? "").trim();

  if (String(formData.get("website") ?? "") !== "") return { status: "saved" };
  // Set by the form once it hydrates; absent without JavaScript, when only the honeypot applies.
  const startedAt = Number(formData.get("started"));
  if (startedAt > 0 && Date.now() - startedAt < MIN_FILL_MS) return { status: "saved" };

  if (email.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(email)) return { status: "invalid", email };

  const reference = crypto.randomUUID().slice(0, 8);
  const failed = (detail: string): SignupState => {
    console.error(`[signup ${reference}] ${detail}`);
    return { status: "failed", email, reference };
  };

  const apiKey = process.env.RESEND_API_KEY;
  const segmentId = process.env.RESEND_SEGMENT_ID;
  if (!apiKey || !segmentId) return failed("RESEND_API_KEY or RESEND_SEGMENT_ID is not set");

  const resend = new Resend(apiKey);
  const created = await resend.contacts.create({ email, unsubscribed: false, segments: [{ id: segmentId }] });
  if (created.error === null) return { status: "saved" };

  // Resend does not document what creating an existing contact returns, so look the address up.
  // An existing contact joins the segment and keeps its unsubscribe status: a stranger typing
  // someone's address must not sign them back up after they left. The visitor sees the same
  // message either way, so the form never says whether an address is already on the list.
  const existing = await resend.contacts.get({ email });
  if (existing.error !== null) {
    return failed(`create: ${created.error.name}; lookup: ${existing.error.name}`);
  }
  const added = await resend.contacts.segments.add({ email, segmentId });
  if (added.error !== null) {
    // Most likely already in the segment. Logged so a real failure is still visible.
    console.warn(`[signup ${reference}] existing contact, segment add: ${added.error.name}`);
  }
  return { status: "saved" };
}
