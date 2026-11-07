/** Errors that map to a specific HTTP status in the API and a clean message in the CLI. */
export type AppErrorKind =
  | "validation" // 400
  | "config" // 500: key missing or invalid
  | "rate_limit" // 429
  | "upstream" // 502
  | "timeout"; // 504

const STATUS: Record<AppErrorKind, number> = {
  validation: 400,
  config: 500,
  rate_limit: 429,
  upstream: 502,
  timeout: 504,
};

export class AppError extends Error {
  readonly kind: AppErrorKind;
  readonly status: number;
  constructor(kind: AppErrorKind, message: string) {
    super(message);
    this.name = "AppError";
    this.kind = kind;
    this.status = STATUS[kind];
  }
}

/** Removes anything that looks like an API key from a string before it is logged or returned. */
export function redact(text: string, secrets: string[] = []): string {
  let out = text;
  for (const s of secrets) {
    if (s && s.length >= 6) out = out.split(s).join("[REDACTED]");
  }
  return out
    .replace(/AIza[0-9A-Za-z_\-]{20,}/g, "[REDACTED]")
    .replace(/gsk_[0-9A-Za-z]{20,}/g, "[REDACTED]")
    .replace(/([?&]key=)[^&\s"]+/gi, "$1[REDACTED]")
    .replace(/(Bearer\s+)[^\s"]+/gi, "$1[REDACTED]");
}
