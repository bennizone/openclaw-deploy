export interface MiniMaxChatOptions {
  systemPrompt: string;
  userPrompt: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  tag?: string;
}

export interface MiniMaxChatResult {
  content: string;
  usage?: { promptTokens: number; completionTokens: number };
}

export interface MiniMaxClientConfig {
  apiKey: string;
  baseUrl?: string;
  logFn?: (level: 'debug' | 'info' | 'warn' | 'error', msg: string) => void;
}

export interface MiniMaxPlatformConfig {
  apiKey: string;
  apiHost?: string;
  logFn?: (level: 'debug' | 'info' | 'warn' | 'error', msg: string) => void;
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  source: 'minimax';
  date?: string;
}

export interface MiniMaxRemainsInfo {
  remaining: number;
  total: number;
  windowEnd: Date;
}

export interface UsageStats {
  totalRequests: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  byTag: Record<string, number>;
}
