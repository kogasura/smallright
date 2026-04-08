#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "./server.js";

async function main() {
  const { server, services } = createMcpServer();
  const transport = new StdioServerTransport();

  process.on("SIGINT", () => {
    services.browser.close().finally(() => process.exit(0));
  });
  process.on("SIGTERM", () => {
    services.browser.close().finally(() => process.exit(0));
  });

  await server.connect(transport);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
