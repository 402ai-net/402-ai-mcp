import type { ToolProfile } from "./types.js";

export interface AlbomConfig {
  baseUrl: string;
  bearerToken?: string;
  nwcUri?: string;
  nwcThresholdSats: number;
  nwcTopupUsd: number;
  nwcMaxDailyUsd: number;
  toolProfile: ToolProfile;
  includeModeration: boolean;
  includeEmbeddings: boolean;
  includeVideo: boolean;
  allowRawTool: boolean;
  catalogTtlMs: number;
  httpTimeoutMs: number;
  maxRetries: number;
  maxUploadBytes: number;
}

const DEFAULTS = {
  baseUrl: "https://402ai.net",
  catalogTtlMs: 300_000,
  httpTimeoutMs: 90_000,
  maxRetries: 2,
  maxUploadBytes: 25 * 1024 * 1024
} as const;

function parseBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  throw new Error(`Invalid boolean value: ${value}`);
}

function parseInteger(value: string | undefined, fallback: number, minimum: number): number {
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || Number.isNaN(parsed) || parsed < minimum) {
    throw new Error(`Invalid integer value: ${value}`);
  }

  return parsed;
}

function parseDecimal(value: string | undefined, fallback: number, minimum: number): number {
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || Number.isNaN(parsed) || parsed < minimum) {
    throw new Error(`Invalid decimal value: ${value}`);
  }

  return Math.round(parsed * 100) / 100;
}

function parseToolProfile(value: string | undefined): ToolProfile {
  if (!value) {
    return "compact";
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "compact" || normalized === "full") {
    return normalized;
  }

  throw new Error(`Invalid ALBOM_TOOL_PROFILE value: ${value}`);
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "");
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AlbomConfig {
  const toolProfile = parseToolProfile(env.ALBOM_TOOL_PROFILE);

  const includeModerationFromEnv = parseBoolean(env.ALBOM_INCLUDE_MODERATION);
  const includeEmbeddingsFromEnv = parseBoolean(env.ALBOM_INCLUDE_EMBEDDINGS);

  return {
    baseUrl: normalizeBaseUrl(env.ALBOM_BASE_URL ?? DEFAULTS.baseUrl),
    bearerToken: env.ALBOM_BEARER_TOKEN?.trim() || undefined,
    nwcUri: env.ALBOM_NWC_URI?.trim() || undefined,
    nwcThresholdSats: parseInteger(env.ALBOM_NWC_THRESHOLD_SATS, 1_000, 0),
    nwcTopupUsd: parseDecimal(env.ALBOM_NWC_TOPUP_USD, 2, 0.01),
    nwcMaxDailyUsd: parseDecimal(env.ALBOM_NWC_MAX_DAILY, 10, 0.01),
    toolProfile,
    includeModeration: includeModerationFromEnv ?? toolProfile === "full",
    includeEmbeddings: includeEmbeddingsFromEnv ?? toolProfile === "full",
    includeVideo: parseBoolean(env.ALBOM_INCLUDE_VIDEO) ?? true,
    allowRawTool: parseBoolean(env.ALBOM_ALLOW_RAW_TOOL) ?? false,
    catalogTtlMs: parseInteger(env.ALBOM_CATALOG_TTL_MS, DEFAULTS.catalogTtlMs, 1_000),
    httpTimeoutMs: parseInteger(env.ALBOM_HTTP_TIMEOUT_MS, DEFAULTS.httpTimeoutMs, 1_000),
    maxRetries: parseInteger(env.ALBOM_MAX_RETRIES, DEFAULTS.maxRetries, 0),
    maxUploadBytes: parseInteger(env.ALBOM_MAX_UPLOAD_BYTES, DEFAULTS.maxUploadBytes, 1)
  };
}
