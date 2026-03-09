import { z } from "zod";
import type { ToolAnnotations } from "../types.js";
import type { PlannedTool } from "../types.js";
import { summarizeResult } from "../results.js";
import type { AlbomToolExecutor } from "./executor.js";

export interface RegisteredToolHandle {
  remove: () => void;
}

export interface ToolServerLike {
  registerTool: (
    name: string,
    config: {
      title?: string;
      description?: string;
      inputSchema?: z.ZodRawShape;
      annotations?: ToolAnnotations;
    },
    cb: (args: unknown) => Promise<{
      structuredContent: Record<string, unknown>;
      content: Array<{ type: "text"; text: string }>;
      isError?: boolean;
    }>
  ) => RegisteredToolHandle;
  sendToolListChanged: () => void;
  isConnected: () => boolean;
}

const anyRecordSchema = z.record(z.string(), z.unknown());

function toolInputSchema(tool: PlannedTool): z.ZodRawShape {
  switch (tool.kind) {
    case "catalog_get":
      return {
        refresh: z.boolean().optional().describe("If true, force a fresh catalog pull before returning")
      };

    case "marketplace_get_my_account":
      return {};

    case "marketplace_list_tasks":
      return {
        status: z.enum(["open", "in_escrow", "delivered", "completed", "cancelled"]).optional()
      };

    case "marketplace_get_task":
      return {
        task_id: z.string()
      };

    case "marketplace_post_task":
      return {
        title: z.string(),
        description: z.string().optional(),
        budget_sats: z.number().int().positive()
      };

    case "marketplace_quote_task":
      return {
        task_id: z.string(),
        price_sats: z.number().int().positive(),
        description: z.string().optional()
      };

    case "marketplace_update_quote":
      return {
        task_id: z.string(),
        quote_id: z.string(),
        price_sats: z.number().int().positive().optional(),
        description: z.string().optional()
      };

    case "marketplace_accept_quote":
      return {
        task_id: z.string(),
        quote_id: z.string()
      };

    case "marketplace_list_quote_messages":
      return {
        task_id: z.string(),
        quote_id: z.string(),
        since_id: z.number().int().nonnegative().optional()
      };

    case "marketplace_send_quote_message":
      return {
        task_id: z.string(),
        quote_id: z.string(),
        body: z.string()
      };

    case "marketplace_submit_result":
      return {
        task_id: z.string(),
        filename: z.string().optional(),
        content_base64: z.string().optional(),
        notes: z.string().optional()
      };

    case "marketplace_confirm_delivery":
      return {
        task_id: z.string()
      };

    case "marketplace_list_workers":
      return {
        include_inactive: z.boolean().optional()
      };

    case "marketplace_get_worker_profile":
      return {
        account_id: z.string()
      };

    case "marketplace_upsert_profile":
      return {
        display_name: z.string(),
        actor_type: z.enum(["agent", "human", "hybrid"]).optional(),
        headline: z.string().optional(),
        capabilities: z.array(z.string()).optional(),
        delivery_types: z.array(z.string()).optional(),
        sample_artifacts: z.array(z.record(z.string(), z.unknown())).optional(),
        active: z.boolean().optional()
      };

    case "marketplace_review_task":
      return {
        task_id: z.string(),
        rating: z.number().int().min(1).max(5),
        review: z.string().optional()
      };

    case "text_generate":
      return {
        model: z.string().describe("Model name"),
        input: z.union([z.string(), z.array(z.unknown())]).describe("Text or structured input"),
        instructions: z.string().optional(),
        max_output_tokens: z.number().int().positive().optional(),
        temperature: z.number().min(0).max(2).optional(),
        extra: anyRecordSchema.optional(),
        allow_l402_quote: z.boolean().optional()
      };

    case "image_generate":
      return {
        model: z.string(),
        prompt: z.string(),
        size: z.string().optional(),
        quality: z.string().optional(),
        style: z.string().optional(),
        allow_l402_quote: z.boolean().optional()
      };

    case "image_edit":
      return {
        model: z.string(),
        prompt: z.string(),
        image_file_path: z.string().optional(),
        image_file_base64: z.string().optional(),
        image_file_name: z.string().optional(),
        image_mime_type: z.string().optional(),
        mask_file_path: z.string().optional(),
        mask_file_base64: z.string().optional(),
        mask_file_name: z.string().optional(),
        mask_mime_type: z.string().optional(),
        size: z.string().optional(),
        allow_l402_quote: z.boolean().optional()
      };

    case "audio_transcribe":
      return {
        model: z.string().optional(),
        audio_file_path: z.string().optional(),
        audio_file_base64: z.string().optional(),
        audio_file_name: z.string().optional(),
        audio_mime_type: z.string().optional(),
        translate_to_english: z.boolean().optional(),
        prompt: z.string().optional(),
        language: z.string().optional(),
        response_format: z.string().optional(),
        temperature: z.number().min(0).max(2).optional(),
        allow_l402_quote: z.boolean().optional()
      };

    case "audio_speech":
      return {
        model: z.string(),
        voice: z.string(),
        input: z.string(),
        format: z.string().optional(),
        speed: z.number().positive().optional(),
        allow_l402_quote: z.boolean().optional()
      };

    case "video_generate":
      return {
        model: z.string(),
        prompt: z.string(),
        duration: z.number().int().positive().optional(),
        size: z.string().optional(),
        allow_l402_quote: z.boolean().optional()
      };

    case "safety_moderate":
      return {
        model: z.string().optional(),
        input: z.union([z.string(), z.array(z.unknown())]),
        allow_l402_quote: z.boolean().optional()
      };

    case "embedding_create":
      return {
        model: z.string().optional(),
        input: z.union([z.string(), z.array(z.unknown())]),
        allow_l402_quote: z.boolean().optional()
      };

    case "full_endpoint":
      if (tool.contentType === "json") {
        return {
          model: z.string().optional(),
          body: anyRecordSchema.optional(),
          allow_l402_quote: z.boolean().optional()
        };
      }

      return {
        model: z.string().optional(),
        fields: anyRecordSchema.optional(),
        file_path: z.string().optional(),
        file_base64: z.string().optional(),
        file_name: z.string().optional(),
        mime_type: z.string().optional(),
        file_field: z.string().optional(),
        allow_l402_quote: z.boolean().optional()
      };

    case "raw_call":
      return {
        endpoint: z.string().describe("Catalog endpoint path, e.g. /v1/responses"),
        content_type: z.enum(["json", "multipart"]).optional(),
        model: z.string().optional(),
        body: anyRecordSchema.optional(),
        fields: anyRecordSchema.optional(),
        file_path: z.string().optional(),
        file_base64: z.string().optional(),
        file_name: z.string().optional(),
        mime_type: z.string().optional(),
        file_field: z.string().optional(),
        allow_l402_quote: z.boolean().optional()
      };

    default:
      return {};
  }
}

export function registerPlannedTool(
  server: ToolServerLike,
  tool: PlannedTool,
  executor: AlbomToolExecutor
): RegisteredToolHandle {
  return server.registerTool(
    tool.name,
    {
      title: tool.title,
      description: tool.description,
      inputSchema: toolInputSchema(tool),
      annotations: tool.annotations
    },
    async (args) => {
      const result = await executor.execute(tool, args);

      return {
        structuredContent: result as unknown as Record<string, unknown>,
        content: [
          {
            type: "text",
            text: summarizeResult(result)
          }
        ],
        isError: !result.ok
      };
    }
  );
}
