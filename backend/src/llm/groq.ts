import { AppError } from "../lib/errors";
import { postJson } from "./http";
import type { ChatSession, LlmClient, ModelTurn, ToolResult, ToolSpec } from "./types";

/** Groq through its OpenAI-compatible chat completions API with native tool calling. */
export class GroqClient implements LlmClient {
  readonly provider = "groq";
  constructor(
    private apiKey: string,
    readonly model: string,
    private timeoutMs: number,
  ) {}

  startChat({ system, tools }: { system: string; tools: ToolSpec[] }): ChatSession {
    const messages: any[] = [{ role: "system", content: system }];

    const call = async (): Promise<ModelTurn> => {
      const data = await postJson(
        "https://api.groq.com/openai/v1/chat/completions",
        {
          model: this.model,
          messages,
          tools: tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } })),
          tool_choice: "auto",
          parallel_tool_calls: false,
          temperature: 0.4,
          max_tokens: 8000,
        },
        { authorization: `Bearer ${this.apiKey}` },
        { timeoutMs: this.timeoutMs, provider: "groq", secret: this.apiKey },
      );

      const msg = data?.choices?.[0]?.message;
      if (!msg) throw new AppError("upstream", "The AI provider (groq) returned no message.");
      messages.push(msg);

      return {
        text: typeof msg.content === "string" ? msg.content : "",
        toolCalls: (msg.tool_calls ?? []).map((tc: any) => {
          try {
            return { id: tc.id, name: tc.function?.name, args: JSON.parse(tc.function?.arguments || "{}") };
          } catch {
            return { id: tc.id, name: tc.function?.name, args: undefined, argsError: "Arguments were not valid JSON." };
          }
        }),
      };
    };

    return {
      send: async (userText: string) => {
        messages.push({ role: "user", content: userText });
        return call();
      },
      sendToolResults: async (results: ToolResult[]) => {
        for (const r of results) messages.push({ role: "tool", tool_call_id: r.id, content: JSON.stringify(r.result) });
        return call();
      },
    };
  }
}
