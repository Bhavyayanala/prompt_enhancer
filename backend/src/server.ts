import { createApp } from "./app";
import { getConfig } from "./lib/config";
import { logger } from "./lib/logger";

const cfg = getConfig();
const app = createApp();

const server = app.listen(cfg.port, () => {
  const keySet = cfg.provider === "gemini" ? !!cfg.geminiApiKey : cfg.provider === "groq" ? !!cfg.groqApiKey : true;
  logger.info("backend listening", { port: cfg.port, provider: cfg.provider, apiKeyConfigured: keySet });
});

// The agent can take a while (several model calls); keep sockets open long enough.
server.requestTimeout = 5 * 60_000;

function shutdown(signal: string) {
  logger.info("shutting down", { signal });
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("unhandledRejection", (reason) => logger.error("unhandled rejection", { reason: String(reason) }));
