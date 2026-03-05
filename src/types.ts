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

export interface AlbomSuccess<T = unknown> {
  ok: true;
  status: number;
  endpoint: string;
  model?: string;
  price_sats?: number;
  data: T;
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
