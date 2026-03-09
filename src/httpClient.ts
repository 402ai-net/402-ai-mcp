import type { NormalizedHttpResponse, PreparedUpload } from "./types.js";
import { AlbomRuntimeError } from "./errors.js";
import { sleep, toErrorMessage } from "./utils.js";

interface HttpClientOptions {
  baseUrl: string;
  bearerToken?: string;
  timeoutMs: number;
  maxRetries: number;
  fetchFn?: typeof fetch;
}

interface RequestOptions {
  allowL402Quote?: boolean;
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function normalizeEndpointPath(endpointPath: string): string {
  if (!endpointPath.startsWith("/")) {
    return `/${endpointPath}`;
  }
  return endpointPath;
}

function composeEndpointUrl(baseUrl: string, endpointPath: string): string {
  const normalized = normalizeEndpointPath(endpointPath);
  if (normalized.startsWith("/api/")) {
    return `${baseUrl}${normalized}`;
  }
  return `${baseUrl}/openai${normalized}`;
}

function headersToRecord(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of headers.entries()) {
    result[key.toLowerCase()] = value;
  }
  return result;
}

async function parseResponseData(response: Response): Promise<NormalizedHttpResponse["data"]> {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.includes("application/json")) {
    const text = await response.text();
    if (!text) {
      return {};
    }

    try {
      return JSON.parse(text);
    } catch {
      return { raw: text };
    }
  }

  if (contentType.startsWith("text/")) {
    return response.text();
  }

  const arrayBuffer = await response.arrayBuffer();
  const binary = Buffer.from(arrayBuffer);
  return {
    mime_type: contentType || "application/octet-stream",
    base64: binary.toString("base64"),
    size_bytes: binary.byteLength
  };
}

export class AlbomHttpClient {
  private readonly fetchFn: typeof fetch;
  private bearerToken?: string;

  public constructor(private readonly options: HttpClientOptions) {
    this.fetchFn = options.fetchFn ?? globalThis.fetch;
    this.bearerToken = options.bearerToken;

    if (!this.fetchFn) {
      throw new Error("No fetch implementation available");
    }
  }

  public getBearerToken(): string | undefined {
    return this.bearerToken;
  }

  public setBearerToken(token: string | undefined): void {
    this.bearerToken = token?.trim() || undefined;
  }

  public async postJson(
    endpointPath: string,
    body: Record<string, unknown>,
    requestOptions: RequestOptions = {}
  ): Promise<NormalizedHttpResponse> {
    const headers = this.resolveHeaders(requestOptions);
    headers["content-type"] = "application/json";

    const response = await this.requestWithRetries(composeEndpointUrl(this.options.baseUrl, endpointPath), {
      method: "POST",
      headers,
      body: JSON.stringify(body)
    });

    return response;
  }

  public async putJson(
    endpointPath: string,
    body: Record<string, unknown>,
    requestOptions: RequestOptions = {}
  ): Promise<NormalizedHttpResponse> {
    const headers = this.resolveHeaders(requestOptions);
    headers["content-type"] = "application/json";

    return this.requestWithRetries(composeEndpointUrl(this.options.baseUrl, endpointPath), {
      method: "PUT",
      headers,
      body: JSON.stringify(body)
    });
  }

  public async patchJson(
    endpointPath: string,
    body: Record<string, unknown>,
    requestOptions: RequestOptions = {}
  ): Promise<NormalizedHttpResponse> {
    const headers = this.resolveHeaders(requestOptions);
    headers["content-type"] = "application/json";

    return this.requestWithRetries(composeEndpointUrl(this.options.baseUrl, endpointPath), {
      method: "PATCH",
      headers,
      body: JSON.stringify(body)
    });
  }

  public async getJson(
    endpointPath: string,
    requestOptions: RequestOptions = {}
  ): Promise<NormalizedHttpResponse> {
    const headers = this.resolveHeaders(requestOptions);
    return this.requestWithRetries(composeEndpointUrl(this.options.baseUrl, endpointPath), {
      method: "GET",
      headers
    });
  }

  public async postMultipart(
    endpointPath: string,
    fields: Record<string, unknown>,
    uploads: PreparedUpload[],
    requestOptions: RequestOptions = {}
  ): Promise<NormalizedHttpResponse> {
    const headers = this.resolveHeaders(requestOptions);

    const formData = new FormData();
    for (const [field, value] of Object.entries(fields)) {
      if (value === undefined || value === null) {
        continue;
      }

      const finalValue =
        typeof value === "string" || typeof value === "number" || typeof value === "boolean"
          ? String(value)
          : JSON.stringify(value);
      formData.set(field, finalValue);
    }

    for (const upload of uploads) {
      formData.set(
        upload.fieldName,
        new Blob([new Uint8Array(upload.buffer)], {
          type: upload.mimeType
        }),
        upload.fileName
      );
    }

    const response = await this.requestWithRetries(composeEndpointUrl(this.options.baseUrl, endpointPath), {
      method: "POST",
      headers,
      body: formData
    });

    return response;
  }

  public async rawPost(
    endpointPath: string,
    body: BodyInit,
    contentType: string | undefined,
    requestOptions: RequestOptions = {}
  ): Promise<NormalizedHttpResponse> {
    const headers = this.resolveHeaders(requestOptions);
    if (contentType) {
      headers["content-type"] = contentType;
    }

    return this.requestWithRetries(composeEndpointUrl(this.options.baseUrl, endpointPath), {
      method: "POST",
      headers,
      body
    });
  }

  private resolveHeaders(requestOptions: RequestOptions): Record<string, string> {
    const headers: Record<string, string> = {
      accept: "*/*"
    };

    if (this.bearerToken) {
      headers.authorization = `Bearer ${this.bearerToken}`;
      return headers;
    }

    if (requestOptions.allowL402Quote) {
      return headers;
    }

    throw new AlbomRuntimeError(
      "missing_bearer_token",
      "ALBOM_BEARER_TOKEN is not set. Configure it or set allow_l402_quote=true to request a payment quote.",
      401
    );
  }

  private async requestWithRetries(url: string, requestInit: RequestInit): Promise<NormalizedHttpResponse> {
    const maxAttempts = this.options.maxRetries + 1;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        const response = await this.fetchWithTimeout(url, requestInit);

        if (isRetryableStatus(response.status) && attempt < maxAttempts - 1) {
          await sleep(this.backoffMs(attempt));
          continue;
        }

        return {
          status: response.status,
          headers: headersToRecord(response.headers),
          data: await parseResponseData(response)
        };
      } catch (error) {
        const shouldRetry = attempt < maxAttempts - 1;
        if (shouldRetry) {
          await sleep(this.backoffMs(attempt));
          continue;
        }

        const code = error instanceof DOMException && error.name === "AbortError" ? "upstream_timeout" : "network_error";
        const status = code === "upstream_timeout" ? 504 : 503;
        throw new AlbomRuntimeError(code, `HTTP request failed: ${toErrorMessage(error)}`, status);
      }
    }

    throw new AlbomRuntimeError("internal_retry_error", "Retry loop exited unexpectedly", 500);
  }

  private async fetchWithTimeout(url: string, requestInit: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);

    try {
      return await this.fetchFn(url, {
        ...requestInit,
        signal: controller.signal
      });
    } finally {
      clearTimeout(timer);
    }
  }

  private backoffMs(attempt: number): number {
    return Math.round(200 * 2 ** attempt + Math.random() * 80);
  }
}
