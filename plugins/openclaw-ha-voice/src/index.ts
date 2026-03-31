import { validateConfig } from "./config";
import { HAVoiceClient } from "./ha-client";
import { mp3ToOggOpus, audioToOggOpus } from "./ffmpeg";
import { sanitizeCjk, hasCjk } from "./sanitize";

// ---------------------------------------------------------------------------
// Types — minimal, matching the OpenClaw plugin API surface we use
// ---------------------------------------------------------------------------

interface PluginApi {
  id: string;
  pluginConfig?: Record<string, unknown>;
  logger: {
    debug?: (msg: string) => void;
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
  };
  registerMediaUnderstandingProvider: (provider: MediaUnderstandingProvider) => void;
  on: (hookName: string, handler: (...args: unknown[]) => unknown, opts?: { priority?: number }) => void;
  runtime: {
    channel: {
      whatsapp: {
        sendMessageWhatsApp: (to: string, body: string, options: Record<string, unknown>) => Promise<unknown>;
      };
      media: {
        saveMediaBuffer: (buffer: Buffer, mime: string, subdir: string, maxBytes: number, fileName?: string) => Promise<{ path: string }>;
      };
    };
  };
}

interface MediaUnderstandingProvider {
  id: string;
  capabilities?: string[];
  transcribeAudio?: (req: AudioTranscriptionRequest) => Promise<AudioTranscriptionResult>;
}

interface AudioTranscriptionRequest {
  buffer: Buffer;
  fileName: string;
  mime?: string;
  apiKey: string;
  baseUrl?: string;
  headers?: Record<string, string>;
  model?: string;
  language?: string;
  prompt?: string;
  query?: Record<string, string | number | boolean>;
  timeoutMs: number;
  fetchFn?: typeof fetch;
}

interface AudioTranscriptionResult {
  text: string;
  model?: string;
}

// ---------------------------------------------------------------------------
// Voice conversation tracker — keyed by sessionKey
// ---------------------------------------------------------------------------

interface VoiceEntry {
  to: string;
  accountId?: string;
  timestamp: number;
}

const voiceConversations = new Map<string, VoiceEntry>();
const VOICE_CONV_TTL_MS = 5 * 60 * 1000;

function cleanExpired(): void {
  const now = Date.now();
  for (const [key, entry] of voiceConversations) {
    if (now - entry.timestamp > VOICE_CONV_TTL_MS) {
      voiceConversations.delete(key);
    }
  }
}

function trackVoice(sessionKey: string, to: string, accountId?: string): void {
  cleanExpired();
  voiceConversations.set(sessionKey, { to, accountId, timestamp: Date.now() });
}

function consumeVoice(sessionKey: string): VoiceEntry | undefined {
  const entry = voiceConversations.get(sessionKey);
  if (!entry) return undefined;
  if (Date.now() - entry.timestamp > VOICE_CONV_TTL_MS) {
    voiceConversations.delete(sessionKey);
    return undefined;
  }
  voiceConversations.delete(sessionKey);
  return entry;
}

// ---------------------------------------------------------------------------
// Plugin entry point
// ---------------------------------------------------------------------------

export default function init(api: PluginApi): void {
  const config = validateConfig(api.pluginConfig ?? {});
  const client = new HAVoiceClient(config);
  const log = api.logger;

  log.info(`[ha-voice] Registered — STT: ${config.sttProvider}, TTS: ${config.ttsEngine}, voice: ${config.ttsVoice}`);

  // -------------------------------------------------------------------------
  // 1. Register MediaUnderstandingProvider for STT
  // -------------------------------------------------------------------------
  api.registerMediaUnderstandingProvider({
    id: "ha-cloud-stt",
    capabilities: ["audio"],
    transcribeAudio: async (req: AudioTranscriptionRequest): Promise<AudioTranscriptionResult> => {
      log.info(`[ha-voice] STT: transcribing ${req.fileName} (${req.buffer.length} bytes, mime=${req.mime ?? "unknown"})`);

      const mime = req.mime ?? "audio/ogg";
      const isOgg = mime.includes("ogg") || mime.includes("opus");
      const isWav = mime.includes("wav") || mime.includes("wave");

      // Convert non-ogg/wav audio (m4a, webm, mp4, etc.) to ogg/opus via ffmpeg
      let audioBuffer = req.buffer;
      let format: string;
      let codec: string;
      if (isOgg) {
        format = "ogg"; codec = "opus";
      } else if (isWav) {
        format = "wav"; codec = "pcm";
      } else {
        // Determine input extension from mime type
        const extMap: Record<string, string> = {
          "audio/mp4": "m4a", "audio/x-m4a": "m4a", "audio/m4a": "m4a",
          "audio/aac": "aac", "audio/mpeg": "mp3", "audio/mp3": "mp3",
          "audio/webm": "webm", "audio/3gpp": "3gp",
        };
        const ext = extMap[mime] ?? "m4a";
        log.info(`[ha-voice] STT: converting ${ext} → ogg/opus via ffmpeg`);
        audioBuffer = await audioToOggOpus(req.buffer, ext);
        format = "ogg"; codec = "opus";
      }

      const result = await client.transcribe(audioBuffer, {
        format,
        codec,
        language: req.language ?? config.language,
      });

      if (result.result !== "success" || !result.text) {
        log.warn(`[ha-voice] STT: transcription failed (result=${result.result})`);
        throw new Error(`HA STT transcription failed: ${result.result}`);
      }

      log.info(`[ha-voice] STT: "${result.text}"`);
      return { text: result.text, model: "ha-cloud" };
    },
  });

  // -------------------------------------------------------------------------
  // 2. Voice tracking via before_dispatch (WhatsApp only)
  // -------------------------------------------------------------------------
  api.on("before_dispatch", (event: unknown, ctx: unknown) => {
    try {
      const ev = event as Record<string, unknown>;
      const cx = ctx as Record<string, unknown>;
      const channel = (ev.channel ?? cx.channelId ?? "") as string;
      const sessionKey = (ev.sessionKey ?? cx.sessionKey ?? "") as string;
      const accountId = cx.accountId as string | undefined;
      const senderId = (ev.senderId ?? cx.senderId ?? cx.conversationId ?? "") as string;

      if (channel === "whatsapp" && sessionKey && senderId) {
        const body = (ev.body ?? "") as string;
        const content = (ev.content ?? "") as string;
        if (body.includes("<media:audio>") || content.includes("<media:audio>")) {
          trackVoice(sessionKey, senderId, accountId);
          log.info(`[ha-voice] Tracked voice session: ${sessionKey} -> ${senderId}`);
        }
      }
    } catch (err) {
      log.error(`[ha-voice] before_dispatch error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, { priority: 100 });

  // -------------------------------------------------------------------------
  // 3. TTS-ready prompt injection via before_agent_start (Voice only)
  // -------------------------------------------------------------------------
  api.on("before_agent_start", (_event: unknown, ctx: unknown) => {
    const cx = ctx as Record<string, unknown>;
    const channelId = cx.channelId as string | undefined;
    const sessionKey = cx.sessionKey as string | undefined;

    if (channelId !== "whatsapp" || !sessionKey) return;
    if (!voiceConversations.has(sessionKey)) return;

    log.info(`[ha-voice] Injecting TTS-ready prompt for session ${sessionKey}`);

    return {
      prependContext: [
        "[SPRACHNACHRICHT — TTS-MODUS]",
        "Die aktuelle Nachricht ist eine Sprachnachricht. Deine Antwort wird laut vorgelesen.",
        "Antworte ausschließlich auf Deutsch in natürlichem Fließtext.",
        "Verwende KEINE Emojis, KEINE Markdown-Formatierung (kein *, kein **, keine Listen mit -).",
        "Verwende KEINE chinesischen Zeichen oder andere nicht-lateinische Schrift.",
        'Schreibe Sonderzeichen aus: "Grad" statt "°C", "Prozent" statt "%", "Euro" statt "€".',
        'Zahlen als Ziffern schreiben: "2026" statt "zweitausendsechsundzwanzig".',
        "Keine Tabellen, keine Aufzählungen, keine Sonderzeichen.",
        "Halte dich kurz — ein bis drei Sätze reichen meistens.",
      ].join("\n"),
    };
  }, { priority: 50 });

  // -------------------------------------------------------------------------
  // 4a. CJK sanitizer on outbound channel messages (before send)
  // -------------------------------------------------------------------------
  api.on("message_sending", (event: unknown) => {
    const ev = event as { content?: string };
    if (!ev.content || !hasCjk(ev.content)) return;
    const cleaned = sanitizeCjk(ev.content);
    log.info(`[ha-voice] CJK sanitized outbound: "${ev.content.slice(0, 60)}" → "${cleaned.slice(0, 60)}"`);
    return { content: cleaned };
  }, { priority: 100 });

  // -------------------------------------------------------------------------
  // 4b. CJK sanitizer on session write (backup for stored history)
  // -------------------------------------------------------------------------
  api.on("before_message_write", (event: unknown) => {
    const ev = event as Record<string, unknown>;
    const message = ev.message as Record<string, unknown> | undefined;
    if (!message || message.role !== "assistant") return;

    const content = message.content;
    if (typeof content === "string") {
      if (!hasCjk(content)) return;
      const cleaned = sanitizeCjk(content);
      log.info(`[ha-voice] CJK sanitized: "${content.slice(0, 60)}" → "${cleaned.slice(0, 60)}"`);
      return { message: { ...message, content: cleaned } };
    }

    if (Array.isArray(content)) {
      let modified = false;
      const cleaned = (content as Array<Record<string, unknown>>).map((block) => {
        if (block.type === "text" && typeof block.text === "string" && hasCjk(block.text)) {
          modified = true;
          return { ...block, text: sanitizeCjk(block.text) };
        }
        return block;
      });
      if (modified) {
        log.info("[ha-voice] CJK sanitized content blocks");
        return { message: { ...message, content: cleaned } };
      }
    }
  }, { priority: 100 });

  // -------------------------------------------------------------------------
  // 5. Global anti-CJK prompt (before_prompt_build)
  // -------------------------------------------------------------------------
  api.on("before_prompt_build", () => {
    return {
      appendSystemContext: "Antworte IMMER auf Deutsch. Verwende NIEMALS chinesische Schriftzeichen, chinesische Ziffern oder andere nicht-lateinische Zeichen. Zahlen immer als arabische Ziffern (0-9).",
    };
  }, { priority: -100 });

  // -------------------------------------------------------------------------
  // 6. TTS reply via agent_end (WhatsApp voice only)
  // -------------------------------------------------------------------------
  api.on("agent_end", async (event: unknown, ctx: unknown) => {
    try {
      const ev = event as Record<string, unknown>;
      const cx = ctx as Record<string, unknown>;
      const channelId = cx.channelId as string | undefined;
      const sessionKey = cx.sessionKey as string | undefined;
      const success = ev.success as boolean | undefined;
      const messages = ev.messages as Array<Record<string, unknown>> | undefined;

      log.info(`[ha-voice] agent_end: channel=${channelId} session=${sessionKey} success=${success} msgs=${messages?.length ?? 0}`);

      if (channelId !== "whatsapp") return;
      if (!sessionKey || !success || !messages) return;

      const voiceInfo = consumeVoice(sessionKey);
      if (!voiceInfo) return;

      let replyText = "";
      for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        if (msg.role === "assistant") {
          if (typeof msg.content === "string") {
            replyText = msg.content;
          } else if (Array.isArray(msg.content)) {
            replyText = (msg.content as Array<Record<string, unknown>>)
              .filter((b) => b.type === "text")
              .map((b) => b.text as string)
              .join("\n");
          }
          break;
        }
      }

      if (!replyText || replyText.trim().length < 2) return;

      const maxTtsChars = 1000;
      const cleanedReply = sanitizeCjk(replyText.trim());
      const ttsText = cleanedReply.length > maxTtsChars
        ? cleanedReply.slice(0, maxTtsChars) + "..."
        : cleanedReply;

      log.info(`[ha-voice] TTS: generating audio (${ttsText.length} chars) for ${voiceInfo.to}`);

      const { buffer: mp3Buffer } = await client.synthesize(ttsText);
      const oggBuffer = await mp3ToOggOpus(mp3Buffer);

      const saved = await api.runtime.channel.media.saveMediaBuffer(
        oggBuffer, "audio/ogg", "outbound", 50 * 1024 * 1024, "tts-reply.ogg"
      );

      await api.runtime.channel.whatsapp.sendMessageWhatsApp(voiceInfo.to, "", {
        mediaUrl: saved.path,
        accountId: voiceInfo.accountId,
      });
      log.info(`[ha-voice] TTS: sent voice note to ${voiceInfo.to} (${oggBuffer.length} bytes)`);
    } catch (err) {
      log.error(`[ha-voice] TTS failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, { priority: -10 });
}
