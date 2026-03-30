export interface HAVoiceConfig {
  url: string;
  token: string;
  sttProvider: string;
  ttsEngine: string;
  language: string;
  ttsVoice: string;
  routingEnabled: boolean;
  routingModel: string;
  llmUrl: string;
  haConversationAgent: string;
}

export function validateConfig(raw: unknown): HAVoiceConfig {
  if (!raw || typeof raw !== "object") {
    throw new Error("ha-voice config must be a non-null object");
  }

  const obj = raw as Record<string, unknown>;
  const errors: string[] = [];

  if (!obj.url || typeof obj.url !== "string") {
    errors.push("url is required (string)");
  }
  if (!obj.token || typeof obj.token !== "string") {
    errors.push("token is required (string)");
  }

  if (errors.length > 0) {
    throw new Error(`Invalid ha-voice config:\n  - ${errors.join("\n  - ")}`);
  }

  const url = (obj.url as string).trim().replace(/\/+$/, "");

  return {
    url,
    token: (obj.token as string).trim(),
    sttProvider: typeof obj.sttProvider === "string" ? obj.sttProvider.trim() : "stt.home_assistant_cloud",
    ttsEngine: typeof obj.ttsEngine === "string" ? obj.ttsEngine.trim() : "tts.home_assistant_cloud",
    language: typeof obj.language === "string" ? obj.language.trim() : "de-DE",
    ttsVoice: typeof obj.ttsVoice === "string" ? obj.ttsVoice.trim() : "KatjaNeural",
    routingEnabled: obj.routingEnabled !== false,
    routingModel: typeof obj.routingModel === "string" ? obj.routingModel.trim() : "Qwen3.5-9B-Opus-Distilled-v2-Q4_K_M",
    llmUrl: typeof obj.llmUrl === "string" ? obj.llmUrl.trim() : "http://localhost:8080",
    haConversationAgent: typeof obj.haConversationAgent === "string" ? obj.haConversationAgent.trim() : "conversation.home_llm",
  };
}
