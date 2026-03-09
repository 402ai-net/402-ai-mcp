import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";

export type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";

export type ToolProfile = "compact" | "full";
export type PriceType =
  | "per_model"
  | "flat"
  | "token_usage"
  | "image_generation"
  | "tts"
  | "audio_transcription"
  | "video_generation"
  | "embedding";
export type EndpointContentType = "json" | "multipart";

export interface CatalogModelPrice {
  price_sats?: number;
  price_usd_cents?: number;
  max_output_tokens?: number;
  input_usd_per_mtok?: number;
  output_usd_per_mtok?: number;
  [key: string]: unknown;
}

export interface CatalogEndpointExample {
  content_type?: EndpointContentType;
  body?: Record<string, unknown>;
  fields?: Record<string, unknown>;
  file_field?: string;
  file_name?: string;
  [key: string]: unknown;
}

export interface CatalogEndpoint {
  path: string;
  method: string;
  price_type: PriceType;
  description?: string;
  example?: CatalogEndpointExample;
  models?: Record<string, CatalogModelPrice>;
  price_sats?: number;
  price_usd_cents?: number;
  [key: string]: unknown;
}

export interface CatalogApi {
  name: string;
  endpoints: CatalogEndpoint[];
}

export interface CatalogResponse {
  btc_usd?: number;
  btc_usd_updated_at?: string;
  apis: Record<string, CatalogApi>;
}

export interface EndpointDescriptor {
  apiKey: string;
  apiName: string;
  path: string;
  method: string;
  priceType: PriceType;
  description: string;
  contentType: EndpointContentType;
  argumentKeys: string[];
  models: string[];
  modelPrices: Record<string, CatalogModelPrice>;
  defaultModel?: string;
  flatPriceSats?: number;
  fileField?: string;
  family: string;
  signature: string;
  raw: CatalogEndpoint;
}

export interface CatalogSummary {
  apiCount: number;
  endpointCount: number;
  perModelCount: number;
  flatCount: number;
  endpointPaths: string[];
  modelCountsByPath: Record<string, number>;
}

export interface CatalogState {
  raw: CatalogResponse;
  endpoints: EndpointDescriptor[];
  fetchedAt: string;
  hash: string;
  summary: CatalogSummary;
}

interface PlannedToolBase {
  kind:
    | "catalog_get"
    | "marketplace_list_tasks"
    | "marketplace_get_task"
    | "marketplace_post_task"
    | "marketplace_quote_task"
    | "marketplace_update_quote"
    | "marketplace_accept_quote"
    | "marketplace_list_quote_messages"
    | "marketplace_send_quote_message"
    | "marketplace_submit_result"
    | "marketplace_confirm_delivery"
    | "marketplace_get_my_account"
    | "marketplace_list_workers"
    | "marketplace_get_worker_profile"
    | "marketplace_upsert_profile"
    | "marketplace_review_task"
    | "text_generate"
    | "image_generate"
    | "image_edit"
    | "audio_transcribe"
    | "audio_speech"
    | "video_generate"
    | "safety_moderate"
    | "embedding_create"
    | "full_endpoint"
    | "raw_call";
  name: string;
  title: string;
  description: string;
  annotations?: ToolAnnotations;
}

export interface CatalogGetTool extends PlannedToolBase {
  kind: "catalog_get";
}

export interface MarketplaceToolBase extends PlannedToolBase {
  endpointPath: string;
}

export interface MarketplaceListTasksTool extends MarketplaceToolBase {
  kind: "marketplace_list_tasks";
}

export interface MarketplaceGetTaskTool extends MarketplaceToolBase {
  kind: "marketplace_get_task";
}

export interface MarketplacePostTaskTool extends MarketplaceToolBase {
  kind: "marketplace_post_task";
}

export interface MarketplaceQuoteTaskTool extends MarketplaceToolBase {
  kind: "marketplace_quote_task";
}

export interface MarketplaceUpdateQuoteTool extends MarketplaceToolBase {
  kind: "marketplace_update_quote";
}

export interface MarketplaceAcceptQuoteTool extends MarketplaceToolBase {
  kind: "marketplace_accept_quote";
}

export interface MarketplaceListQuoteMessagesTool extends MarketplaceToolBase {
  kind: "marketplace_list_quote_messages";
}

export interface MarketplaceSendQuoteMessageTool extends MarketplaceToolBase {
  kind: "marketplace_send_quote_message";
}

export interface MarketplaceSubmitResultTool extends MarketplaceToolBase {
  kind: "marketplace_submit_result";
}

export interface MarketplaceConfirmDeliveryTool extends MarketplaceToolBase {
  kind: "marketplace_confirm_delivery";
}

export interface MarketplaceGetMyAccountTool extends MarketplaceToolBase {
  kind: "marketplace_get_my_account";
}

export interface MarketplaceListWorkersTool extends MarketplaceToolBase {
  kind: "marketplace_list_workers";
}

export interface MarketplaceGetWorkerProfileTool extends MarketplaceToolBase {
  kind: "marketplace_get_worker_profile";
}

export interface MarketplaceUpsertProfileTool extends MarketplaceToolBase {
  kind: "marketplace_upsert_profile";
}

export interface MarketplaceReviewTaskTool extends MarketplaceToolBase {
  kind: "marketplace_review_task";
}

export interface TextGenerateTool extends PlannedToolBase {
  kind: "text_generate";
  endpointPath: string;
}

export interface ImageGenerateTool extends PlannedToolBase {
  kind: "image_generate";
  endpointPath: string;
}

export interface ImageEditTool extends PlannedToolBase {
  kind: "image_edit";
  endpointPath: string;
}

export interface AudioTranscribeTool extends PlannedToolBase {
  kind: "audio_transcribe";
  endpointPath: string;
  translationEndpointPath?: string;
}

export interface AudioSpeechTool extends PlannedToolBase {
  kind: "audio_speech";
  endpointPath: string;
}

export interface VideoGenerateTool extends PlannedToolBase {
  kind: "video_generate";
  endpointPath: string;
}

export interface SafetyModerateTool extends PlannedToolBase {
  kind: "safety_moderate";
  endpointPath: string;
}

export interface EmbeddingCreateTool extends PlannedToolBase {
  kind: "embedding_create";
  endpointPath: string;
}

export interface FullEndpointTool extends PlannedToolBase {
  kind: "full_endpoint";
  endpointPath: string;
  contentType: EndpointContentType;
  fileField?: string;
}

export interface RawCallTool extends PlannedToolBase {
  kind: "raw_call";
}

export type PlannedTool =
  | CatalogGetTool
  | MarketplaceListTasksTool
  | MarketplaceGetTaskTool
  | MarketplacePostTaskTool
  | MarketplaceQuoteTaskTool
  | MarketplaceUpdateQuoteTool
  | MarketplaceAcceptQuoteTool
  | MarketplaceListQuoteMessagesTool
  | MarketplaceSendQuoteMessageTool
  | MarketplaceSubmitResultTool
  | MarketplaceConfirmDeliveryTool
  | MarketplaceGetMyAccountTool
  | MarketplaceListWorkersTool
  | MarketplaceGetWorkerProfileTool
  | MarketplaceUpsertProfileTool
  | MarketplaceReviewTaskTool
  | TextGenerateTool
  | ImageGenerateTool
  | ImageEditTool
  | AudioTranscribeTool
  | AudioSpeechTool
  | VideoGenerateTool
  | SafetyModerateTool
  | EmbeddingCreateTool
  | FullEndpointTool
  | RawCallTool;

export interface ToolState {
  profile: ToolProfile;
  tools: PlannedTool[];
  signature: string;
}

export interface AutoTopupInfo {
  attempted: boolean;
  triggered: boolean;
  status: "succeeded" | "failed" | "skipped";
  reason?: string;
  threshold_sats: number;
  topup_usd: number;
  balance_sats?: number;
  previous_balance_sats?: number;
  new_balance_sats?: number;
  error?: string;
}

export interface AlbomSuccess<T = unknown> {
  ok: true;
  status: number;
  endpoint: string;
  model?: string;
  price_sats?: number;
  data: T;
  auto_topup?: AutoTopupInfo;
}

export interface AlbomErrorPayload {
  code: string;
  message: string;
  [key: string]: unknown;
}

export interface AlbomError {
  ok: false;
  status: number;
  endpoint: string;
  model?: string;
  error: AlbomErrorPayload;
  auto_topup?: AutoTopupInfo;
}

export type AlbomToolResult<T = unknown> = AlbomSuccess<T> | AlbomError;

export interface BinaryResponseData {
  mime_type: string;
  base64: string;
  size_bytes: number;
}

export type NormalizedHttpData = unknown | string | BinaryResponseData;

export interface NormalizedHttpResponse {
  status: number;
  headers: Record<string, string>;
  data: NormalizedHttpData;
}

export interface PreparedUpload {
  fieldName: string;
  fileName: string;
  mimeType: string;
  buffer: Buffer;
  sizeBytes: number;
}
