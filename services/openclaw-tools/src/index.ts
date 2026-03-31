import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { MiniMaxClient } from "./clients/minimax.js";
import { SonarrClient } from "./clients/sonarr.js";
import { RadarrClient } from "./clients/radarr.js";
import { registerWebSearch } from "./tools/web-search.js";
import { registerUnderstandImage } from "./tools/understand-image.js";
import { registerArr } from "./tools/arr.js";

const log = (msg: string) => process.stderr.write(`[openclaw-tools] ${msg}\n`);

async function main(): Promise<void> {
  log("Starting OpenClaw Tool-Hub MCP Server v1.1.0");

  const minimax = new MiniMaxClient();
  const sonarr = new SonarrClient();
  const radarr = new RadarrClient();

  const server = new McpServer({
    name: "openclaw-tools",
    version: "1.1.0",
  });

  registerWebSearch(server, minimax);
  registerUnderstandImage(server, minimax);
  registerArr(server, sonarr, radarr, minimax);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  log("Server connected via stdio");
}

main().catch((err) => {
  log(`Fatal: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
