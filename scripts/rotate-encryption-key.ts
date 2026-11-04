/*
 * Re-encrypts stored connection credentials under the current encryption key (issue #35).
 *
 * Run with `npm run keys:rotate`. Reads `.env.local` when present; otherwise the variables must
 * already be in the environment (hosted: run it where the production variables are set).
 *
 * Rotating the encryption key
 *
 * 1. Generate a new key: `openssl rand -base64 32`.
 * 2. Work out the id of the key in use now (the first 8 hex chars of its SHA-256):
 *    `printf '%s' "$OLD_KEY" | openssl base64 -d -A | shasum -a 256 | cut -c1-8`
 *    (this script also prints the current key id each time it runs).
 * 3. Set `DEVMACRO_ENCRYPTION_KEY` to the new key and add the old one to
 *    `DEVMACRO_ENCRYPTION_KEYS_PREVIOUS` as `oldKeyId:oldBase64Key` (comma separate several).
 *    Deploy. From now on new credentials are sealed with the new key and old rows still decrypt,
 *    so nothing goes down.
 * 4. Once every running instance has the new configuration, run `npm run keys:rotate`. It prints
 *    counts only and is safe to re-run; repeat until "remaining" is 0.
 * 5. Wait until pending OAuth states sealed with the old key have expired (they are short lived),
 *    then remove the old entry from `DEVMACRO_ENCRYPTION_KEYS_PREVIOUS` and deploy again.
 *
 * Rows that cannot be decrypted (key not configured, or failed authentication) are counted as
 * unreadable and left untouched; those connections need reconnecting. The exit code is 1 when any
 * row was unreadable.
 *
 * Each row is updated with a compare-and-set on its old key id and IV, so a credential written
 * concurrently by the app (for example a token refresh) is never overwritten with stale content.
 */
import { existsSync } from "node:fs";

import {
  currentKeyId,
  decryptSecret,
  credentialAad,
  DecryptionFailedError,
  encryptSecret,
  UnknownEncryptionKeyError,
} from "@/lib/crypto/credentials";
import { encryptedFromRow, encryptedToColumns } from "@/lib/data/credentials";
import { createAdminClient } from "@/lib/supabase/admin";

const BATCH_SIZE = 100;

type Counts = { scanned: number; rotated: number; skipped: number; unreadable: number };

async function main(): Promise<number> {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");

  const supabase = createAdminClient();
  const keyId = currentKeyId();
  const counts: Counts = { scanned: 0, rotated: 0, skipped: 0, unreadable: 0 };
  console.log(`Current key id: ${keyId}`);

  // Keyset pagination by primary key: rotated rows drop out of the filter, so offsets would skip
  // rows, while a cursor visits each remaining row exactly once per run.
  let cursor: string | null = null;
  for (;;) {
    let query = supabase
      .from("connection_credentials")
      .select("connection_id, workspace_id, key_id, iv, ciphertext, auth_tag")
      .neq("key_id", keyId)
      .order("connection_id", { ascending: true })
      .limit(BATCH_SIZE);
    if (cursor !== null) query = query.gt("connection_id", cursor);
    const { data: rows, error } = await query;
    if (error) throw new Error(`Reading connection_credentials failed (code ${error.code}).`);

    for (const row of rows) {
      counts.scanned += 1;
      const aad = credentialAad(row.workspace_id, row.connection_id);
      let plaintext: string;
      try {
        plaintext = decryptSecret(encryptedFromRow(row), aad);
      } catch (decryptError) {
        if (
          decryptError instanceof UnknownEncryptionKeyError ||
          decryptError instanceof DecryptionFailedError
        ) {
          counts.unreadable += 1;
          continue;
        }
        throw decryptError;
      }

      const { data: updated, error: updateError } = await supabase
        .from("connection_credentials")
        .update({ ...encryptedToColumns(encryptSecret(plaintext, aad)), updated_at: new Date().toISOString() })
        .eq("connection_id", row.connection_id)
        .eq("key_id", row.key_id)
        .eq("iv", row.iv)
        .select("connection_id");
      if (updateError) {
        throw new Error(`Updating connection_credentials failed (code ${updateError.code}).`);
      }
      // No row matched: the app replaced this credential since it was read, so the newer value
      // (already under the current key, or picked up on the next run) wins.
      if (updated.length === 0) counts.skipped += 1;
      else counts.rotated += 1;
    }

    const last = rows.at(-1);
    if (last === undefined || rows.length < BATCH_SIZE) break;
    cursor = last.connection_id;
  }

  const { count: remaining, error: countError } = await supabase
    .from("connection_credentials")
    .select("connection_id", { count: "exact", head: true })
    .neq("key_id", keyId);
  if (countError) throw new Error(`Counting connection_credentials failed (code ${countError.code}).`);

  console.log(
    `Scanned ${counts.scanned}, rotated ${counts.rotated}, skipped ${counts.skipped} (changed concurrently), unreadable ${counts.unreadable}, remaining on old keys ${remaining ?? "unknown"}.`,
  );
  return counts.unreadable > 0 ? 1 : 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    // Errors raised on this path name variables, key ids, and Postgres codes, never values.
    console.error(
      error instanceof Error && error.message.length > 0
        ? `Rotation failed: ${error.message}`
        : "Rotation failed.",
    );
    process.exitCode = 1;
  },
);
