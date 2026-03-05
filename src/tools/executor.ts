import type { AlbomConfig } from "../config.js";
import type {
  AlbomToolResult,
  CatalogState,
  EndpointDescriptor,
  FullEndpointTool,
  PlannedTool,
  PreparedUpload,
  ToolState
} from "../types.js";
import { endpointByPathFromCatalog } from "../dedup.js";
import { AlbomRuntimeError } from "../errors.js";
import { AlbomHttpClient } from "../httpClient.js";
import { fromHttpResponse, fromRuntimeError, resolvePriceSats } from "../results.js";
import { prepareUpload } from "../uploads.js";

interface ToolExecutorDependencies {
  config: AlbomConfig;
  httpClient: AlbomHttpClient;
  getCatalogState: () => CatalogState;
  refreshCatalog: () => Promise<CatalogState>;
  getToolState: () => ToolState | undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null) {
    return value as Record<string, unknown>;
  }

  return {};
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function maybeAdd(target: Record<string, unknown>, key: string, value: unknown): void {
  if (value !== undefined) {
    target[key] = value;
  }
}

export class AlbomToolExecutor {
  private readonly config: AlbomConfig;
  private readonly httpClient: AlbomHttpClient;
  private readonly getCatalogState: () => CatalogState;
  private readonly refreshCatalog: () => Promise<CatalogState>;
  private readonly getToolState: () => ToolState | undefined;

  public constructor(deps: ToolExecutorDependencies) {
    this.config = deps.config;
    this.httpClient = deps.httpClient;
    this.getCatalogState = deps.getCatalogState;
    this.refreshCatalog = deps.refreshCatalog;
    this.getToolState = deps.getToolState;
  }

  public async execute(tool: PlannedTool, rawArgs: unknown): Promise<AlbomToolResult> {
    try {
      const args = asRecord(rawArgs);

      switch (tool.kind) {
        case "catalog_get":
          return this.handleCatalogGet(args);
        case "text_generate":
          return this.handleTextGenerate(tool.endpointPath, args);
        case "image_generate":
          return this.handleImageGenerate(tool.endpointPath, args);
        case "image_edit":
          return this.handleImageEdit(tool.endpointPath, args);
        case "audio_transcribe":
          return this.handleAudioTranscribe(tool.endpointPath, tool.translationEndpointPath, args);
        case "audio_speech":
          return this.handleAudioSpeech(tool.endpointPath, args);
        case "video_generate":
          return this.handleVideoGenerate(tool.endpointPath, args);
        case "safety_moderate":
          return this.handleModeration(tool.endpointPath, args);
        case "embedding_create":
          return this.handleEmbedding(tool.endpointPath, args);
        case "full_endpoint":
          return this.handleFullEndpoint(tool, args);
        case "raw_call":
          return this.handleRawCall(args);
        default:
          throw new AlbomRuntimeError("unknown_tool", `Unhandled tool kind ${(tool as PlannedTool).kind}`, 500);
      }
    } catch (error) {
      const endpoint = "endpointPath" in tool ? tool.endpointPath : "internal";
      return fromRuntimeError(endpoint, error);
    }
  }

  private requireString(args: Record<string, unknown>, key: string): string {
    const value = asString(args[key]);
    if (!value) {
      throw new AlbomRuntimeError("invalid_input", `Missing required field: ${key}`, 400);
    }

    return value;
  }

  private getEndpoint(path: string, catalogState = this.getCatalogState()): EndpointDescriptor {
    const endpoint = endpointByPathFromCatalog(catalogState, path);
    if (!endpoint) {
      throw new AlbomRuntimeError("endpoint_not_found", `Endpoint not present in catalog: ${path}`, 404);
    }

    return endpoint;
  }

  private allowL402Quote(args: Record<string, unknown>): boolean {
    return asBoolean(args.allow_l402_quote, false);
  }

  private async handleCatalogGet(args: Record<string, unknown>): Promise<AlbomToolResult> {
    const refresh = asBoolean(args.refresh, false);
    const catalog = refresh ? await this.refreshCatalog() : this.getCatalogState();
    const toolState = this.getToolState();

    return {
      ok: true,
      status: 200,
      endpoint: "/api/v1/catalog",
      data: {
        catalog: catalog.raw,
        normalized_summary: catalog.summary,
        fetched_at: catalog.fetchedAt,
        tool_profile: toolState?.profile,
        tools: toolState?.tools.map((tool) => ({
          kind: tool.kind,
          name: tool.name,
          endpoint: "endpointPath" in tool ? tool.endpointPath : undefined
        }))
      }
    };
  }

  private async callJson(
    endpointPath: string,
    body: Record<string, unknown>,
    options: { model?: string; allowL402Quote: boolean }
  ): Promise<AlbomToolResult> {
    const endpoint = this.getEndpoint(endpointPath);

    try {
      const response = await this.httpClient.postJson(endpointPath, body, {
        allowL402Quote: options.allowL402Quote
      });
      const price = resolvePriceSats(endpoint)(options.model);
      return fromHttpResponse(endpointPath, response, options.model, price);
    } catch (error) {
      return fromRuntimeError(endpointPath, error, options.model);
    }
  }

  private async callMultipart(
    endpointPath: string,
    fields: Record<string, unknown>,
    uploads: PreparedUpload[],
    options: { model?: string; allowL402Quote: boolean }
  ): Promise<AlbomToolResult> {
    const endpoint = this.getEndpoint(endpointPath);

    try {
      const response = await this.httpClient.postMultipart(endpointPath, fields, uploads, {
        allowL402Quote: options.allowL402Quote
      });
      const price = resolvePriceSats(endpoint)(options.model);
      return fromHttpResponse(endpointPath, response, options.model, price);
    } catch (error) {
      return fromRuntimeError(endpointPath, error, options.model);
    }
  }

  private async handleTextGenerate(endpointPath: string, args: Record<string, unknown>): Promise<AlbomToolResult> {
    const model = this.requireString(args, "model");
    if (!("input" in args)) {
      throw new AlbomRuntimeError("invalid_input", "Missing required field: input", 400);
    }

    const body: Record<string, unknown> = {
      model,
      input: args.input
    };

    maybeAdd(body, "instructions", args.instructions);
    maybeAdd(body, "max_output_tokens", args.max_output_tokens);
    maybeAdd(body, "temperature", args.temperature);

    const extra = asRecord(args.extra);
    for (const [key, value] of Object.entries(extra)) {
      if (!(key in body)) {
        body[key] = value;
      }
    }

    return this.callJson(endpointPath, body, {
      model,
      allowL402Quote: this.allowL402Quote(args)
    });
  }

  private async handleImageGenerate(endpointPath: string, args: Record<string, unknown>): Promise<AlbomToolResult> {
    const model = this.requireString(args, "model");
    const prompt = this.requireString(args, "prompt");

    const body: Record<string, unknown> = {
      model,
      prompt
    };

    maybeAdd(body, "size", args.size);
    maybeAdd(body, "quality", args.quality);
    maybeAdd(body, "style", args.style);

    return this.callJson(endpointPath, body, {
      model,
      allowL402Quote: this.allowL402Quote(args)
    });
  }

  private async handleImageEdit(endpointPath: string, args: Record<string, unknown>): Promise<AlbomToolResult> {
    const model = this.requireString(args, "model");
    const prompt = this.requireString(args, "prompt");

    const mainImage = await prepareUpload({
      fieldName: "image",
      label: "image",
      filePath: asString(args.image_file_path),
      fileBase64: asString(args.image_file_base64),
      fileName: asString(args.image_file_name),
      mimeType: asString(args.image_mime_type),
      maxBytes: this.config.maxUploadBytes,
      required: true
    });

    const maskImage = await prepareUpload({
      fieldName: "mask",
      label: "mask",
      filePath: asString(args.mask_file_path),
      fileBase64: asString(args.mask_file_base64),
      fileName: asString(args.mask_file_name),
      mimeType: asString(args.mask_mime_type),
      maxBytes: this.config.maxUploadBytes,
      required: false
    });

    const uploads: PreparedUpload[] = [mainImage].filter((upload): upload is PreparedUpload => upload !== undefined);
    if (maskImage) {
      uploads.push(maskImage);
    }

    const fields: Record<string, unknown> = {
      model,
      prompt
    };

    maybeAdd(fields, "size", args.size);

    return this.callMultipart(endpointPath, fields, uploads, {
      model,
      allowL402Quote: this.allowL402Quote(args)
    });
  }

  private async handleAudioTranscribe(
    endpointPath: string,
    translationEndpointPath: string | undefined,
    args: Record<string, unknown>
  ): Promise<AlbomToolResult> {
    const translateToEnglish = asBoolean(args.translate_to_english, false);
    const resolvedEndpoint = translateToEnglish && translationEndpointPath ? translationEndpointPath : endpointPath;
    const model = asString(args.model);

    const audioUpload = await prepareUpload({
      fieldName: "file",
      label: "audio",
      filePath: asString(args.audio_file_path),
      fileBase64: asString(args.audio_file_base64),
      fileName: asString(args.audio_file_name),
      mimeType: asString(args.audio_mime_type),
      maxBytes: this.config.maxUploadBytes,
      required: true
    });
    if (!audioUpload) {
      throw new AlbomRuntimeError("missing_file", "Audio file is required", 400);
    }

    const fields: Record<string, unknown> = {};
    maybeAdd(fields, "model", model);
    maybeAdd(fields, "prompt", args.prompt);
    maybeAdd(fields, "temperature", args.temperature);
    maybeAdd(fields, "language", args.language);
    maybeAdd(fields, "response_format", args.response_format);

    return this.callMultipart(resolvedEndpoint, fields, [audioUpload], {
      model,
      allowL402Quote: this.allowL402Quote(args)
    });
  }

  private async handleAudioSpeech(endpointPath: string, args: Record<string, unknown>): Promise<AlbomToolResult> {
    const model = this.requireString(args, "model");
    const voice = this.requireString(args, "voice");
    const input = this.requireString(args, "input");

    const body: Record<string, unknown> = {
      model,
      voice,
      input
    };

    const format = asString(args.format);
    if (format) {
      body.response_format = format;
    }

    maybeAdd(body, "speed", args.speed);

    return this.callJson(endpointPath, body, {
      model,
      allowL402Quote: this.allowL402Quote(args)
    });
  }

  private async handleVideoGenerate(endpointPath: string, args: Record<string, unknown>): Promise<AlbomToolResult> {
    const model = this.requireString(args, "model");
    const prompt = this.requireString(args, "prompt");

    const body: Record<string, unknown> = {
      model,
      prompt
    };

    maybeAdd(body, "duration", args.duration);
    maybeAdd(body, "size", args.size);

    return this.callJson(endpointPath, body, {
      model,
      allowL402Quote: this.allowL402Quote(args)
    });
  }

  private async handleModeration(endpointPath: string, args: Record<string, unknown>): Promise<AlbomToolResult> {
    if (!("input" in args)) {
      throw new AlbomRuntimeError("invalid_input", "Missing required field: input", 400);
    }

    const model = asString(args.model);
    const body: Record<string, unknown> = {
      input: args.input
    };

    maybeAdd(body, "model", model);

    return this.callJson(endpointPath, body, {
      model,
      allowL402Quote: this.allowL402Quote(args)
    });
  }

  private async handleEmbedding(endpointPath: string, args: Record<string, unknown>): Promise<AlbomToolResult> {
    if (!("input" in args)) {
      throw new AlbomRuntimeError("invalid_input", "Missing required field: input", 400);
    }

    const model = asString(args.model);
    const body: Record<string, unknown> = {
      input: args.input
    };

    maybeAdd(body, "model", model);

    return this.callJson(endpointPath, body, {
      model,
      allowL402Quote: this.allowL402Quote(args)
    });
  }

  private async handleFullEndpoint(tool: FullEndpointTool, args: Record<string, unknown>): Promise<AlbomToolResult> {
    const model = asString(args.model);
    const allowL402Quote = this.allowL402Quote(args);

    if (tool.contentType === "json") {
      const body = asRecord(args.body);
      if (model && body.model === undefined) {
        body.model = model;
      }

      return this.callJson(tool.endpointPath, body, {
        model,
        allowL402Quote
      });
    }

    const fields = asRecord(args.fields);
    if (model && fields.model === undefined) {
      fields.model = model;
    }

    const fileField = asString(args.file_field) ?? tool.fileField ?? "file";
    const upload = await prepareUpload({
      fieldName: fileField,
      label: "file",
      filePath: asString(args.file_path),
      fileBase64: asString(args.file_base64),
      fileName: asString(args.file_name),
      mimeType: asString(args.mime_type),
      maxBytes: this.config.maxUploadBytes,
      required: Boolean(tool.fileField)
    });

    return this.callMultipart(
      tool.endpointPath,
      fields,
      upload ? [upload] : [],
      {
        model,
        allowL402Quote
      }
    );
  }

  private async handleRawCall(args: Record<string, unknown>): Promise<AlbomToolResult> {
    const endpointPath = this.requireString(args, "endpoint");
    const catalog = this.getCatalogState();

    const endpoint = endpointByPathFromCatalog(catalog, endpointPath);
    if (!endpoint) {
      throw new AlbomRuntimeError("endpoint_not_allowlisted", `Endpoint is not present in current catalog: ${endpointPath}`, 400);
    }

    const allowL402Quote = this.allowL402Quote(args);
    const model = asString(args.model);
    const contentType = asString(args.content_type) ?? endpoint.contentType;

    if (contentType === "json") {
      const body = asRecord(args.body);
      if (model && body.model === undefined) {
        body.model = model;
      }

      return this.callJson(endpointPath, body, {
        model,
        allowL402Quote
      });
    }

    if (contentType !== "multipart") {
      throw new AlbomRuntimeError("invalid_input", "content_type must be json or multipart", 400);
    }

    const fields = asRecord(args.fields);
    if (model && fields.model === undefined) {
      fields.model = model;
    }

    const fileField = asString(args.file_field) ?? endpoint.fileField ?? "file";
    const upload = await prepareUpload({
      fieldName: fileField,
      label: "file",
      filePath: asString(args.file_path),
      fileBase64: asString(args.file_base64),
      fileName: asString(args.file_name),
      mimeType: asString(args.mime_type),
      maxBytes: this.config.maxUploadBytes,
      required: Boolean(endpoint.fileField)
    });

    return this.callMultipart(endpointPath, fields, upload ? [upload] : [], {
      model,
      allowL402Quote
    });
  }
}
