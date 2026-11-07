import { redact } from "./errors";

type Level = "info" | "warn" | "error";

function secrets(): string[] {
  return [process.env.GEMINI_API_KEY || "", process.env.GROQ_API_KEY || ""];
}

/** Tiny structured logger. Every line goes through redact() so a key can never reach the logs. */
function write(level: Level, msg: string, meta?: Record<string, unknown>) {
  if (process.env.LOG_SILENT === "1") return;
  const line = JSON.stringify({ time: new Date().toISOString(), level, msg, ...(meta ?? {}) });
  const safe = redact(line, secrets());
  // Logs go to stderr so CLI stdout stays clean for the plan itself.
  process.stderr.write(safe + "\n");
}

export const logger = {
  info: (msg: string, meta?: Record<string, unknown>) => write("info", msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => write("warn", msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => write("error", msg, meta),
};
