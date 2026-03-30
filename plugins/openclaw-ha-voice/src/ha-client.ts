import { HAVoiceConfig } from "./config";

const DEFAULT_TIMEOUT_MS = 30_000;

export interface SttResult {
  text: string | null;
  result: "success" | "error";
}

export interface TtsUrlResult {
  url: string;
  path: string;
}

export class HAVoiceClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly timeoutMs: number;

  constructor(private readonly config: HAVoiceConfig) {
    this.baseUrl = config.url;
    this.token = config.token;
    this.timeoutMs = DEFAULT_TIMEOUT_MS;
  }

  /**
   * Transcribe audio via HA STT API.
   * Sends raw audio bytes with X-Speech-Content metadata header.
   */
  async transcribe(audioBuffer: Buffer, opts?: {
    format?: string;
    codec?: string;
    sampleRate?: number;
    bitRate?: number;
    channel?: number;
    language?: string;
  }): Promise<SttResult> {
    const format = opts?.format ?? "ogg";
    const codec = opts?.codec ?? "opus";
    const sampleRate = opts?.sampleRate ?? 16000;
    const bitRate = opts?.bitRate ?? 16;
    const channel = opts?.channel ?? 1;
    const language = opts?.language ?? this.config.language;

    const speechContent = `format=${format}; codec=${codec}; sample_rate=${sampleRate}; bit_rate=${bitRate}; channel=${channel}; language=${language}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}/api/stt/${this.config.sttProvider}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.token}`,
          "X-Speech-Content": speechContent,
        },
        body: audioBuffer,
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`HA STT HTTP ${response.status}: ${body}`);
      }

      return (await response.json()) as SttResult;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Generate TTS audio via HA TTS API.
   * Returns the audio buffer (fetched from the proxy URL).
   */
  async synthesize(text: string, opts?: {
    language?: string;
    voice?: string;
  }): Promise<{ buffer: Buffer; mimeType: string }> {
    const language = opts?.language ?? this.config.language;
    const voice = opts?.voice ?? this.config.ttsVoice;

    // Step 1: Get the TTS URL
    const controller1 = new AbortController();
    const timer1 = setTimeout(() => controller1.abort(), this.timeoutMs);

    let ttsResult: TtsUrlResult;
    try {
      const response = await fetch(`${this.baseUrl}/api/tts_get_url`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          engine_id: this.config.ttsEngine,
          message: text,
          language,
          options: { voice },
        }),
        signal: controller1.signal,
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`HA TTS get_url HTTP ${response.status}: ${body}`);
      }

      ttsResult = (await response.json()) as TtsUrlResult;
    } finally {
      clearTimeout(timer1);
    }

    // Step 2: Fetch the audio from the proxy URL
    const audioUrl = ttsResult.url || `${this.baseUrl}${ttsResult.path}`;
    const controller2 = new AbortController();
    const timer2 = setTimeout(() => controller2.abort(), this.timeoutMs);

    try {
      const audioResponse = await fetch(audioUrl, {
        signal: controller2.signal,
      });

      if (!audioResponse.ok) {
        throw new Error(`HA TTS proxy HTTP ${audioResponse.status}`);
      }

      const contentType = audioResponse.headers.get("content-type") ?? "audio/mpeg";
      const arrayBuffer = await audioResponse.arrayBuffer();
      return {
        buffer: Buffer.from(arrayBuffer),
        mimeType: contentType,
      };
    } finally {
      clearTimeout(timer2);
    }
  }
}
