import { z } from "zod";
import type { CatalogEndpoint, CatalogResponse, CatalogState, EndpointContentType, EndpointDescriptor } from "./types.js";
import { sha256Hex, stableStringify } from "./utils.js";

const modelPriceSchema = z
  .object({
    price_sats: z.number().optional(),
    price_usd_cents: z.number().optional()
  })
  .passthrough();

const endpointSchema = z
  .object({
    path: z.string(),
    method: z.string(),
    price_type: z.string(),
    description: z.string().optional(),
    example: z
      .object({
        content_type: z.enum(["json", "multipart"]).optional(),
        body: z.record(z.string(), z.unknown()).optional(),
        fields: z.record(z.string(), z.unknown()).optional(),
        file_field: z.string().optional(),
        file_name: z.string().optional()
      })
      .passthrough()
      .optional(),
    models: z.record(z.string(), modelPriceSchema).optional(),
    price_sats: z.number().optional(),
    price_usd_cents: z.number().optional()
  })
  .passthrough();

const catalogSchema = z.object({
  btc_usd: z.number().optional(),
  btc_usd_updated_at: z.string().optional(),
  apis: z.record(
    z.string(),
    z
      .object({
        name: z.string(),
        endpoints: z.array(endpointSchema)
      })
      .passthrough()
  )
});

const COSMETIC_ARG_KEYS = new Set([
  "e2e",
  "required_field",
  "invalid_body",
  "error_keyword",
  "file_comment",
  "file_name",
  "file_field",
  "content_type",
  "require_error_message"
]);

export function parseCatalog(input: unknown): CatalogResponse {
  const parsed = catalogSchema.parse(input) as CatalogResponse;

  for (const api of Object.values(parsed.apis)) {
    for (const endpoint of api.endpoints) {
      if (endpoint.price_type !== "flat") {
        if (!endpoint.models || Object.keys(endpoint.models).length === 0) {
          throw new Error(`Catalog endpoint ${endpoint.path} is ${endpoint.price_type} but has no models`);
        }
      }

      if (endpoint.price_type === "flat" && typeof endpoint.price_sats !== "number") {
        throw new Error(`Catalog endpoint ${endpoint.path} is flat but has no price_sats`);
      }
    }
  }

  return parsed;
}

function inferContentType(endpoint: CatalogEndpoint): EndpointContentType {
  if (endpoint.example?.content_type === "json" || endpoint.example?.content_type === "multipart") {
    return endpoint.example.content_type;
  }

  if (endpoint.example?.fields) {
    return "multipart";
  }

  return "json";
}

function extractArgumentKeys(endpoint: CatalogEndpoint, contentType: EndpointContentType): string[] {
  const source = contentType === "multipart" ? endpoint.example?.fields : endpoint.example?.body;
  if (!source || typeof source !== "object") {
    return [];
  }

  return Object.keys(source)
    .filter((key) => !COSMETIC_ARG_KEYS.has(key))
    .sort();
}

function classifyFamily(path: string): string {
  if (path.startsWith("/v1/chat") || path.startsWith("/v1/responses")) {
    return "text-generation";
  }
  if (path.startsWith("/v1/images")) {
    return "image";
  }
  if (path.startsWith("/v1/audio")) {
    return "audio";
  }
  if (path.startsWith("/v1/video")) {
    return "video";
  }
  if (path.startsWith("/v1/moderations")) {
    return "moderation";
  }
  if (path.startsWith("/v1/embeddings")) {
    return "embedding";
  }

  return path.split("/").filter(Boolean)[0] ?? "other";
}

function endpointSignature(endpoint: CatalogEndpoint, contentType: EndpointContentType, argumentKeys: string[]): string {
  const modelKeys = Object.keys(endpoint.models ?? {})
    .filter((model) => model !== "_default")
    .sort();

  return sha256Hex(
    stableStringify({
      method: endpoint.method.toUpperCase(),
      contentType,
      argumentKeys,
      models: modelKeys,
      family: classifyFamily(endpoint.path)
    })
  );
}

export function normalizeCatalog(catalog: CatalogResponse, fetchedAt = new Date().toISOString()): CatalogState {
  const endpoints: EndpointDescriptor[] = [];

  for (const [apiKey, api] of Object.entries(catalog.apis)) {
    for (const endpoint of api.endpoints) {
      const contentType = inferContentType(endpoint);
      const argumentKeys = extractArgumentKeys(endpoint, contentType);
      const models = Object.keys(endpoint.models ?? {})
        .filter((model) => model !== "_default")
        .sort();

      endpoints.push({
        apiKey,
        apiName: api.name,
        path: endpoint.path,
        method: endpoint.method.toUpperCase(),
        priceType: endpoint.price_type as EndpointDescriptor["priceType"],
        description: endpoint.description ?? `${endpoint.method.toUpperCase()} ${endpoint.path}`,
        contentType,
        argumentKeys,
        models,
        modelPrices: endpoint.models ?? {},
        defaultModel: models[0],
        flatPriceSats: endpoint.price_sats,
        fileField: endpoint.example?.file_field,
        family: classifyFamily(endpoint.path),
        signature: endpointSignature(endpoint, contentType, argumentKeys),
        raw: endpoint
      });
    }
  }

  endpoints.sort((a, b) => {
    const byPath = a.path.localeCompare(b.path);
    if (byPath !== 0) {
      return byPath;
    }

    return a.method.localeCompare(b.method);
  });

  const hash = sha256Hex(
    stableStringify(
      endpoints.map((endpoint) => ({
        apiKey: endpoint.apiKey,
        path: endpoint.path,
        method: endpoint.method,
        signature: endpoint.signature,
        priceType: endpoint.priceType,
        flatPriceSats: endpoint.flatPriceSats,
        models: endpoint.models
      }))
    )
  );

  return {
    raw: catalog,
    endpoints,
    fetchedAt,
    hash,
    summary: {
      apiCount: Object.keys(catalog.apis).length,
      endpointCount: endpoints.length,
      perModelCount: endpoints.filter((endpoint) => endpoint.priceType !== "flat").length,
      flatCount: endpoints.filter((endpoint) => endpoint.priceType === "flat").length,
      endpointPaths: endpoints.map((endpoint) => endpoint.path),
      modelCountsByPath: Object.fromEntries(endpoints.map((endpoint) => [endpoint.path, endpoint.models.length]))
    }
  };
}

export async function fetchCatalog(
  baseUrl: string,
  timeoutMs: number,
  fetchFn: typeof fetch = globalThis.fetch
): Promise<CatalogResponse> {
  if (!fetchFn) {
    throw new Error("No fetch implementation available");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchFn(`${baseUrl}/api/v1/catalog`, {
      method: "GET",
      headers: {
        Accept: "application/json"
      },
      signal: controller.signal
    });

    const bodyText = await response.text();
    if (!response.ok) {
      throw new Error(`Catalog request failed with status ${response.status}: ${bodyText.slice(0, 250)}`);
    }

    const parsedBody = bodyText.length > 0 ? JSON.parse(bodyText) : {};
    return parseCatalog(parsedBody);
  } finally {
    clearTimeout(timer);
  }
}

export class CatalogManager {
  private state: CatalogState | undefined;
  private lastFetchMs = 0;
  private inflight: Promise<CatalogState> | undefined;

  public constructor(
    private readonly options: {
      baseUrl: string;
      timeoutMs: number;
      ttlMs: number;
      fetchFn?: typeof fetch;
    }
  ) {}

  public async initialize(): Promise<CatalogState> {
    return this.getState({ refresh: true });
  }

  public snapshot(): CatalogState | undefined {
    return this.state;
  }

  public async getState(options: { refresh?: boolean } = {}): Promise<CatalogState> {
    const shouldRefresh =
      options.refresh === true ||
      !this.state ||
      Date.now() - this.lastFetchMs > this.options.ttlMs;

    if (!shouldRefresh && this.state) {
      return this.state;
    }

    if (this.inflight) {
      return this.inflight;
    }

    this.inflight = this.fetchAndNormalize().finally(() => {
      this.inflight = undefined;
    });

    return this.inflight;
  }

  public async refresh(): Promise<{ state: CatalogState; changed: boolean }> {
    const previousHash = this.state?.hash;
    const state = await this.getState({ refresh: true });

    return {
      state,
      changed: previousHash !== state.hash
    };
  }

  private async fetchAndNormalize(): Promise<CatalogState> {
    const rawCatalog = await fetchCatalog(this.options.baseUrl, this.options.timeoutMs, this.options.fetchFn);
    const state = normalizeCatalog(rawCatalog);
    this.state = state;
    this.lastFetchMs = Date.now();
    return state;
  }
}
