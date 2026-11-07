import { AppError } from "../lib/errors";
import { postJson } from "./http";
import type { ChatSession, LlmClient, ModelTurn, ToolResult, ToolSpec } from "./types";

/** Google Gemini via the REST API with native function calling. The key is sent in a header, never in the URL. */
export class GeminiClient implements LlmClient {
  readonly provider = "gemini";
  constructor(
    private apiKey: string,
    readonly model: string,
    private timeoutMs: number,
  ) {}

  startChat({ system, tools }: { system: string; tools: ToolSpec[] }): ChatSession {
    const contents: any[] = [];
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`;

    const call = async (): Promise<ModelTurn> => {
      const data = await postJson(
        url,
        {
          systemInstruction: { parts: [{ text: system }] },
          contents,
          tools: [{ functionDeclarations: tools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters })) }],
          toolConfig: { functionCallingConfig: { mode: "AUTO" } },
          generationConfig: { temperature: 0.4, maxOutputTokens: 32768 },
        },
        { "x-goog-api-key": this.apiKey },
        { timeoutMs: this.timeoutMs, provider: "gemini", secret: this.apiKey },
      );

      const candidate = data?.candidates?.[0];
      const content = candidate?.content;
      if (!content?.parts?.length) {
        const reason = candidate?.finishReason || data?.promptFeedback?.blockReason || "empty response";
        throw new AppError("upstream", `The AI provider (gemini) returned no content (${reason}).`);
      }
      // Keep the model turn exactly as returned (includes thought signatures needed for the next call).
      contents.push(content);

      const turn: ModelTurn = { text: "", toolCalls: [] };
      content.parts.forEach((p: any, i: number) => {
        if (p.functionCall) {
          turn.toolCalls.push({ id: p.functionCall.id ?? `call_${contents.length}_${i}`, name: p.functionCall.name, args: p.functionCall.args ?? {} });
        } else if (typeof p.text === "string" && !p.thought) {
          turn.text += p.text;
        }
      });
      return turn;
    };

    return {
      send: async (userText: string) => {
        contents.push({ role: "user", parts: [{ text: userText }] });
        return call();
      },
      sendToolResults: async (results: ToolResult[]) => {
        contents.push({
          role: "user",
          parts: results.map((r) => ({
            functionResponse: { name: r.name, response: { result: r.result }, ...(r.id.startsWith("call_") ? {} : { id: r.id }) },
          })),
        });
        return call();
      },
    };
  }
}
