import type { AppConfig } from "../lib/config";
import { AppError } from "../lib/errors";
import { GeminiClient } from "./gemini";
import { GroqClient } from "./groq";
import { MockClient } from "./mock";
import type { LlmClient } from "./types";

/** Builds the configured provider. Throws a 500-class config error when the key is missing. */
export function createLlmClient(cfg: AppConfig): LlmClient {
  switch (cfg.provider) {
    case "gemini":
      if (!cfg.geminiApiKey) throw new AppError("config", "GEMINI_API_KEY is not set. Add it to your .env file (see .env.example).");
      return new GeminiClient(cfg.geminiApiKey, cfg.geminiModel, cfg.aiTimeoutMs);
    case "groq":
      if (!cfg.groqApiKey) throw new AppError("config", "GROQ_API_KEY is not set. Add it to your .env file (see .env.example).");
      return new GroqClient(cfg.groqApiKey, cfg.groqModel, cfg.aiTimeoutMs);
    case "mock":
      return new MockClient();
    default:
      throw new AppError("config", `Unknown LLM_PROVIDER "${cfg.provider}". Use gemini, groq or mock.`);
  }
}
