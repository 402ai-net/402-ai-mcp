import { describe, expect, it } from "vitest";
import type { AlbomConfig } from "../src/config.js";
import { normalizeCatalog, parseCatalog } from "../src/catalog.js";
import { AlbomHttpClient } from "../src/httpClient.js";
import { AlbomToolRegistry } from "../src/tools/registry.js";
import type { ToolServerLike } from "../src/tools/registration.js";
import { catalogWithPaths } from "./fixtures.js";

function makeConfig(overrides: Partial<AlbomConfig> = {}): AlbomConfig {
  return {
    baseUrl: "https://402ai.net",
    bearerToken: "token",
    nwcUri: undefined,
    nwcThresholdSats: 1_000,
    nwcTopupUsd: 2,
    nwcMaxDailyUsd: 10,
    toolProfile: "full",
    includeModeration: true,
    includeEmbeddings: true,
    includeVideo: true,
    allowRawTool: false,
    catalogTtlMs: 300_000,
    httpTimeoutMs: 90_000,
    maxRetries: 0,
    maxUploadBytes: 5 * 1024 * 1024,
    ...overrides
  };
}

class FakeServer implements ToolServerLike {
  public readonly registeredNames = new Set<string>();
  public toolListChangedCount = 0;
  public connected = true;

  public registerTool(name: string): { remove: () => void } {
    this.registeredNames.add(name);
    return {
      remove: () => {
        this.registeredNames.delete(name);
      }
    };
  }

  public sendToolListChanged(): void {
    this.toolListChangedCount += 1;
  }

  public isConnected(): boolean {
    return this.connected;
  }
}

describe("tool registry", () => {
  it("emits tools/list_changed when catalog-derived toolset changes", async () => {
    const server = new FakeServer();

    const fetchFn: typeof fetch = async () => {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          "content-type": "application/json"
        }
      });
    };

    const httpClient = new AlbomHttpClient({
      baseUrl: "https://402ai.net",
      bearerToken: "token",
      timeoutMs: 90_000,
      maxRetries: 0,
      fetchFn
    });

    let currentCatalogState = normalizeCatalog(parseCatalog(catalogWithPaths(["/v1/responses"])));

    const registry = new AlbomToolRegistry({
      config: makeConfig(),
      server,
      catalogProvider: {
        getState: async () => currentCatalogState,
        snapshot: () => currentCatalogState
      },
      httpClient
    });

    await registry.initialize();

    expect(server.registeredNames.has("albom_openai_responses")).toBe(true);
    expect(server.registeredNames.has("albom_catalog_get")).toBe(true);
    expect(server.toolListChangedCount).toBe(0);

    currentCatalogState = normalizeCatalog(
      parseCatalog(catalogWithPaths(["/v1/responses", "/v1/images/generations"]))
    );

    const changed = await registry.syncTools({
      forceRefresh: true,
      emitNotification: true
    });

    expect(changed).toBe(true);
    expect(server.registeredNames.has("albom_openai_images_generations")).toBe(true);
    expect(server.toolListChangedCount).toBe(1);

    const changedAgain = await registry.syncTools({
      forceRefresh: true,
      emitNotification: true
    });

    expect(changedAgain).toBe(false);
    expect(server.toolListChangedCount).toBe(1);
  });
});
