import type { UsageStats } from './types.js';

export class UsageLogger {
  private stats: UsageStats = {
    totalRequests: 0,
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
    byTag: {},
  };
  private logFn: (level: 'debug' | 'info' | 'warn' | 'error', msg: string) => void;

  constructor(logFn?: (level: 'debug' | 'info' | 'warn' | 'error', msg: string) => void) {
    this.logFn = logFn ?? ((level: 'debug' | 'info' | 'warn' | 'error', msg: string) => process.stderr.write(`[minimax:${level}] ${msg}\n`));
  }

  /** Record a completed request. Called automatically by the client after each successful call. */
  record(tag: string, usage?: { promptTokens: number; completionTokens: number }): void {
    this.stats.totalRequests++;
    this.stats.byTag[tag] = (this.stats.byTag[tag] ?? 0) + 1;
    if (usage) {
      this.stats.totalPromptTokens += usage.promptTokens;
      this.stats.totalCompletionTokens += usage.completionTokens;
    }
    this.logFn('debug', `#${this.stats.totalRequests} [${tag}] ${usage ? `${usage.promptTokens}+${usage.completionTokens} tok` : 'no usage data'}`);
  }

  /** Get session stats (no API call, in-process only). */
  getStats(): Readonly<UsageStats> {
    return { ...this.stats };
  }

  /** Reset counter (e.g. after service restart). */
  reset(): void {
    this.stats = { totalRequests: 0, totalPromptTokens: 0, totalCompletionTokens: 0, byTag: {} };
  }
}
