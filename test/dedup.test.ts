import { describe, expect, it } from "vitest";
import { normalizeCatalog, parseCatalog } from "../src/catalog.js";
import { buildToolState } from "../src/dedup.js";
import type { AlbomConfig } from "../src/config.js";
import { baseCatalog } from "./fixtures.js";

function makeConfig(overrides: Partial<AlbomConfig> = {}): AlbomConfig {
  return {
    baseUrl: "https://402ai.net",
    bearerToken: "token",
    nwcUri: undefined,
    nwcThresholdSats: 1_000,
    nwcTopupUsd: 2,
    nwcMaxDailyUsd: 10,
    toolProfile: "compact",
    includeModeration: false,
    includeEmbeddings: false,
    includeVideo: true,
    allowRawTool: false,
    catalogTtlMs: 300_000,
    httpTimeoutMs: 90_000,
    maxRetries: 2,
    maxUploadBytes: 25 * 1024 * 1024,
    ...overrides
  };
}

describe("tool profile dedup", () => {
  it("compact profile collapses text to responses and keeps image tools distinct", () => {
    const catalog = normalizeCatalog(parseCatalog(baseCatalog()));
    const toolState = buildToolState(catalog, makeConfig({ toolProfile: "compact" }));

    const names = toolState.tools.map((tool) => tool.name);
    expect(names).toContain("albom_text_generate");
    expect(names).toContain("albom_image_generate");
    expect(names).toContain("albom_image_edit");

    const textTool = toolState.tools.find((tool) => tool.name === "albom_text_generate");
    expect(textTool?.kind).toBe("text_generate");
    if (textTool?.kind === "text_generate") {
      expect(textTool.endpointPath).toBe("/v1/responses");
    }
  });

  it("compact profile merges audio translation into transcribe wrapper", () => {
    const catalog = normalizeCatalog(parseCatalog(baseCatalog()));
    const toolState = buildToolState(catalog, makeConfig({ toolProfile: "compact" }));

    const tool = toolState.tools.find((candidate) => candidate.name === "albom_audio_transcribe");
    expect(tool?.kind).toBe("audio_transcribe");
    if (tool?.kind === "audio_transcribe") {
      expect(tool.endpointPath).toBe("/v1/audio/transcriptions");
      expect(tool.translationEndpointPath).toBe("/v1/audio/translations");
    }
  });

  it("full profile exposes endpoint-level tools", () => {
    const catalog = normalizeCatalog(parseCatalog(baseCatalog()));
    const toolState = buildToolState(
      catalog,
      makeConfig({
        toolProfile: "full",
        includeModeration: true,
        includeEmbeddings: true
      })
    );

    const names = toolState.tools.map((tool) => tool.name);
    expect(names).toContain("albom_openai_chat_completions");
    expect(names).toContain("albom_openai_responses");
    expect(names).toContain("albom_openai_audio_translations");
    expect(names).toContain("albom_catalog_get");
  });

  it("always includes marketplace tools", () => {
    const catalog = normalizeCatalog(parseCatalog(baseCatalog()));
    const toolState = buildToolState(catalog, makeConfig({ toolProfile: "compact" }));

    const names = toolState.tools.map((tool) => tool.name);
    expect(names).toContain("albom_marketplace_list_tasks");
    expect(names).toContain("albom_marketplace_post_task");
    expect(names).toContain("albom_marketplace_list_workers");
    expect(names).toContain("albom_marketplace_review_task");
  });
});
