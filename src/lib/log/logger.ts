import "server-only";

import { redactFields, redactString } from "@/lib/log/redact";
import { newReferenceId } from "@/lib/log/reference";

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogFields = Record<string, unknown>;

/** Minimal logger shape handed to adapters and other server modules. */
export interface Logger {
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
}

export interface AppLogger extends Logger {
  debug(event: string, fields?: LogFields): void;
}

function serialize(level: LogLevel, event: string, fields: LogFields | undefined): string {
  // Reserved keys are written last so a field can never spoof them.
  const record = {
    ...(fields === undefined ? {} : redactFields(fields)),
    ts: new Date().toISOString(),
    level,
    event: redactString(event),
  };
  try {
    return JSON.stringify(record);
  } catch (error) {
    // redact() returns JSON-safe data, so this is a defect; still emit a line
    // rather than lose the event.
    return JSON.stringify({
      ts: record.ts,
      level,
      event: record.event,
      serializationError: error instanceof Error ? redactString(error.message) : "unknown",
    });
  }
}

function write(level: LogLevel, event: string, fields?: LogFields): void {
  if (level === "debug" && process.env.NODE_ENV === "production") return;
  const line = `${serialize(level, event, fields)}\n`;
  const stream = level === "warn" || level === "error" ? process.stderr : process.stdout;
  stream.write(line);
}

export const log: AppLogger = {
  debug: (event, fields) => write("debug", event, fields),
  info: (event, fields) => write("info", event, fields),
  warn: (event, fields) => write("warn", event, fields),
  error: (event, fields) => write("error", event, fields),
};

/**
 * Logs `error` (redacted) under a fresh reference id and returns that id so the
 * caller can show it to the user instead of any error detail.
 */
export function logError(event: string, error: unknown, fields?: LogFields): string {
  const referenceId = newReferenceId();
  write("error", event, { ...fields, referenceId, error });
  return referenceId;
}
