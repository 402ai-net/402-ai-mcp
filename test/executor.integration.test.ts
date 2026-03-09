import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { NwcAutoTopupManager, type InvoicePayer, type InvoicePayerFactory } from "../src/autoTopup.js";
import type { AlbomConfig } from "../src/config.js";
import { normalizeCatalog, parseCatalog } from "../src/catalog.js";
import { buildToolState } from "../src/dedup.js";
import { AlbomHttpClient } from "../src/httpClient.js";
import type { PlannedTool, ToolState } from "../src/types.js";
import { AlbomToolExecutor } from "../src/tools/executor.js";
import { baseCatalog } from "./fixtures.js";

function makeConfig(overrides: Partial<AlbomConfig> = {}): AlbomConfig {
  return {
    baseUrl: "https://402ai.net",
    bearerToken: "test-token",
    nwcUri: undefined,
    nwcThresholdSats: 1_000,
    nwcTopupUsd: 2,
    nwcMaxDailyUsd: 10,
    toolProfile: "compact",
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

function makeExecutor(
  fetchFn: typeof fetch,
  configOverrides: Partial<AlbomConfig> = {},
  autoTopupManager?: NwcAutoTopupManager
): { executor: AlbomToolExecutor; toolState: ToolState } {
  const config = makeConfig(configOverrides);
  const catalogState = normalizeCatalog(parseCatalog(baseCatalog()));
  const toolState = buildToolState(catalogState, config);

  const httpClient = new AlbomHttpClient({
    baseUrl: config.baseUrl,
    bearerToken: config.bearerToken,
    timeoutMs: config.httpTimeoutMs,
    maxRetries: config.maxRetries,
    fetchFn
  });

  const executor = new AlbomToolExecutor({
    config,
    httpClient,
    getCatalogState: () => catalogState,
    refreshCatalog: async () => catalogState,
    getToolState: () => toolState,
    autoTopupManager
  });

  return { executor, toolState };
}

function findTool(tools: PlannedTool[], name: string): PlannedTool {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) {
    throw new Error(`Tool not found: ${name}`);
  }

  return tool;
}

describe("tool executor integration", () => {
  class FakeInvoicePayer implements InvoicePayer {
    public constructor(private readonly preimage: string) {}

    public async payInvoice(): Promise<{ preimage: string }> {
      return { preimage: this.preimage };
    }
  }

  class FakeInvoicePayerFactory implements InvoicePayerFactory {
    public constructor(private readonly preimage: string) {}

    public create(): InvoicePayer {
      return new FakeInvoicePayer(this.preimage);
    }
  }

  it("handles success 200 response", async () => {
    const fetchFn: typeof fetch = async () => {
      return new Response(JSON.stringify({ id: "resp_1", output: [] }), {
        status: 200,
        headers: {
          "content-type": "application/json"
        }
      });
    };

    const { executor, toolState } = makeExecutor(fetchFn);
    const result = await executor.execute(findTool(toolState.tools, "albom_text_generate"), {
      model: "gpt-4o-mini",
      input: "hello"
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(result.endpoint).toBe("/v1/responses");
    if (result.ok) {
      expect(result.price_sats).toBe(30);
    }
  });

  it("maps payment_required 402 with invoice metadata", async () => {
    const fetchFn: typeof fetch = async () => {
      return new Response(
        JSON.stringify({
          status: "payment_required",
          amount_sats: 30,
          invoice: "lnbc_test",
          payment_hash: "abc123",
          expires_in: 120
        }),
        {
          status: 402,
          headers: {
            "content-type": "application/json",
            "x-topup-url": "/topup"
          }
        }
      );
    };

    const { executor, toolState } = makeExecutor(fetchFn, { bearerToken: undefined });
    const result = await executor.execute(findTool(toolState.tools, "albom_text_generate"), {
      model: "gpt-4o-mini",
      input: "hello",
      allow_l402_quote: true
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(402);
      expect(result.error.code).toBe("payment_required");
      expect(result.error.invoice).toBe("lnbc_test");
      expect(result.error.topup_url).toBe("/topup");
      expect(result.error.amount_sats).toBe(30);
    }
  });

  it("maps invalid_token 401", async () => {
    const fetchFn: typeof fetch = async () => {
      return new Response(
        JSON.stringify({
          error: {
            code: "invalid_token",
            message: "Token invalid"
          }
        }),
        {
          status: 401,
          headers: {
            "content-type": "application/json"
          }
        }
      );
    };

    const { executor, toolState } = makeExecutor(fetchFn);
    const result = await executor.execute(findTool(toolState.tools, "albom_text_generate"), {
      model: "gpt-4o-mini",
      input: "hello"
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(401);
      expect(result.error.code).toBe("invalid_token");
    }
  });

  it("supports multipart uploads from file_path", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "albom-test-"));
    const filePath = join(tempDir, "audio.wav");
    await writeFile(filePath, "sample-audio-data");

    try {
      const fetchFn: typeof fetch = async (_url, init) => {
        const body = init?.body;
        expect(body).toBeInstanceOf(FormData);

        const formData = body as FormData;
        const filePart = formData.get("file");
        expect(filePart).toBeTruthy();
        expect(typeof filePart).not.toBe("string");

        if (typeof filePart !== "string") {
          const content = Buffer.from(await filePart.arrayBuffer()).toString("utf8");
          expect(content).toBe("sample-audio-data");
        }

        return new Response(JSON.stringify({ text: "ok" }), {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        });
      };

      const { executor, toolState } = makeExecutor(fetchFn);
      const result = await executor.execute(findTool(toolState.tools, "albom_audio_transcribe"), {
        audio_file_path: filePath
      });

      expect(result.ok).toBe(true);
      expect(result.endpoint).toBe("/v1/audio/transcriptions");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("supports multipart uploads from base64", async () => {
    const payload = Buffer.from("base64-audio").toString("base64");

    const fetchFn: typeof fetch = async (_url, init) => {
      const body = init?.body;
      expect(body).toBeInstanceOf(FormData);

      const formData = body as FormData;
      const filePart = formData.get("file");
      expect(filePart).toBeTruthy();
      expect(typeof filePart).not.toBe("string");

      if (typeof filePart !== "string") {
        const content = Buffer.from(await filePart.arrayBuffer()).toString("utf8");
        expect(content).toBe("base64-audio");
      }

      return new Response(JSON.stringify({ text: "ok" }), {
        status: 200,
        headers: {
          "content-type": "application/json"
        }
      });
    };

    const { executor, toolState } = makeExecutor(fetchFn);
    const result = await executor.execute(findTool(toolState.tools, "albom_audio_transcribe"), {
      audio_file_base64: payload,
      audio_file_name: "audio.wav"
    });

    expect(result.ok).toBe(true);
    expect(result.endpoint).toBe("/v1/audio/transcriptions");
  });

  it("calls marketplace task list endpoint", async () => {
    const fetchFn: typeof fetch = async (url) => {
      expect(String(url)).toBe("https://402ai.net/api/v1/ai-for-hire/tasks?status=open");
      return new Response(JSON.stringify({ tasks: [{ id: "task_1" }] }), {
        status: 200,
        headers: {
          "content-type": "application/json"
        }
      });
    };

    const { executor, toolState } = makeExecutor(fetchFn);
    const result = await executor.execute(findTool(toolState.tools, "albom_marketplace_list_tasks"), {
      status: "open"
    });

    expect(result.ok).toBe(true);
    expect(result.endpoint).toBe("/api/v1/ai-for-hire/tasks?status=open");
  });

  it("calls marketplace post task endpoint", async () => {
    const fetchFn: typeof fetch = async (url, init) => {
      expect(String(url)).toBe("https://402ai.net/api/v1/ai-for-hire/tasks");
      expect(init?.method).toBe("POST");
      expect(init?.body).toBe(JSON.stringify({
        title: "Need a podcast script",
        description: "Egypt",
        budget_sats: 1200
      }));
      return new Response(JSON.stringify({ id: "task_99", status: "open" }), {
        status: 201,
        headers: {
          "content-type": "application/json"
        }
      });
    };

    const { executor, toolState } = makeExecutor(fetchFn);
    const result = await executor.execute(findTool(toolState.tools, "albom_marketplace_post_task"), {
      title: "Need a podcast script",
      description: "Egypt",
      budget_sats: 1200
    });

    expect(result.ok).toBe(true);
    expect(result.endpoint).toBe("/api/v1/ai-for-hire/tasks");
  });

  it("calls marketplace upsert profile endpoint", async () => {
    const fetchFn: typeof fetch = async (url, init) => {
      expect(String(url)).toBe("https://402ai.net/api/v1/ai-for-hire/me/profile");
      expect(init?.method).toBe("PUT");
      return new Response(JSON.stringify({ display_name: "Agent B" }), {
        status: 200,
        headers: {
          "content-type": "application/json"
        }
      });
    };

    const { executor, toolState } = makeExecutor(fetchFn);
    const result = await executor.execute(findTool(toolState.tools, "albom_marketplace_upsert_profile"), {
      display_name: "Agent B",
      capabilities: ["research"],
      delivery_types: ["md"]
    });

    expect(result.ok).toBe(true);
    expect(result.endpoint).toBe("/api/v1/ai-for-hire/me/profile");
  });

  it("auto-topups when a response balance falls below the threshold", async () => {
    const seenAuthHeaders: string[] = [];
    let callCount = 0;
    const fetchFn: typeof fetch = async (url, init) => {
      seenAuthHeaders.push(String((init?.headers as Record<string, string> | undefined)?.authorization ?? ""));
      callCount += 1;

      if (callCount === 1) {
        expect(String(url)).toBe("https://402ai.net/api/v1/ai-for-hire/me");
        return new Response(JSON.stringify({ account_id: "acct_1", balance_sats: 900 }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }

      if (callCount === 2) {
        expect(String(url)).toBe("https://402ai.net/api/v1/topup");
        expect(init?.body).toBe(JSON.stringify({ amount_usd: 2 }));
        return new Response(
          JSON.stringify({
            status: "payment_required",
            invoice: "lnbc_invoice",
            payment_hash: "hash_1"
          }),
          {
            status: 402,
            headers: { "content-type": "application/json" }
          }
        );
      }

      if (callCount === 3) {
        expect(String(url)).toBe("https://402ai.net/api/v1/topup/claim");
        expect(init?.body).toBe(JSON.stringify({ preimage: "preimage_1" }));
        return new Response(JSON.stringify({ token: "abl_new_token", balance_sats: 4_500 }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }

      expect(String(url)).toBe("https://402ai.net/api/v1/ai-for-hire/me");
      return new Response(JSON.stringify({ account_id: "acct_1", balance_sats: 4_400 }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    };

    const config = makeConfig({
      nwcUri: "nostr+walletconnect://relay.example.com?secret=test&relay=wss%3A%2F%2Frelay.example.com"
    });
    const httpClient = new AlbomHttpClient({
      baseUrl: config.baseUrl,
      bearerToken: config.bearerToken,
      timeoutMs: config.httpTimeoutMs,
      maxRetries: config.maxRetries,
      fetchFn
    });
    const autoTopupManager = new NwcAutoTopupManager(
      {
        nwcUri: config.nwcUri,
        thresholdSats: config.nwcThresholdSats,
        topupUsd: config.nwcTopupUsd,
        maxDailyUsd: config.nwcMaxDailyUsd
      },
      httpClient,
      new FakeInvoicePayerFactory("preimage_1")
    );

    const catalogState = normalizeCatalog(parseCatalog(baseCatalog()));
    const toolState = buildToolState(catalogState, config);
    const executor = new AlbomToolExecutor({
      config,
      httpClient,
      getCatalogState: () => catalogState,
      refreshCatalog: async () => catalogState,
      getToolState: () => toolState,
      autoTopupManager
    });

    const result = await executor.execute(findTool(toolState.tools, "albom_marketplace_get_my_account"), {});
    expect(result.ok).toBe(true);
    expect(result.auto_topup?.status).toBe("succeeded");
    expect(result.auto_topup?.new_balance_sats).toBe(4_500);

    const secondResult = await executor.execute(findTool(toolState.tools, "albom_marketplace_get_my_account"), {});
    expect(secondResult.ok).toBe(true);
    expect(seenAuthHeaders).toEqual([
      "Bearer test-token",
      "Bearer test-token",
      "Bearer test-token",
      "Bearer abl_new_token"
    ]);
  });

  it("skips auto-topup once the daily USD cap has been reached", async () => {
    let callCount = 0;
    const fetchFn: typeof fetch = async () => {
      callCount += 1;

      if (callCount === 1) {
        return new Response(JSON.stringify({ account_id: "acct_1", balance_sats: 900 }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }

      if (callCount === 2) {
        return new Response(JSON.stringify({ status: "payment_required", invoice: "lnbc_invoice" }), {
          status: 402,
          headers: { "content-type": "application/json" }
        });
      }

      if (callCount === 3) {
        return new Response(JSON.stringify({ token: "abl_new_token", balance_sats: 2_900 }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }

      return new Response(JSON.stringify({ account_id: "acct_1", balance_sats: 800 }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    };

    const config = makeConfig({
      nwcUri: "nostr+walletconnect://relay.example.com?secret=test&relay=wss%3A%2F%2Frelay.example.com",
      nwcMaxDailyUsd: 2
    });
    const httpClient = new AlbomHttpClient({
      baseUrl: config.baseUrl,
      bearerToken: config.bearerToken,
      timeoutMs: config.httpTimeoutMs,
      maxRetries: config.maxRetries,
      fetchFn
    });
    const autoTopupManager = new NwcAutoTopupManager(
      {
        nwcUri: config.nwcUri,
        thresholdSats: config.nwcThresholdSats,
        topupUsd: config.nwcTopupUsd,
        maxDailyUsd: config.nwcMaxDailyUsd
      },
      httpClient,
      new FakeInvoicePayerFactory("preimage_1")
    );

    const catalogState = normalizeCatalog(parseCatalog(baseCatalog()));
    const toolState = buildToolState(catalogState, config);
    const executor = new AlbomToolExecutor({
      config,
      httpClient,
      getCatalogState: () => catalogState,
      refreshCatalog: async () => catalogState,
      getToolState: () => toolState,
      autoTopupManager
    });

    const firstResult = await executor.execute(findTool(toolState.tools, "albom_marketplace_get_my_account"), {});
    expect(firstResult.auto_topup?.status).toBe("succeeded");

    const secondResult = await executor.execute(findTool(toolState.tools, "albom_marketplace_get_my_account"), {});
    expect(secondResult.auto_topup?.status).toBe("skipped");
    expect(secondResult.auto_topup?.reason).toBe("daily_limit_reached");
  });
});
