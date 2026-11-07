import cors from "cors";
import express, { type ErrorRequestHandler } from "express";
import { getConfig } from "./lib/config";
import { AppError, redact } from "./lib/errors";
import { logger } from "./lib/logger";
import type { LlmClient } from "./llm/types";
import { enhanceRouter } from "./routes/enhance";

export function createApp(makeLlm?: () => LlmClient) {
  const cfg = getConfig();
  const app = express();
  app.disable("x-powered-by");

  const origins = cfg.corsOrigin === "*" ? "*" : cfg.corsOrigin.split(",").map((o) => o.trim());
  app.use(cors({ origin: origins, methods: ["GET", "POST", "OPTIONS"] }));
  app.use(express.json({ limit: "256kb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.use("/api", enhanceRouter(makeLlm));

  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  // Central error handler: every failure becomes { error } with the right status, never a crash or a stack trace.
  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    if (err instanceof AppError) {
      logger.warn("request failed", { status: err.status, kind: err.kind, error: err.message });
      res.status(err.status).json({ error: redact(err.message) });
      return;
    }
    if (err?.type === "entity.parse.failed") {
      res.status(400).json({ error: "Request body is not valid JSON." });
      return;
    }
    if (err?.type === "entity.too.large") {
      res.status(413).json({ error: "Request body is too large." });
      return;
    }
    logger.error("unexpected error", { error: redact(String(err?.stack ?? err)) });
    res.status(500).json({ error: "Internal server error." });
  };
  app.use(onError);

  return app;
}
