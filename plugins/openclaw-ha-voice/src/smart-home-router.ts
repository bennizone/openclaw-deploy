import { HAVoiceConfig } from "./config";

export type Classification = "READ" | "CONTROL" | "OTHER";

const CLASSIFY_SYSTEM = `Classify the user message. Respond with ONLY one word.

READ = questions about the home: temperature, humidity, climate, sensor values, light status, device status, which lights are on, is a window open, how warm is it
CONTROL = commands to change something: turn on/off lights, set temperature, dim lights, activate scenes, lock doors
OTHER = everything NOT about the home: jokes, weather forecast, news, recipes, general knowledge, smalltalk

Examples:
"Wie warm ist es im Wohnzimmer?" → READ
"Ist das Fenster offen?" → READ
"Welche Lichter sind an?" → READ
"Mach das Licht an" → CONTROL
"Stelle die Heizung auf 22 Grad" → CONTROL
"Erzähl mir einen Witz" → OTHER
"Wie wird das Wetter?" → OTHER`;

/**
 * Classify a user query as READ/CONTROL/OTHER using a fast local LLM.
 * READ = status query (handle via Ollama with entity context)
 * CONTROL = device command (handle via HA native conversation API)
 * OTHER = non-smart-home (handle via MiniMax)
 * Typically completes in ~250ms.
 */
export async function classifyQuery(query: string, config: HAVoiceConfig): Promise<Classification> {
  const llmUrl = config.llmUrl;
  const model = config.routingModel;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);

  try {
    const response = await fetch(`${llmUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        max_tokens: 5,
        temperature: 0.1,
        chat_template_kwargs: { enable_thinking: false },
        messages: [
          { role: "system", content: CLASSIFY_SYSTEM },
          { role: "user", content: query },
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`LLM classify HTTP ${response.status}`);
    }

    const result = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const answer = (result.choices?.[0]?.message?.content ?? "").trim().toUpperCase();

    if (answer.startsWith("READ")) return "READ";
    if (answer.startsWith("CONTROL")) return "CONTROL";
    return "OTHER";
  } catch {
    // On any error, fall through to MiniMax
    return "OTHER";
  } finally {
    clearTimeout(timer);
  }
}

/** Stored HA conversation IDs per OpenClaw session for context continuity. */
const haConversationIds = new Map<string, string>();

/**
 * Execute a command via HA's native conversation agent.
 * Uses HA's built-in Ollama integration which has direct entity control.
 * Maintains conversation_id per session for context (pronouns like "mach es aus").
 */
export async function executeHaConversation(
  query: string,
  config: HAVoiceConfig,
  sessionKey?: string,
): Promise<{ text: string; conversationId?: string } | null> {
  const agentId = config.haConversationAgent ?? "conversation.ministral_3_3b";
  const existingConvId = sessionKey ? haConversationIds.get(sessionKey) : undefined;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);

  try {
    const response = await fetch(`${config.url}/api/conversation/process`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text: query,
        language: "de",
        agent_id: agentId,
        ...(existingConvId ? { conversation_id: existingConvId } : {}),
      }),
      signal: controller.signal,
    });

    if (!response.ok) return null;

    const result = (await response.json()) as {
      response?: { speech?: { plain?: { speech?: string } } };
      conversation_id?: string;
    };

    const text = result.response?.speech?.plain?.speech;
    if (!text) return null;

    // Store conversation_id for context continuity
    const convId = result.conversation_id;
    if (sessionKey && convId) {
      haConversationIds.set(sessionKey, convId);
    }

    return { text, conversationId: convId };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
