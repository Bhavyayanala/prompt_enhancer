/** Provider-neutral view of a tool-calling chat. Each provider keeps its own message history. */

export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  /** Parsed arguments, or undefined when the provider sent arguments that were not valid JSON. */
  args: unknown;
  /** Set when the raw arguments could not be parsed. The loop reports it back to the model. */
  argsError?: string;
}

export interface ModelTurn {
  /** Text the model produced in this turn (may be empty when it only calls tools). */
  text: string;
  toolCalls: ToolCall[];
}

export interface ToolResult {
  id: string;
  name: string;
  result: unknown;
}

export interface ChatSession {
  /** Sends the first user message. */
  send(userText: string): Promise<ModelTurn>;
  /** Sends tool results back to the model and returns its next turn. */
  sendToolResults(results: ToolResult[]): Promise<ModelTurn>;
}

export interface LlmClient {
  readonly provider: string;
  readonly model: string;
  startChat(opts: { system: string; tools: ToolSpec[] }): ChatSession;
}
