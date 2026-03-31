import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MiniMaxClient } from "../clients/minimax.js";
import { searchDDG } from "../clients/duckduckgo.js";
import { mergeResults } from "../lib/merge.js";

export function registerWebSearch(server: McpServer, minimax: MiniMaxClient): void {
  server.registerTool(
    "web_search",
    {
      title: "Web Search",
      description:
        "Search the web using multiple engines (DuckDuckGo + MiniMax). " +
        "Returns results from both sources, deduplicated and merged. " +
        "Use 3-5 keywords for best results. For time-sensitive topics, include the current date.",
      inputSchema: {
        query: z.string().describe("The search query"),
        max_results: z
          .number()
          .int()
          .min(1)
          .max(20)
          .optional()
          .default(10)
          .describe("Maximum number of results to return (default: 10)"),
      },
    },
    async ({ query, max_results }) => {
      const perSource = Math.ceil(max_results / 2) + 2; // fetch a few extra for dedup headroom
      const errors: string[] = [];

      const [mmResult, ddgResult] = await Promise.allSettled([
        minimax.search(query, perSource),
        searchDDG(query, perSource),
      ]);

      const mmData =
        mmResult.status === "fulfilled" ? mmResult.value : { results: [], related: [] };
      const ddgData = ddgResult.status === "fulfilled" ? ddgResult.value : [];

      if (mmResult.status === "rejected") {
        errors.push(`MiniMax search failed: ${mmResult.reason}`);
      }
      if (ddgResult.status === "rejected") {
        errors.push(`DuckDuckGo search failed: ${ddgResult.reason}`);
      }
      if (mmData.results.length === 0 && !errors.some((e) => e.includes("MiniMax"))) {
        if (minimax.available) errors.push("MiniMax returned no results.");
        else errors.push("MiniMax disabled (no API key).");
      }
      if (ddgData.length === 0 && !errors.some((e) => e.includes("DuckDuckGo"))) {
        errors.push("DuckDuckGo returned no results.");
      }

      const merged = mergeResults(mmData.results, ddgData, max_results);

      if (merged.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `No results found for "${query}".\n${errors.join("\n")}`,
            },
          ],
        };
      }

      const lines: string[] = [];
      for (let i = 0; i < merged.length; i++) {
        const r = merged[i];
        const tag = r.source === "minimax" ? "[MiniMax]" : "[DDG]";
        const dateLine = r.date ? `  Date: ${r.date}` : "";
        lines.push(`[${i + 1}] ${tag} ${r.title}\n  URL: ${r.url}${dateLine}\n  ${r.snippet}`);
      }

      if (mmData.related.length > 0) {
        lines.push(`\n---\nRelated searches: ${mmData.related.join(", ")}`);
      }

      if (errors.length > 0) {
        lines.push(`\nNote: ${errors.join(" ")}`);
      }

      return {
        content: [{ type: "text" as const, text: lines.join("\n\n") }],
      };
    }
  );
}
