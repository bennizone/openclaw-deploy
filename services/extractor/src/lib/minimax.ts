import { config, log } from '../config.js';
import { MiniMaxChatClient } from '@openclaw/minimax-client';

let _minimax: MiniMaxChatClient | null = null;

export function getMiniMax(): MiniMaxChatClient {
  if (!_minimax) {
    _minimax = new MiniMaxChatClient({
      apiKey: config.minimaxApiKey,
      baseUrl: config.minimaxBaseUrl,
      logFn: (level, msg) => log(level, 'minimax', msg),
    });
  }
  return _minimax;
}
