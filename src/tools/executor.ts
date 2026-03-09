import type { AlbomConfig } from "../config.js";
import type { NwcAutoTopupManager } from "../autoTopup.js";
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
  autoTopupManager?: NwcAutoTopupManager;
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
  private readonly autoTopupManager?: NwcAutoTopupManager;

  public constructor(deps: ToolExecutorDependencies) {
    this.config = deps.config;
    this.httpClient = deps.httpClient;
    this.getCatalogState = deps.getCatalogState;
    this.refreshCatalog = deps.refreshCatalog;
    this.getToolState = deps.getToolState;
    this.autoTopupManager = deps.autoTopupManager;
  }

  public async execute(tool: PlannedTool, rawArgs: unknown): Promise<AlbomToolResult> {
    let result: AlbomToolResult;
    try {
      const args = asRecord(rawArgs);

      switch (tool.kind) {
        case "catalog_get":
          result = await this.handleCatalogGet(args);
          break;
        case "marketplace_get_my_account":
          result = await this.handleMarketplaceGetMyAccount(tool.endpointPath);
          break;
        case "marketplace_list_tasks":
          result = await this.handleMarketplaceListTasks(tool.endpointPath, args);
          break;
        case "marketplace_get_task":
          result = await this.handleMarketplaceGetTask(tool.endpointPath, args);
          break;
        case "marketplace_post_task":
          result = await this.handleMarketplacePostTask(tool.endpointPath, args);
          break;
        case "marketplace_quote_task":
          result = await this.handleMarketplaceQuoteTask(tool.endpointPath, args);
          break;
        case "marketplace_update_quote":
          result = await this.handleMarketplaceUpdateQuote(tool.endpointPath, args);
          break;
        case "marketplace_accept_quote":
          result = await this.handleMarketplaceAcceptQuote(tool.endpointPath, args);
          break;
        case "marketplace_list_quote_messages":
          result = await this.handleMarketplaceListQuoteMessages(tool.endpointPath, args);
          break;
        case "marketplace_send_quote_message":
          result = await this.handleMarketplaceSendQuoteMessage(tool.endpointPath, args);
          break;
        case "marketplace_submit_result":
          result = await this.handleMarketplaceSubmitResult(tool.endpointPath, args);
          break;
        case "marketplace_confirm_delivery":
          result = await this.handleMarketplaceConfirmDelivery(tool.endpointPath, args);
          break;
        case "marketplace_list_workers":
          result = await this.handleMarketplaceListWorkers(tool.endpointPath, args);
          break;
        case "marketplace_get_worker_profile":
          result = await this.handleMarketplaceGetWorkerProfile(tool.endpointPath, args);
          break;
        case "marketplace_upsert_profile":
          result = await this.handleMarketplaceUpsertProfile(tool.endpointPath, args);
          break;
        case "marketplace_review_task":
          result = await this.handleMarketplaceReviewTask(tool.endpointPath, args);
          break;
        case "text_generate":
          result = await this.handleTextGenerate(tool.endpointPath, args);
          break;
        case "image_generate":
          result = await this.handleImageGenerate(tool.endpointPath, args);
          break;
        case "image_edit":
          result = await this.handleImageEdit(tool.endpointPath, args);
          break;
        case "audio_transcribe":
          result = await this.handleAudioTranscribe(tool.endpointPath, tool.translationEndpointPath, args);
          break;
        case "audio_speech":
          result = await this.handleAudioSpeech(tool.endpointPath, args);
          break;
        case "video_generate":
          result = await this.handleVideoGenerate(tool.endpointPath, args);
          break;
        case "safety_moderate":
          result = await this.handleModeration(tool.endpointPath, args);
          break;
        case "embedding_create":
          result = await this.handleEmbedding(tool.endpointPath, args);
          break;
        case "full_endpoint":
          result = await this.handleFullEndpoint(tool, args);
          break;
        case "raw_call":
          result = await this.handleRawCall(args);
          break;
        default:
          throw new AlbomRuntimeError("unknown_tool", `Unhandled tool kind ${(tool as PlannedTool).kind}`, 500);
      }
    } catch (error) {
      const endpoint = "endpointPath" in tool ? tool.endpointPath : "internal";
      result = fromRuntimeError(endpoint, error);
    }

    return this.attachAutoTopup(result);
  }

  private async attachAutoTopup(result: AlbomToolResult): Promise<AlbomToolResult> {
    const autoTopup = await this.autoTopupManager?.maybeTopup(result);
    if (!autoTopup) {
      return result;
    }

    return {
      ...result,
      auto_topup: autoTopup
    };
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

  private fillPathTemplate(template: string, params: Record<string, string>): string {
    let result = template;
    for (const [key, value] of Object.entries(params)) {
      result = result.replace(`{${key}}`, encodeURIComponent(value));
    }
    return result;
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

  private async callMarketplaceGet(endpointPath: string): Promise<AlbomToolResult> {
    try {
      const response = await this.httpClient.getJson(endpointPath);
      return fromHttpResponse(endpointPath, response);
    } catch (error) {
      return fromRuntimeError(endpointPath, error);
    }
  }

  private async callMarketplacePost(endpointPath: string, body: Record<string, unknown>): Promise<AlbomToolResult> {
    try {
      const response = await this.httpClient.postJson(endpointPath, body);
      return fromHttpResponse(endpointPath, response);
    } catch (error) {
      return fromRuntimeError(endpointPath, error);
    }
  }

  private async callMarketplacePatch(endpointPath: string, body: Record<string, unknown>): Promise<AlbomToolResult> {
    try {
      const response = await this.httpClient.patchJson(endpointPath, body);
      return fromHttpResponse(endpointPath, response);
    } catch (error) {
      return fromRuntimeError(endpointPath, error);
    }
  }

  private async callMarketplacePut(endpointPath: string, body: Record<string, unknown>): Promise<AlbomToolResult> {
    try {
      const response = await this.httpClient.putJson(endpointPath, body);
      return fromHttpResponse(endpointPath, response);
    } catch (error) {
      return fromRuntimeError(endpointPath, error);
    }
  }

  private async handleMarketplaceGetMyAccount(endpointPath: string): Promise<AlbomToolResult> {
    return this.callMarketplaceGet(endpointPath);
  }

  private async handleMarketplaceListTasks(endpointPath: string, args: Record<string, unknown>): Promise<AlbomToolResult> {
    const status = asString(args.status);
    const path = status ? `${endpointPath}?status=${encodeURIComponent(status)}` : endpointPath;
    return this.callMarketplaceGet(path);
  }

  private async handleMarketplaceGetTask(endpointPath: string, args: Record<string, unknown>): Promise<AlbomToolResult> {
    const taskId = this.requireString(args, "task_id");
    return this.callMarketplaceGet(this.fillPathTemplate(endpointPath, { task_id: taskId }));
  }

  private async handleMarketplacePostTask(endpointPath: string, args: Record<string, unknown>): Promise<AlbomToolResult> {
    return this.callMarketplacePost(endpointPath, {
      title: this.requireString(args, "title"),
      description: asString(args.description) ?? "",
      budget_sats: args.budget_sats
    });
  }

  private async handleMarketplaceQuoteTask(endpointPath: string, args: Record<string, unknown>): Promise<AlbomToolResult> {
    const taskId = this.requireString(args, "task_id");
    return this.callMarketplacePost(this.fillPathTemplate(endpointPath, { task_id: taskId }), {
      price_sats: args.price_sats,
      description: asString(args.description) ?? ""
    });
  }

  private async handleMarketplaceUpdateQuote(endpointPath: string, args: Record<string, unknown>): Promise<AlbomToolResult> {
    const taskId = this.requireString(args, "task_id");
    const quoteId = this.requireString(args, "quote_id");
    const body: Record<string, unknown> = {};
    maybeAdd(body, "price_sats", args.price_sats);
    maybeAdd(body, "description", args.description);
    return this.callMarketplacePatch(this.fillPathTemplate(endpointPath, { task_id: taskId, quote_id: quoteId }), body);
  }

  private async handleMarketplaceAcceptQuote(endpointPath: string, args: Record<string, unknown>): Promise<AlbomToolResult> {
    const taskId = this.requireString(args, "task_id");
    const quoteId = this.requireString(args, "quote_id");
    return this.callMarketplacePost(this.fillPathTemplate(endpointPath, { task_id: taskId, quote_id: quoteId }), {});
  }

  private async handleMarketplaceListQuoteMessages(endpointPath: string, args: Record<string, unknown>): Promise<AlbomToolResult> {
    const taskId = this.requireString(args, "task_id");
    const quoteId = this.requireString(args, "quote_id");
    const sinceId = typeof args.since_id === "number" ? `?since_id=${args.since_id}` : "";
    return this.callMarketplaceGet(
      `${this.fillPathTemplate(endpointPath, { task_id: taskId, quote_id: quoteId })}${sinceId}`
    );
  }

  private async handleMarketplaceSendQuoteMessage(endpointPath: string, args: Record<string, unknown>): Promise<AlbomToolResult> {
    const taskId = this.requireString(args, "task_id");
    const quoteId = this.requireString(args, "quote_id");
    return this.callMarketplacePost(this.fillPathTemplate(endpointPath, { task_id: taskId, quote_id: quoteId }), {
      body: this.requireString(args, "body")
    });
  }

  private async handleMarketplaceSubmitResult(endpointPath: string, args: Record<string, unknown>): Promise<AlbomToolResult> {
    const taskId = this.requireString(args, "task_id");
    return this.callMarketplacePost(this.fillPathTemplate(endpointPath, { task_id: taskId }), {
      filename: asString(args.filename) ?? "",
      content_base64: asString(args.content_base64) ?? "",
      notes: asString(args.notes) ?? ""
    });
  }

  private async handleMarketplaceConfirmDelivery(endpointPath: string, args: Record<string, unknown>): Promise<AlbomToolResult> {
    const taskId = this.requireString(args, "task_id");
    return this.callMarketplacePost(this.fillPathTemplate(endpointPath, { task_id: taskId }), {});
  }

  private async handleMarketplaceListWorkers(endpointPath: string, args: Record<string, unknown>): Promise<AlbomToolResult> {
    const includeInactive = asBoolean(args.include_inactive, false);
    const path = includeInactive ? `${endpointPath}?all=true` : endpointPath;
    return this.callMarketplaceGet(path);
  }

  private async handleMarketplaceGetWorkerProfile(endpointPath: string, args: Record<string, unknown>): Promise<AlbomToolResult> {
    const accountId = this.requireString(args, "account_id");
    return this.callMarketplaceGet(this.fillPathTemplate(endpointPath, { account_id: accountId }));
  }

  private async handleMarketplaceUpsertProfile(endpointPath: string, args: Record<string, unknown>): Promise<AlbomToolResult> {
    return this.callMarketplacePut(endpointPath, {
      display_name: this.requireString(args, "display_name"),
      actor_type: asString(args.actor_type) ?? "agent",
      headline: asString(args.headline) ?? "",
      capabilities: Array.isArray(args.capabilities) ? args.capabilities : [],
      delivery_types: Array.isArray(args.delivery_types) ? args.delivery_types : [],
      sample_artifacts: Array.isArray(args.sample_artifacts) ? args.sample_artifacts : [],
      active: asBoolean(args.active, true)
    });
  }

  private async handleMarketplaceReviewTask(endpointPath: string, args: Record<string, unknown>): Promise<AlbomToolResult> {
    const taskId = this.requireString(args, "task_id");
    return this.callMarketplacePost(this.fillPathTemplate(endpointPath, { task_id: taskId }), {
      rating: args.rating,
      review: asString(args.review) ?? ""
    });
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
