import { AppError } from "../lib/errors";
import type { EnhanceInput } from "../agent/agent";
import type { PlanStyle } from "../agent/systemPrompt";

export const MAX_PROMPT_CHARS = 2000;
export const MAX_PREVIOUS_PLAN_CHARS = 60_000;
const STYLES: PlanStyle[] = ["short", "detailed", "technical"];

/** Validates an /api/enhance body (also used by the CLI). Throws a 400 AppError with a clear message. */
export function validateEnhanceInput(body: unknown): EnhanceInput {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new AppError("validation", "Request body must be a JSON object.");
  }
  const { prompt, style, previousPlan } = body as Record<string, unknown>;

  if (prompt === undefined || prompt === null) throw new AppError("validation", '"prompt" is required.');
  if (typeof prompt !== "string") throw new AppError("validation", '"prompt" must be a string.');
  if (!prompt.trim()) throw new AppError("validation", '"prompt" must not be empty.');
  if (prompt.length > MAX_PROMPT_CHARS) {
    throw new AppError("validation", `"prompt" must be at most ${MAX_PROMPT_CHARS} characters (got ${prompt.length}).`);
  }

  if (style !== undefined && style !== null && (typeof style !== "string" || !STYLES.includes(style as PlanStyle))) {
    throw new AppError("validation", `"style" must be one of: ${STYLES.join(", ")}.`);
  }

  if (previousPlan !== undefined && previousPlan !== null && typeof previousPlan !== "string") {
    throw new AppError("validation", '"previousPlan" must be a string or null.');
  }
  if (typeof previousPlan === "string" && previousPlan.length > MAX_PREVIOUS_PLAN_CHARS) {
    throw new AppError("validation", `"previousPlan" must be at most ${MAX_PREVIOUS_PLAN_CHARS} characters.`);
  }

  return {
    prompt: prompt.trim(),
    style: (style as PlanStyle) || "detailed",
    previousPlan: typeof previousPlan === "string" && previousPlan.trim() ? previousPlan : null,
  };
}
