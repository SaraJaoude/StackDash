// Crockford base32 drops I, L, O and U so ids read aloud or copied by hand
// cannot be confused with 1, 0 or V.
const CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const REFERENCE_ID_LENGTH = 8;

export const REFERENCE_ID_PATTERN = /^REF-[0-9ABCDEFGHJKMNPQRSTVWXYZ]{8}$/;

/** What a user sees when something fails: plain copy plus an id support can search logs for. */
export type UserFacingError = {
  message: string;
  referenceId: string;
};

export function newReferenceId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(REFERENCE_ID_LENGTH));
  let id = "REF-";
  for (const byte of bytes) {
    // 256 is a multiple of 32, so masking the low 5 bits stays uniform.
    id += CROCKFORD_ALPHABET.charAt(byte & 31);
  }
  return id;
}
