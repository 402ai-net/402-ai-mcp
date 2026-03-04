# WORKLOG

Development history and feature changes for 402ai-mcp.

## 2026-02-24

### Documentation
- Created comprehensive README.md with full feature documentation
- Documented compact and full tool profiles
- Added configuration reference and environment variables
- Included usage examples for Claude Desktop and programmatic use
- Created WORKLOG.md for tracking changes

### Initial Implementation (v1.0.0)
- Built MCP server implementing spec revision 2025-11-25
- Created catalog synchronization system with TTL-based caching
- Implemented two tool profiles: compact (9 tools) and full (11+ tools)
- Added bearer token authentication support
- Built dynamic tool refresh with `tools/list_changed` notifications

## Features Implemented

### Core Architecture
- **TypeScript Native**: Full TypeScript implementation with strict typing
- **MCP SDK Integration**: Built on `@modelcontextprotocol/sdk` v1.27.0
- **Zod Validation**: Schema validation for configuration and payloads
- **stdio Transport**: Standard MCP stdio transport support

### Tool Profiles

#### Compact Profile
- `albom_catalog_get` - Fetch API catalog
- `albom_text_generate` - Text completions (via `/v1/responses`)
- `albom_image_generate` - Image generation
- `albom_image_edit` - Image editing
- `albom_audio_transcribe` - Audio transcription (with translation mode)
- `albom_audio_speech` - Text-to-speech
- `albom_video_generate` - Video generation (optional)
- `albom_safety_moderate` - Content moderation (optional)
- `albom_embedding_create` - Embeddings (optional)

#### Full Profile
- One tool per catalog endpoint (11 total)
- `albom_catalog_get` - Catalog access
- `albom_raw_call` - Raw API calls (when enabled)

### Catalog Management
- Auto-fetches `/api/catalog` on startup
- TTL-based caching (default 5 minutes)
- Change detection via catalog comparison
- Automatic client notification on catalog updates
- Endpoint deduplication using Jaccard similarity

### HTTP Client
- Retry logic with exponential backoff (max 2 retries)
- Bearer token authentication
- Multipart form-data support (file paths and base64)
- Timeout handling (default 90 seconds)
- Error normalization for MCP format
- Max upload size enforcement (default 25 MB)

### Error Handling
- `402 Payment Required` → Returns payment details
- `400 Bad Request` → Returns validation errors
- `429 Rate Limited` → Returns retry-after info
- `5xx Server Error` → Returns error message
- Network errors → Automatic retry with backoff

### Testing Infrastructure
- Vitest test framework
- Catalog validation tests
- Model set deduplication tests (Jaccard)
- HTTP error normalization tests
- Multipart upload encoding tests
- Tool list change detection tests
- Bearer token authentication tests

### Configuration
- 11 environment variables for customization
- Profile selection (compact/full)
- Optional tool inclusion (moderation, embeddings, video)
- Configurable timeouts and retry behavior
- Max upload size configuration

### Development Tools
- TypeScript compilation with strict mode
- Watch mode for development
- Smoke tests for live API validation
- NPM package preparation scripts
- Pre-publish test hooks

## Design Decisions

### Why Compact Profile?
- Reduces tool ambiguity for AI agents
- Consolidates overlapping endpoints (`chat/completions` vs `responses`)
- Semantic tool names over technical endpoint paths
- Optional inclusion of rarely-used tools (moderation, embeddings)

### Why Full Profile?
- Comprehensive endpoint coverage
- Power users who need specific endpoints
- 1:1 mapping to catalog for transparency
- Raw call tool for experimental access

### Why Bearer-First Auth?
- Prepaid topup mode is production-ready
- Avoids unnecessary invoice creation
- Better UX for repeated calls
- Falls back to L402 if no token provided

---

**Note**: Update this log whenever you add features, fix bugs, or make significant changes.
