import { Router } from "express";
import { runAgent } from "../agent/agent";
import { getConfig } from "../lib/config";
import { logger } from "../lib/logger";
import { createLlmClient } from "../llm/client";
import type { LlmClient } from "../llm/types";
import { validateEnhanceInput } from "./validate";

/** POST /api/enhance. The LLM factory is injectable so tests can use a fake model. */
export function enhanceRouter(makeLlm: () => LlmClient = () => createLlmClient(getConfig())) {
  const router = Router();
  router.post("/enhance", async (req, res) => {
    const input = validateEnhanceInput(req.body);
    const llm = makeLlm();
    logger.info("enhance request", { chars: input.prompt.length, style: input.style, update: !!input.previousPlan, provider: llm.provider });
    const result = await runAgent(input, { llm, maxSteps: getConfig().maxSteps });
    res.json(result);
  });
  return router;
}
