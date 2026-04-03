import { MiniMaxPlatformClient } from '@openclaw/minimax-client';

const log = (msg: string) => process.stderr.write(`[minimax] ${msg}\n`);

export const MiniMaxClient = MiniMaxPlatformClient;
export type MiniMaxClient = MiniMaxPlatformClient;

export function createMiniMaxClient(): MiniMaxPlatformClient {
  const apiKey = process.env.MINIMAX_API_KEY ?? '';
  const apiHost = process.env.MINIMAX_API_HOST ?? 'https://api.minimax.io';
  if (!apiKey) {
    log('WARNING: MINIMAX_API_KEY not set — MiniMax features disabled');
  }
  return new MiniMaxPlatformClient({
    apiKey,
    apiHost,
    logFn: (level, msg) => log(`[${level}] ${msg}`),
  });
}
