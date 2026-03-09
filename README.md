# 402ai-mcp

MCP (Model Context Protocol) server for [402ai.net](https://402ai.net) - a Lightning-paid API proxy. Provides catalog-aware tools with compact/full profiles, bearer-first authentication, and dynamic tool refresh notifications.

**Please update me when there are feature changes.**

## Features

- **Two Tool Profiles**: Compact (optimized for agents) or Full (comprehensive endpoint coverage)
- **Catalog Synchronization**: Auto-fetches and tracks API catalog changes
- **Bearer Token Auth**: First-class support for prepaid balance tokens
- **Dynamic Tool Updates**: Notifies clients when catalog changes via MCP notifications
- **Smart Consolidation**: Compact profile merges overlapping endpoints to reduce tool clutter
- **TypeScript Native**: Full TypeScript implementation with type safety
- **Comprehensive Testing**: Unit tests for catalog validation, deduplication, HTTP handling, and multipart uploads

## Quick Start

### Installation

```bash
npm install
npm run build
npm test
```

### Run via stdio

```bash
ALBOM_BEARER_TOKEN=<your_token> npm start
```

### NPM Package

```bash
npm install 402ai-mcp
```

## Configuration

Configure via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `ALBOM_BASE_URL` | `https://402ai.net` | API base URL |
| `ALBOM_BEARER_TOKEN` | _(none)_ | Prepaid balance token (strongly recommended) |
| `ALBOM_NWC_URI` | _(none)_ | Client-side NWC connection URI used to auto-pay topup invoices locally |
| `ALBOM_NWC_THRESHOLD_SATS` | `1000` | Trigger auto-topup when API responses report balance below this threshold |
| `ALBOM_NWC_TOPUP_USD` | `2.00` | USD amount to add for each automatic topup |
| `ALBOM_NWC_MAX_DAILY` | `10.00` | Max USD the MCP client will auto-top up over a rolling 24h window |
| `ALBOM_TOOL_PROFILE` | `compact` | Tool profile: `compact` or `full` |
| `ALBOM_INCLUDE_MODERATION` | `false` (compact), `true` (full) | Include moderation tools |
| `ALBOM_INCLUDE_EMBEDDINGS` | `false` (compact), `true` (full) | Include embedding tools |
| `ALBOM_INCLUDE_VIDEO` | `true` | Include video generation tools |
| `ALBOM_ALLOW_RAW_TOOL` | `false` | Expose `albom_raw_call` tool (full profile only) |
| `ALBOM_CATALOG_TTL_MS` | `300000` (5 min) | Catalog cache TTL |
| `ALBOM_HTTP_TIMEOUT_MS` | `90000` (90 sec) | HTTP request timeout |
| `ALBOM_MAX_RETRIES` | `2` | Max retry attempts for failed requests |
| `ALBOM_MAX_UPLOAD_BYTES` | `26214400` (25 MB) | Max upload file size |

## Tool Profiles

### Compact Profile (Default)

Optimized for AI agents with minimal tool ambiguity. Consolidates overlapping endpoints into semantic tools:

| Tool | Purpose | Maps to Endpoint |
|------|---------|------------------|
| `albom_catalog_get` | Get live API catalog | `/api/v1/catalog` |
| `albom_text_generate` | Generate text completions | `/v1/responses` |
| `albom_image_generate` | Generate images | `/v1/images/generations` |
| `albom_image_edit` | Edit images | `/v1/images/edits` |
| `albom_audio_transcribe` | Transcribe audio (with optional translation) | `/v1/audio/transcriptions` (+ `/translations`) |
| `albom_audio_speech` | Generate speech | `/v1/audio/speech` |
| `albom_video_generate` | Generate videos (if enabled) | `/v1/video/generations` |
| `albom_safety_moderate` | Content moderation (if enabled) | `/v1/moderations` |
| `albom_embedding_create` | Create embeddings (if enabled) | `/v1/embeddings` |

**Consolidations**:
- Hides `/v1/chat/completions` in favor of `/v1/responses` (identical model sets)
- Folds `/v1/audio/translations` into `albom_audio_transcribe` via boolean flag

### Full Profile

One tool per catalog endpoint for comprehensive coverage:

- `albom_openai_chat_completions`
- `albom_openai_responses`
- `albom_openai_images_generations`
- `albom_openai_images_edits`
- `albom_openai_images_variations`
- `albom_openai_audio_speech`
- `albom_openai_audio_transcriptions`
- `albom_openai_audio_translations`
- `albom_openai_embeddings`
- `albom_openai_moderations`
- `albom_openai_video_generations`
- `albom_catalog_get`
- `albom_raw_call` (if `ALBOM_ALLOW_RAW_TOOL=true`)

## Authentication

### Bearer Token (Recommended)

Set `ALBOM_BEARER_TOKEN` to your prepaid balance token. All requests will use `Authorization: Bearer <token>`.

**Get a token**:
```bash
# 1. Create topup invoice
curl -X POST https://402ai.net/api/v1/topup \
  -H "Content-Type: application/json" \
  -d '{"amount_sats":1000}'

# 2. Pay invoice with Lightning wallet, then claim
curl -X POST https://402ai.net/api/v1/topup/claim \
  -H "Content-Type: application/json" \
  -d '{"preimage":"<hex-preimage>"}'
```

### NWC Auto-Topup

Set `ALBOM_NWC_URI` to a `nostr+walletconnect://...` URI to let the MCP client auto-pay topup invoices locally. The NWC secret stays in the MCP client process and is never sent to the 402ai server.

When a tool response includes `balance_sats` or `available_sats` below `ALBOM_NWC_THRESHOLD_SATS`, the MCP client will:

1. `POST /api/v1/topup` with `{"amount_usd": ALBOM_NWC_TOPUP_USD}`
2. Pay the returned invoice over NWC with `pay_invoice`
3. `POST /api/v1/topup/claim` with the returned preimage
4. Update the in-memory bearer token if the claim returns a newer token

Notes:

- Auto-topup is client-side only. The NWC URI never touches the 402ai server.
- `ALBOM_NWC_MAX_DAILY` is a rolling 24-hour USD spend cap for automatic topups.
- Auto-topup does not bootstrap a brand new account by itself. Start with a valid `ALBOM_BEARER_TOKEN`, then NWC can keep that balance funded.

### No Token (L402 Flow)

Without a token, calls will return `402 Payment Required` with a Lightning invoice. The MCP server will surface this as an error with payment details.

## Usage Examples

### With Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "402ai": {
      "command": "node",
      "args": ["/path/to/402ai-mcp/dist/server.js"],
      "env": {
        "ALBOM_BEARER_TOKEN": "abl_your_token_here",
        "ALBOM_NWC_URI": "nostr+walletconnect://...",
        "ALBOM_NWC_THRESHOLD_SATS": "1000",
        "ALBOM_NWC_TOPUP_USD": "2.00",
        "ALBOM_NWC_MAX_DAILY": "10.00",
        "ALBOM_TOOL_PROFILE": "compact"
      }
    }
  }
}
```

### Programmatic Usage

```typescript
import { createAlbomServer } from '402ai-mcp';

const server = createAlbomServer({
  baseUrl: 'https://402ai.net',
  bearerToken: process.env.ALBOM_BEARER_TOKEN,
  toolProfile: 'compact'
});

// Start server
await server.run();
```

## Development

### Build

```bash
npm run build
```

## Documentation Discipline

Keep `ARCHITECTURE.md` and `WORKLOG.md` accurate when tool behavior, transport assumptions, auth flows, or deployment expectations change.

### Test

```bash
npm test              # Run all tests
npm run test:watch    # Watch mode
```

### Dev Server

```bash
npm run dev           # Watch and rebuild
npm run start:dev     # Run without build
```

### Smoke Test (Live API)

```bash
ALBOM_BEARER_TOKEN=<token> npm run smoke:live
```

## Architecture

### Core Modules

- **`catalog.ts`**: Fetches and validates `/api/v1/catalog`, detects changes
- **`config.ts`**: Environment variable configuration and validation
- **`dedup.ts`**: Model set deduplication logic (Jaccard similarity)
- **`httpClient.ts`**: HTTP client with retry logic, multipart support, bearer auth
- **`tools/`**: Tool implementations for compact and full profiles
- **`results.ts`**: Response normalization and error handling
- **`uploads.ts`**: File upload handling (path and base64)
- **`server.ts`**: MCP server implementation

### Catalog Sync

1. Fetches `/api/v1/catalog` on startup
2. Caches for `ALBOM_CATALOG_TTL_MS`
3. Periodically refreshes and compares
4. Sends `notifications/tools/list_changed` if catalog changes
5. Clients re-fetch tool definitions

### Error Handling

HTTP errors are normalized to MCP-friendly format:

- `402 Payment Required`: Returns payment details (invoice, amount, expires_in)
- `400 Bad Request`: Returns validation errors
- `429 Rate Limited`: Returns retry-after info
- `5xx Server Error`: Returns error message
- Network errors: Automatic retry with exponential backoff

## Testing

Test suite covers:

- Catalog validation and normalization
- Model set deduplication (Jaccard similarity)
- HTTP error normalization
- Multipart upload encoding (path + base64)
- Tool list change detection
- Bearer token authentication
- Retry logic

Run tests:
```bash
npm test
```

## Publishing

```bash
# 1. Build and test
npm run build
npm test

# 2. Check package contents
npm pack --dry-run

# 3. Publish
npm login
npm version patch  # or minor/major
npm publish --access public
```

## Project Structure

```
.
├── src/
│   ├── catalog.ts         # Catalog fetching and tracking
│   ├── config.ts          # Environment configuration
│   ├── dedup.ts           # Model set deduplication
│   ├── httpClient.ts      # HTTP client with retries
│   ├── server.ts          # MCP server implementation
│   ├── tools/             # Tool implementations
│   │   ├── compact.ts     # Compact profile tools
│   │   ├── full.ts        # Full profile tools
│   │   └── shared.ts      # Shared tool utilities
│   ├── results.ts         # Response normalization
│   ├── uploads.ts         # File upload handling
│   ├── types.ts           # TypeScript types
│   └── index.ts           # Public exports
├── test/                  # Test suite
├── scripts/               # Utility scripts
├── dist/                  # Compiled output
└── 402AI_MCP_IMPLEMENTATION_SPEC.md  # Design spec

Documentation:
└── 402AI_MCP_IMPLEMENTATION_SPEC.md
```

## MCP Specification

This server implements [MCP spec revision 2025-11-25](https://modelcontextprotocol.io/specification).

Supported features:
- Tools capability
- Notifications capability (`tools/list_changed`)
- Tool annotations (`title`, `readOnlyHint`, `idempotentHint`)
- stdio transport

## License

MIT - See LICENSE file.

## Contributing

See WORKLOG.md for recent changes and development history.
