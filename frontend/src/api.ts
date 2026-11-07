export type Style = "short" | "detailed" | "technical";

export interface Step {
  step: number;
  tool: string;
  input: unknown;
  output: unknown;
  ok: boolean;
  durationMs: number;
}

export interface EnhanceResponse {
  original: string;
  enhanced: string;
  questions: string[];
  assumptions: string[];
  changes: string[];
  score: { before: number; after: number };
  steps: Step[];
  warning: string | null;
  meta?: { provider: string; model: string; style: Style; mode: "new" | "update"; modelTurns: number; durationMs: number };
}

// The backend URL comes from configuration (build-time env), never hard-coded.
const API_URL = (import.meta.env.VITE_API_URL ?? "").replace(/\/+$/, "");

export async function enhance(body: { prompt: string; style: Style; previousPlan: string | null }): Promise<EnhanceResponse> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api/enhance`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error("Could not reach the backend. Is it running?");
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(data?.error ? `${data.error} (HTTP ${res.status})` : `Request failed with HTTP ${res.status}`);
  }
  return data as EnhanceResponse;
}
