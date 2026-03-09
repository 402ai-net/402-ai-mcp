#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { CatalogManager } from "./catalog.js";
import { AlbomHttpClient } from "./httpClient.js";
import { AlbomToolRegistry } from "./tools/registry.js";
import { toErrorMessage } from "./utils.js";

const SERVER_NAME = "402ai-mcp";
const SERVER_VERSION = "1.0.0";

async function main(): Promise<void> {
  const config = loadConfig();

  const catalogManager = new CatalogManager({
    baseUrl: config.baseUrl,
    timeoutMs: config.httpTimeoutMs,
    ttlMs: config.catalogTtlMs
  });

  const server = new McpServer(
    {
      name: SERVER_NAME,
      version: SERVER_VERSION
    },
    {
      capabilities: {
        tools: {
          listChanged: true
        }
      }
    }
  );

  const httpClient = new AlbomHttpClient({
    baseUrl: config.baseUrl,
    bearerToken: config.bearerToken,
    timeoutMs: config.httpTimeoutMs,
    maxRetries: config.maxRetries
  });

  const registry = new AlbomToolRegistry({
    config,
    server,
    catalogProvider: {
      getState: (options) => catalogManager.getState(options),
      snapshot: () => catalogManager.snapshot()
    },
    httpClient
  });

  await registry.initialize();

  const refreshTimer = setInterval(async () => {
    try {
      await registry.syncTools({
        forceRefresh: true,
        emitNotification: true
      });
    } catch (error) {
      console.error(`[${SERVER_NAME}] catalog refresh failed: ${toErrorMessage(error)}`);
    }
  }, config.catalogTtlMs);

  refreshTimer.unref();

  const cleanup = async (): Promise<void> => {
    clearInterval(refreshTimer);
    registry.dispose();
    try {
      await server.close();
    } catch {
      // Ignore close failures on shutdown.
    }
  };

  process.once("SIGINT", () => {
    void cleanup().finally(() => process.exit(0));
  });

  process.once("SIGTERM", () => {
    void cleanup().finally(() => process.exit(0));
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error(`[${SERVER_NAME}] fatal error: ${toErrorMessage(error)}`);
  process.exit(1);
});
