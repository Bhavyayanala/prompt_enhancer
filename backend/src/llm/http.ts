import { AppError, redact } from "../lib/errors";

/**
 * fetch() with a hard timeout and error mapping shared by every provider:
 * 401/403 or invalid key -> 500 config error, 429 -> rate limit, 5xx/network -> 502, timeout -> 504.
 */
export async function postJson(
  url: string,
  body: unknown,
  headers: Record<string, string>,
  opts: { timeoutMs: number; provider: string; secret: string },
): Promise<any> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(opts.timeoutMs),
    });
  } catch (err: any) {
    if (err?.name === "TimeoutError" || err?.name === "AbortError") {
      throw new AppError("timeout", `The AI provider (${opts.provider}) did not answer within ${Math.round(opts.timeoutMs / 1000)} seconds.`);
    }
    throw new AppError("upstream", `Could not reach the AI provider (${opts.provider}): ${redact(String(err?.message ?? err), [opts.secret])}`);
  }

  const raw = await res.text();
  let data: any = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    /* non-JSON error page */
  }

  if (res.ok) return data;

  const providerMsg = redact(String(data?.error?.message ?? raw ?? "").slice(0, 300), [opts.secret]);
  const keyProblem = /api[_ ]?key|invalid.*key|unauthori[sz]ed|permission/i.test(providerMsg);
  if (res.status === 401 || res.status === 403 || (res.status === 400 && keyProblem)) {
    throw new AppError("config", `The ${opts.provider} API key is missing or invalid. Check the key in your .env file.`);
  }
  if (res.status === 429) {
    throw new AppError("rate_limit", `The AI provider (${opts.provider}) rate limit was reached. Wait a minute and try again.`);
  }
  if (res.status === 404) {
    throw new AppError("config", `The configured ${opts.provider} model was not found: ${providerMsg}`);
  }
  if (res.status === 408 || res.status === 504) {
    throw new AppError("timeout", `The AI provider (${opts.provider}) timed out.`);
  }
  throw new AppError("upstream", `The AI provider (${opts.provider}) failed with status ${res.status}: ${providerMsg}`);
}
