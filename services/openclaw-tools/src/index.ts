import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMiniMaxClient } from "./clients/minimax.js";
import { SonarrClient } from "./clients/sonarr.js";
import { RadarrClient } from "./clients/radarr.js";
import { registerWebSearch } from "./tools/web-search.js";
import { registerUnderstandImage } from "./tools/understand-image.js";
import { registerArr } from "./tools/arr.js";
import { registerCalendar } from "./tools/calendar.js";
import { registerContacts } from "./tools/contacts.js";
import { registerWeather } from "./tools/weather.js";
import { logToolCall, logToolResult, logToolError } from "./lib/debug-log.js";

const log = (msg: string) => process.stderr.write(`[openclaw-tools] ${msg}\n`);

/** Wrap McpServer.tool() to log all calls + results automatically. */
function wrapWithLogging(server: McpServer): McpServer {
  const origTool = server.tool.bind(server);
  /* eslint-disable @typescript-eslint/no-explicit-any */
  (server as any).tool = function (...regArgs: any[]) {
    const handler = regArgs[regArgs.length - 1] as Function;
    const toolName: string = regArgs[0];
    regArgs[regArgs.length - 1] = async (input: any, extra: any) => {
      logToolCall(toolName, (input ?? {}) as Record<string, unknown>);
      const t0 = Date.now();
      try {
        const result = await handler(input, extra);
        const text = result?.content
          ?.map((c: any) => c.text ?? "")
          .join("")
          .slice(0, 1000) ?? "";
        logToolResult(toolName, text, Date.now() - t0);
        return result;
      } catch (err) {
        logToolError(toolName, err instanceof Error ? err.message : String(err), Date.now() - t0);
        throw err;
      }
    };
    return origTool.apply(server, regArgs as any);
  };
  /* eslint-enable @typescript-eslint/no-explicit-any */
  return server;
}

async function main(): Promise<void> {
  log("Starting OpenClaw Tool-Hub MCP Server v1.2.0");

  const minimax = createMiniMaxClient();
  const sonarr = new SonarrClient();
  const radarr = new RadarrClient();

  const server = wrapWithLogging(new McpServer({
    name: "openclaw-tools",
    version: "1.2.0",
  }));

  registerWebSearch(server, minimax);
  registerUnderstandImage(server, minimax);
  registerArr(server, sonarr, radarr, minimax);
  registerCalendar(server);
  registerContacts(server);
  registerWeather(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  log("Server connected via stdio");
}

main().catch((err) => {
  log(`Fatal: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
