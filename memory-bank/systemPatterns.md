# System Patterns: MessageAI

## Architecture

```
[Expo App] 
    ↕ WebSocket (JSON)
[Cloudflare Worker] ← Entry point, routes to DOs
    ↕ Workers RPC
[Durable Object: Conversation] ← One per conversation
    ↕ SQL queries
[DO's SQLite Storage] ← Messages, read receipts
```

**Worker** also communicates with:
- **D1** - User profiles, conversation metadata
- **R2** - Media storage (post-MVP)
- **Clerk** - Auth webhook handling
- **Expo Push API** - Send notifications

## Core Messaging Patterns

### Optimistic UI Pattern
1. User sends message → Generate client-side ID
2. Write to local SQLite with status: "sending"
3. Display immediately in UI (optimistic)
4. Send via WebSocket to Worker → DO
5. DO saves, broadcasts, returns server message ID
6. Client updates local SQLite: replace client ID with server ID, status: "sent"
7. Recipients view message → send read receipt
8. DO broadcasts read receipt to all clients
9. Sender updates UI: status: "read"

### Local-First Storage Pattern
- **SQLite is source of truth for UI** (instant reads)
- **Durable Object is source of truth for sync** (persistent, consistent)
- **On reconnect**: Fetch missed messages from DO, merge into SQLite

### Real-Time Sync Pattern
- **WebSocket connection** to Worker, routed to relevant Durable Objects
- **Subscribe to conversations** on app launch
- **DO broadcasts** new messages to all connected clients
- **Clients update** local SQLite + UI on receive

### Offline Handling Pattern
- **On disconnect**: Local SQLite remains readable
- **Queued writes**: Messages marked `localOnly: true` in SQLite
- **On reconnect**: 
  1. Reconnect WebSocket
  2. Fetch missed messages from DO
  3. Send queued messages
  4. Update local SQLite with server confirmations

### Durable Objects Conversation Pattern
- **One DO per conversation** (1-on-1 or group)
- **Global uniqueness**: One conversation ID = one DO instance worldwide
- **In-memory state**: Connected WebSockets, presence status
- **Persistent state**: Messages and read receipts in DO's SQLite
- **Isolation**: Each conversation scales independently

### WebSocket Message Protocol
Simple JSON messages over WebSocket:
- `send_message` - Client sends new message
- `mark_read` - Client marks message as read
- `subscribe` - Client subscribes to conversation updates
- `get_history` - Client requests message history
- `new_message` - Server pushes new message to clients
- `message_read` - Server pushes read receipt updates
- `presence_update` - Server pushes online/offline status
- `connected` - Server confirms WebSocket connection

### State Management Pattern
- **React Query**: Server state (messages from DOs, users from D1)
- **Zustand**: App state (current user, network status, UI toggles)
- **SQLite**: Persistent local state (messages, conversations)

### Group Chat Pattern
- **Same as 1-on-1**: One DO per group conversation
- **N participants**: DO manages N WebSocket connections
- **Attribution**: Each message includes sender ID
- **Read receipts**: Track per-user, per-message in DO SQLite

## Database Best Practices

### D1 (Production - Cloudflare)
- ✅ Using prepared statements with parameter binding (SQL injection protection)
- ✅ Proper error handling with D1_ERROR catching
- ✅ Foreign key constraints enforced
- ✅ Migrations tracked in `/worker/src/db/migrations/`
- ✅ Run migrations: `wrangler d1 execute messageai-db --remote --file=<migration>`

### Durable Object SQLite
- ✅ Using `new_sqlite_classes` in migrations for SQL support
- ✅ Initialized on first request with CREATE TABLE IF NOT EXISTS
- ✅ Indexes for query performance (conversation_id, created_at)
- ✅ Type-safe with TypeScript interfaces

### Expo SQLite (Frontend)
- ✅ Using SQLiteProvider pattern (latest Expo SDK 54 approach)
- ✅ Async API with `useSQLiteContext()` hook
- ✅ Database initialized via `onInit` callback
- ✅ Type-safe queries with TypeScript
- ✅ Foreign key constraints enabled: `PRAGMA foreign_keys = ON`

## Current Implementation Status

### ✅ Working (Phase 2.0 Complete)
- User authentication (Clerk)
- Conversation creation with deterministic IDs
- WebSocket real-time connection (wss://)
- Message sending with optimistic UI
- Message persistence (both DO SQLite and local SQLite)
- Auto-reconnection with exponential backoff
- Network monitoring
- Deployed to Cloudflare Workers
- **Real-time messaging when both users have chat open**
- Status indicators (○ → ✓)
- Conversation list auto-refresh (5s polling)
- Two-person chat working end-to-end

### 🏗️ Architecture Decisions for Future Phases

**Deterministic Conversation IDs**
- Current: `conv_user1_user2` (sorted participant IDs)
- Problem: Group chats will have very long IDs
- **TODO Phase 3**: Use SHA-256 hash of sorted participant IDs
  - Example: `conv_sha256(user1,user2,user3)`
  - Consistent across all participants
  - Fixed length regardless of group size

**WebSocket Connection Pattern**
- Current: One WebSocket per conversation (only when chat screen open)
- Problem: Can't receive messages from other conversations in background
- **TODO Phase 4**: 
  - Option A: Single WebSocket for all user's conversations (subscribe pattern)
  - Option B: Keep per-conversation WS + add push notifications for background
  - **Recommended**: Option B (simpler, more scalable, standard pattern)

**Message Sync Strategy**
- Current: Full conversation list sync every 5 seconds
- Problem: Inefficient, pulls all data even if nothing changed
- **TODO Phase 4**: Delta sync architecture
  - Track `lastSyncedAt` timestamp per user/device
  - Server endpoint: `GET /api/conversations?userId=xxx&after=timestamp`
  - Returns only new/updated conversations since timestamp
  - Reduces bandwidth and database queries

**Historical Message Loading**
- Current: NOT IMPLEMENTED - new devices don't see old messages
- **TODO Phase 3**: 
  - On conversation open, fetch history from Durable Object
  - Add `GET /conversation/{id}/messages?limit=50&before=messageId`
  - Implement pagination for older messages
  - Cache in local SQLite

**Background Message Reception**
- Current: Only receive messages when chat screen is open
- **TODO Phase 4 (Push Notifications)**:
  - Expo push notifications for background messages
  - Local notification shows message preview
  - Tapping notification opens chat and loads messages
  - This is the proper mobile pattern (WhatsApp, Telegram use this)

**WebSocket URL Redundancy**
- Current: `/conversation/{id}?userId=xxx&conversationId={id}` (conversationId appears twice)
- **CLEANUP**: Remove conversationId from query params (it's already in path)
  - Path param is for routing to correct DO
  - Query param userId is for session tracking

### ⏳ Known Limitations (Deferred to Later Phases)
- No historical message loading on new devices
- No delta sync (full refresh each time)
- Messages not received in background (need push notifications)
- Deterministic IDs too long for large groups (need hashing)
- Placeholder users auto-created (need proper Clerk webhook setup)
- No user search/picker UI
- Read receipts implemented but UI not showing them clearly
- Typing indicators implemented but not tested

## AI Patterns (Phase 5.0 - RAG Complete)

### RAG Pipeline Pattern (Implemented ✅)
- **On-Demand Embedding**: Messages embedded on first AI query
- **Batched Processing**: 10 messages per batch, 100ms delay (prevents rate limiting)
- **Vectorize Storage**: bge-base-en-v1.5 embeddings (768 dimensions), cosine similarity
- **Semantic Search**: Top-5 most relevant messages retrieved
- **Hybrid Context**: RAG results + recent 10 messages passed to LLM
- **Caching**: Vectorize upsert is idempotent (subsequent queries use cached embeddings)

### AI Request Flow (RAG-Enabled)
1. User clicks "🤖 AI" button in chat header → sticky input appears
2. User types query → sends to `/api/conversations/:id/ask-ai`
3. Worker calls DO's `askAI()` RPC method
4. DO fetches all messages from conversation
5. **Embedding Phase** (batched):
   - Process messages in batches of 10
   - 100ms delay between batches to avoid rate limits
   - Generate embeddings using bge-base-en-v1.5 via AI Gateway
   - Upsert to Vectorize (idempotent - cached for future queries)
6. **Retrieval Phase**:
   - Generate embedding for user's query
   - Search Vectorize for top-5 most relevant messages
7. **Generation Phase**:
   - Build context: RAG results (top-5) + recent messages (last 10)
   - Call Llama 3.1 8B via AI Gateway
8. **Response Phase**:
   - Save AI response as message (sender: "ai-assistant")
   - Broadcast to all connected participants
   - Frontend displays as regular message

### Rate Limiting Pattern (AI Gateway)
- **AI Gateway Handles It**: aw-cf-ai gateway manages rate limiting
- **Removed Local Logic**: No in-memory cache needed
- **Batching Strategy**: Prevents hitting gateway limits
  - 10 messages per batch
  - 100ms delay between batches
  - Successfully handles 100+ message conversations

### Error Handling Pattern
- **Validation Errors**: 400 Bad Request (invalid JSON, empty query, too long)
- **Rate Limit**: 429 Too Many Requests
- **AI Errors**: 503 Service Unavailable (timeout, AI service down)
- **Unknown Errors**: 500 Internal Server Error
- **Graceful Degradation**: Continue without history if fetch fails

### AI Gateway Pattern (Implemented ✅)
- **Gateway ID**: aw-cf-ai (hardcoded in call arguments)
- **Configuration**: Passed to AI.run() via gateway parameter
- **Metadata Tracking**: Each request tagged with conversationId, userId, operation type
- **Benefits**: 
  - Automatic rate limiting
  - Response caching
  - Cost tracking and analytics
  - No local rate limiting code needed

### Agent Pattern (Future)
- **Proactive Assistant**: Monitors messages, detects patterns (scheduling discussions)
- **Function calling**: LLM calls tools (extract action items, search conversations)
- **Workflows**: Long-running tasks don't block Workers

*Phase 6+ will add: Thread Summarization, Action Items, Priority Detection, Decision Tracking, Smart Search*
