import path from "node:path";
import dotenv from "dotenv";

// Local development convenience: read ../.env (repo root) or ./.env if present.
// In Docker the variables arrive through env_file at runtime, never baked into the image.
dotenv.config({ path: path.resolve(__dirname, "../../../.env"), quiet: true } as dotenv.DotenvConfigOptions);
dotenv.config({ quiet: true } as dotenv.DotenvConfigOptions);

export type ProviderName = "gemini" | "groq" | "mock";

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function getConfig() {
  const provider = (process.env.LLM_PROVIDER || "gemini").toLowerCase() as ProviderName;
  return {
    port: num("PORT", 4000),
    provider,
    geminiApiKey: process.env.GEMINI_API_KEY?.trim() || "",
    geminiModel: process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash",
    groqApiKey: process.env.GROQ_API_KEY?.trim() || "",
    groqModel: process.env.GROQ_MODEL?.trim() || "llama-3.3-70b-versatile",
    /** Timeout for one call to the AI provider. */
    aiTimeoutMs: num("AI_TIMEOUT_MS", 60_000),
    /** Maximum number of tool calls the agent may make in one run. */
    maxSteps: num("AGENT_MAX_STEPS", 5),
    /** Comma separated list of allowed browser origins. "*" allows all. */
    corsOrigin: process.env.CORS_ORIGIN?.trim() || "*",
  };
}

export type AppConfig = ReturnType<typeof getConfig>;
