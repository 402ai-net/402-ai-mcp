import type { AlbomError, AlbomSuccess, AlbomToolResult, NormalizedHttpResponse } from "./types.js";
import { AlbomRuntimeError } from "./errors.js";
import { toErrorMessage } from "./utils.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function pickMessage(data: unknown, fallback: string): string {
  if (typeof data === "string" && data.length > 0) {
    return data;
  }

  if (!isRecord(data)) {
    return fallback;
  }

  const nestedError = isRecord(data.error) ? data.error : undefined;
  return (
    asString(nestedError?.message) ??
    asString(data.message) ??
    asString(data.status) ??
    fallback
  );
}

function mapErrorCode(status: number, data: unknown): string {
  if (isRecord(data)) {
    const nestedError = isRecord(data.error) ? data.error : undefined;
    const directStatus = asString(data.status);

    if (status === 402 && directStatus === "payment_required") {
      return "payment_required";
    }

    if (status === 402 && directStatus === "insufficient_balance") {
      return "insufficient_balance";
    }

    return (
      asString(nestedError?.code) ??
      asString(data.code) ??
      directStatus ??
      (status === 401 ? "invalid_token" : "upstream_error")
    );
  }

  if (status === 401) {
    return "invalid_token";
  }

  if (status === 402) {
    return "payment_required";
  }

  if (status === 404) {
    return "endpoint_not_found";
  }

  if (status === 413) {
    return "request_too_large";
  }

  if (status === 429) {
    return "rate_limited";
  }

  if (status >= 500) {
    return "upstream_unavailable";
  }

  return "upstream_error";
}

function extractPaymentMetadata(data: unknown, headers: Record<string, string>): Record<string, unknown> {
  if (!isRecord(data)) {
    return {};
  }

  const topupHeader = headers["x-topup-url"];
  const metadata: Record<string, unknown> = {};

  for (const field of [
    "amount_sats",
    "invoice",
    "payment_hash",
    "expires_in",
    "required_sats",
    "available_sats"
  ]) {
    if (field in data) {
      metadata[field] = data[field];
    }
  }

  if (topupHeader) {
    metadata.topup_url = topupHeader;
  }

  return metadata;
}

export function buildSuccessResult(
  endpoint: string,
  status: number,
  data: unknown,
  model?: string,
  priceSats?: number
): AlbomSuccess {
  return {
    ok: true,
    status,
    endpoint,
    model,
    price_sats: priceSats,
    data
  };
}

export function buildErrorResult(
  endpoint: string,
  status: number,
  data: unknown,
  headers: Record<string, string>,
  model?: string
): AlbomError {
  const code = mapErrorCode(status, data);
  const defaultMessage = `Upstream request failed with status ${status}`;
  const message = pickMessage(data, defaultMessage);

  return {
    ok: false,
    status,
    endpoint,
    model,
    error: {
      code,
      message,
      ...extractPaymentMetadata(data, headers)
    }
  };
}

export function fromHttpResponse(
  endpoint: string,
  response: NormalizedHttpResponse,
  model?: string,
  priceSats?: number
): AlbomToolResult {
  if (response.status >= 200 && response.status < 300) {
    return buildSuccessResult(endpoint, response.status, response.data, model, priceSats);
  }

  return buildErrorResult(endpoint, response.status, response.data, response.headers, model);
}

export function fromRuntimeError(endpoint: string, error: unknown, model?: string): AlbomError {
  if (error instanceof AlbomRuntimeError) {
    return {
      ok: false,
      status: error.status,
      endpoint,
      model,
      error: {
        code: error.code,
        message: error.message,
        ...error.details
      }
    };
  }

  return {
    ok: false,
    status: 500,
    endpoint,
    model,
    error: {
      code: "internal_error",
      message: toErrorMessage(error)
    }
  };
}

export function summarizeResult(result: AlbomToolResult): string {
  if (result.ok) {
    const modelSuffix = result.model ? ` model=${result.model}` : "";
    const priceSuffix = typeof result.price_sats === "number" ? ` price_sats=${result.price_sats}` : "";
    return `OK ${result.status} endpoint=${result.endpoint}${modelSuffix}${priceSuffix}`;
  }

  return `ERROR ${result.status} endpoint=${result.endpoint} code=${result.error.code} message=${result.error.message}`;
}

export function resolvePriceSats(endpoint: {
  priceType: string;
  flatPriceSats?: number;
  modelPrices: Record<string, { price_sats?: number }>;
  defaultModel?: string;
}): (model?: string) => number | undefined {
  return (model?: string): number | undefined => {
    if (endpoint.priceType === "flat") {
      return endpoint.flatPriceSats;
    }

    if (model && typeof endpoint.modelPrices[model]?.price_sats === "number") {
      return endpoint.modelPrices[model].price_sats;
    }

    if (typeof endpoint.modelPrices._default?.price_sats === "number") {
      return endpoint.modelPrices._default.price_sats;
    }

    const defaultPricing = endpoint.defaultModel ? endpoint.modelPrices[endpoint.defaultModel] : undefined;
    if (typeof defaultPricing?.price_sats === "number") {
      return defaultPricing.price_sats;
    }

    const firstModel = Object.values(endpoint.modelPrices)[0];
    return asNumber(firstModel?.price_sats);
  };
}
