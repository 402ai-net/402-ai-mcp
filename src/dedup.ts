import type { AlbomConfig } from "./config.js";
import type {
  CatalogState,
  EndpointDescriptor,
  PlannedTool,
  ToolState,
  ToolProfile,
  ToolAnnotations
} from "./types.js";
import { modelSetJaccard, sanitizeToolName, sha256Hex, stableStringify } from "./utils.js";

const TEXT_ENDPOINTS = ["/v1/responses", "/v1/chat/completions"] as const;

const READ_ONLY_ANNOTATION: ToolAnnotations = {
  readOnlyHint: true,
  idempotentHint: true,
  destructiveHint: false,
  openWorldHint: false
};

const DEFAULT_ANNOTATION: ToolAnnotations = {
  destructiveHint: false,
  openWorldHint: true
};

const MARKETPLACE_READ_ANNOTATION: ToolAnnotations = {
  readOnlyHint: true,
  idempotentHint: true,
  destructiveHint: false,
  openWorldHint: true
};

function marketplaceTools(): PlannedTool[] {
  return [
    {
      kind: "marketplace_get_my_account",
      name: "albom_marketplace_get_my_account",
      title: "Marketplace Account",
      description: "Get your AI-for-Hire marketplace account balance and account_id.",
      endpointPath: "/api/v1/ai-for-hire/me",
      annotations: MARKETPLACE_READ_ANNOTATION
    },
    {
      kind: "marketplace_list_tasks",
      name: "albom_marketplace_list_tasks",
      title: "Marketplace List Tasks",
      description: "List marketplace tasks. Optionally filter by status.",
      endpointPath: "/api/v1/ai-for-hire/tasks",
      annotations: MARKETPLACE_READ_ANNOTATION
    },
    {
      kind: "marketplace_get_task",
      name: "albom_marketplace_get_task",
      title: "Marketplace Get Task",
      description: "Get marketplace task detail, including quotes and deliveries.",
      endpointPath: "/api/v1/ai-for-hire/tasks/{task_id}",
      annotations: MARKETPLACE_READ_ANNOTATION
    },
    {
      kind: "marketplace_post_task",
      name: "albom_marketplace_post_task",
      title: "Marketplace Post Task",
      description: "Post a new marketplace task with title, description, and budget in sats.",
      endpointPath: "/api/v1/ai-for-hire/tasks",
      annotations: DEFAULT_ANNOTATION
    },
    {
      kind: "marketplace_quote_task",
      name: "albom_marketplace_quote_task",
      title: "Marketplace Quote Task",
      description: "Submit a quote on a marketplace task.",
      endpointPath: "/api/v1/ai-for-hire/tasks/{task_id}/quotes",
      annotations: DEFAULT_ANNOTATION
    },
    {
      kind: "marketplace_update_quote",
      name: "albom_marketplace_update_quote",
      title: "Marketplace Update Quote",
      description: "Update your pending quote price or description.",
      endpointPath: "/api/v1/ai-for-hire/tasks/{task_id}/quotes/{quote_id}",
      annotations: DEFAULT_ANNOTATION
    },
    {
      kind: "marketplace_accept_quote",
      name: "albom_marketplace_accept_quote",
      title: "Marketplace Accept Quote",
      description: "Accept a quote and lock escrow for the task.",
      endpointPath: "/api/v1/ai-for-hire/tasks/{task_id}/quotes/{quote_id}/accept",
      annotations: DEFAULT_ANNOTATION
    },
    {
      kind: "marketplace_list_quote_messages",
      name: "albom_marketplace_list_quote_messages",
      title: "Marketplace List Quote Messages",
      description: "Read messages on a quote thread you participate in.",
      endpointPath: "/api/v1/ai-for-hire/tasks/{task_id}/quotes/{quote_id}/messages",
      annotations: MARKETPLACE_READ_ANNOTATION
    },
    {
      kind: "marketplace_send_quote_message",
      name: "albom_marketplace_send_quote_message",
      title: "Marketplace Send Quote Message",
      description: "Send a message on a quote thread.",
      endpointPath: "/api/v1/ai-for-hire/tasks/{task_id}/quotes/{quote_id}/messages",
      annotations: DEFAULT_ANNOTATION
    },
    {
      kind: "marketplace_submit_result",
      name: "albom_marketplace_submit_result",
      title: "Marketplace Submit Result",
      description: "Deliver task output for an accepted quote.",
      endpointPath: "/api/v1/ai-for-hire/tasks/{task_id}/deliver",
      annotations: DEFAULT_ANNOTATION
    },
    {
      kind: "marketplace_confirm_delivery",
      name: "albom_marketplace_confirm_delivery",
      title: "Marketplace Confirm Delivery",
      description: "Confirm delivery and release escrow to the worker.",
      endpointPath: "/api/v1/ai-for-hire/tasks/{task_id}/confirm",
      annotations: DEFAULT_ANNOTATION
    },
    {
      kind: "marketplace_list_workers",
      name: "albom_marketplace_list_workers",
      title: "Marketplace List Workers",
      description: "List public worker profiles and reputation summaries.",
      endpointPath: "/api/v1/ai-for-hire/workers",
      annotations: MARKETPLACE_READ_ANNOTATION
    },
    {
      kind: "marketplace_get_worker_profile",
      name: "albom_marketplace_get_worker_profile",
      title: "Marketplace Get Worker Profile",
      description: "Get a worker profile and reputation summary by account_id.",
      endpointPath: "/api/v1/ai-for-hire/workers/{account_id}",
      annotations: MARKETPLACE_READ_ANNOTATION
    },
    {
      kind: "marketplace_upsert_profile",
      name: "albom_marketplace_upsert_profile",
      title: "Marketplace Upsert Profile",
      description: "Create or update your worker profile.",
      endpointPath: "/api/v1/ai-for-hire/me/profile",
      annotations: DEFAULT_ANNOTATION
    },
    {
      kind: "marketplace_review_task",
      name: "albom_marketplace_review_task",
      title: "Marketplace Review Task",
      description: "Review completed work with a 1-5 rating and optional review text.",
      endpointPath: "/api/v1/ai-for-hire/tasks/{task_id}/review",
      annotations: DEFAULT_ANNOTATION
    }
  ];
}

function isTextPath(path: string): boolean {
  return path === "/v1/responses" || path.startsWith("/v1/chat/");
}

export function isDuplicateCandidate(a: EndpointDescriptor, b: EndpointDescriptor): boolean {
  const sameMethod = a.method === b.method;
  const sameContentType = a.contentType === b.contentType;
  const jaccard = modelSetJaccard(a.models, b.models);

  const sameFamily =
    a.family === b.family ||
    (isTextPath(a.path) && isTextPath(b.path));

  return sameMethod && sameContentType && sameFamily && jaccard >= 0.95;
}

function endpointByPath(catalog: CatalogState, path: string): EndpointDescriptor | undefined {
  return catalog.endpoints.find((endpoint) => endpoint.path === path && endpoint.method === "POST");
}

function chooseCompactTextEndpoint(catalog: CatalogState): EndpointDescriptor | undefined {
  const responses = endpointByPath(catalog, "/v1/responses");
  const chat = endpointByPath(catalog, "/v1/chat/completions");

  if (!responses) {
    return chat;
  }

  if (!chat) {
    return responses;
  }

  if (isDuplicateCandidate(chat, responses)) {
    return responses;
  }

  // Compact profile intentionally keeps the responses surface canonical.
  return responses;
}

function makeCompactTools(catalog: CatalogState, config: AlbomConfig): PlannedTool[] {
  const tools: PlannedTool[] = [
    {
      kind: "catalog_get",
      name: "albom_catalog_get",
      title: "Get ALBOM Catalog",
      description: "Get normalized ALBOM catalog data and derived tool summary.",
      annotations: READ_ONLY_ANNOTATION
    }
  ];

  const textEndpoint = chooseCompactTextEndpoint(catalog);
  if (textEndpoint) {
    tools.push({
      kind: "text_generate",
      name: "albom_text_generate",
      title: "Text Generation",
      description: `Generate text responses via ${textEndpoint.path}.`,
      endpointPath: textEndpoint.path,
      annotations: DEFAULT_ANNOTATION
    });
  }

  const imageGenerate = endpointByPath(catalog, "/v1/images/generations");
  if (imageGenerate) {
    tools.push({
      kind: "image_generate",
      name: "albom_image_generate",
      title: "Image Generation",
      description: "Generate new images from text prompts.",
      endpointPath: imageGenerate.path,
      annotations: DEFAULT_ANNOTATION
    });
  }

  const imageEdit = endpointByPath(catalog, "/v1/images/edits");
  if (imageEdit) {
    tools.push({
      kind: "image_edit",
      name: "albom_image_edit",
      title: "Image Edit",
      description: "Edit an input image with prompt instructions.",
      endpointPath: imageEdit.path,
      annotations: DEFAULT_ANNOTATION
    });
  }

  const audioTranscribe = endpointByPath(catalog, "/v1/audio/transcriptions");
  if (audioTranscribe) {
    tools.push({
      kind: "audio_transcribe",
      name: "albom_audio_transcribe",
      title: "Audio Transcribe",
      description: "Transcribe audio. Set translate_to_english=true to route to translation.",
      endpointPath: audioTranscribe.path,
      translationEndpointPath: endpointByPath(catalog, "/v1/audio/translations")?.path,
      annotations: DEFAULT_ANNOTATION
    });
  }

  const audioSpeech = endpointByPath(catalog, "/v1/audio/speech");
  if (audioSpeech) {
    tools.push({
      kind: "audio_speech",
      name: "albom_audio_speech",
      title: "Audio Speech",
      description: "Synthesize speech from text input.",
      endpointPath: audioSpeech.path,
      annotations: DEFAULT_ANNOTATION
    });
  }

  if (config.includeVideo) {
    const videoGenerate = endpointByPath(catalog, "/v1/video/generations");
    if (videoGenerate) {
      tools.push({
        kind: "video_generate",
        name: "albom_video_generate",
        title: "Video Generation",
        description: "Generate videos from text prompts. This endpoint can be expensive.",
        endpointPath: videoGenerate.path,
        annotations: {
          ...DEFAULT_ANNOTATION,
          idempotentHint: false
        }
      });
    }
  }

  if (config.includeModeration) {
    const moderation = endpointByPath(catalog, "/v1/moderations");
    if (moderation) {
      tools.push({
        kind: "safety_moderate",
        name: "albom_safety_moderate",
        title: "Safety Moderate",
        description: "Classify text content with moderation models.",
        endpointPath: moderation.path,
        annotations: READ_ONLY_ANNOTATION
      });
    }
  }

  if (config.includeEmbeddings) {
    const embeddings = endpointByPath(catalog, "/v1/embeddings");
    if (embeddings) {
      tools.push({
        kind: "embedding_create",
        name: "albom_embedding_create",
        title: "Embedding Create",
        description: "Generate embeddings for text input.",
        endpointPath: embeddings.path,
        annotations: READ_ONLY_ANNOTATION
      });
    }
  }

  if (config.allowRawTool) {
    tools.push({
      kind: "raw_call",
      name: "albom_raw_call",
      title: "Raw ALBOM Call",
      description: "Raw allowlisted endpoint caller for advanced use only.",
      annotations: DEFAULT_ANNOTATION
    });
  }

  return tools;
}

function shouldIncludeFullEndpoint(endpoint: EndpointDescriptor, config: AlbomConfig): boolean {
  if (!config.includeVideo && endpoint.path === "/v1/video/generations") {
    return false;
  }
  if (!config.includeModeration && endpoint.path === "/v1/moderations") {
    return false;
  }
  if (!config.includeEmbeddings && endpoint.path === "/v1/embeddings") {
    return false;
  }

  return true;
}

function fullToolName(profileApi: string, endpointPath: string): string {
  const segments = endpointPath
    .split("/")
    .filter(Boolean)
    .filter((segment) => segment !== "v1");

  return sanitizeToolName(["albom", profileApi, ...segments].join("_"));
}

function makeFullTools(catalog: CatalogState, config: AlbomConfig): PlannedTool[] {
  const tools: PlannedTool[] = [
    {
      kind: "catalog_get",
      name: "albom_catalog_get",
      title: "Get ALBOM Catalog",
      description: "Get normalized ALBOM catalog data and derived tool summary.",
      annotations: READ_ONLY_ANNOTATION
    }
  ];

  const usedNames = new Set<string>(tools.map((tool) => tool.name));

  for (const endpoint of catalog.endpoints) {
    if (endpoint.method !== "POST") {
      continue;
    }

    if (!shouldIncludeFullEndpoint(endpoint, config)) {
      continue;
    }

    let name = fullToolName(endpoint.apiKey, endpoint.path);
    if (usedNames.has(name)) {
      name = sanitizeToolName(`${name}_${endpoint.method.toLowerCase()}`);
    }

    usedNames.add(name);

    tools.push({
      kind: "full_endpoint",
      name,
      title: `${endpoint.apiName} ${endpoint.path}`,
      description: endpoint.description,
      endpointPath: endpoint.path,
      contentType: endpoint.contentType,
      fileField: endpoint.fileField,
      annotations: DEFAULT_ANNOTATION
    });
  }

  if (config.allowRawTool) {
    tools.push({
      kind: "raw_call",
      name: "albom_raw_call",
      title: "Raw ALBOM Call",
      description: "Raw allowlisted endpoint caller for advanced use only.",
      annotations: DEFAULT_ANNOTATION
    });
  }

  return tools;
}

function buildToolSignature(profile: ToolProfile, tools: PlannedTool[]): string {
  return sha256Hex(
    stableStringify({
      profile,
      tools: tools.map((tool) => ({
        kind: tool.kind,
        name: tool.name,
        endpointPath: "endpointPath" in tool ? tool.endpointPath : undefined,
        translationEndpointPath:
          tool.kind === "audio_transcribe" ? tool.translationEndpointPath : undefined,
        contentType: tool.kind === "full_endpoint" ? tool.contentType : undefined
      }))
    })
  );
}

export function buildToolState(catalog: CatalogState, config: AlbomConfig): ToolState {
  const generatedTools = config.toolProfile === "compact" ? makeCompactTools(catalog, config) : makeFullTools(catalog, config);
  const tools = [...generatedTools, ...marketplaceTools()];

  return {
    profile: config.toolProfile,
    tools,
    signature: buildToolSignature(config.toolProfile, tools)
  };
}

export function endpointByPathFromCatalog(catalog: CatalogState, path: string): EndpointDescriptor | undefined {
  return endpointByPath(catalog, path);
}

export function textEndpointCandidates(catalog: CatalogState): EndpointDescriptor[] {
  return TEXT_ENDPOINTS.map((path) => endpointByPath(catalog, path)).filter(
    (endpoint): endpoint is EndpointDescriptor => endpoint !== undefined
  );
}
