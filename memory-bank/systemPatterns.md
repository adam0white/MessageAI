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

### State Management Pattern
- **React Query**: Server state (messages from DOs, users from D1)
- **Zustand**: App state (current user, network status, UI toggles)
- **SQLite**: Persistent local state (messages, conversations)

### Group Chat Pattern
- **Same as 1-on-1**: One DO per group conversation
- **N participants**: DO manages N WebSocket connections
- **Attribution**: Each message includes sender ID
- **Read receipts**: Track per-user, per-message in DO SQLite

## AI Patterns (Post-MVP)

### RAG Pipeline Pattern
- **Vectorize**: Store message embeddings
- **Semantic search**: Query relevant messages before LLM call
- **Context window**: Pass retrieved messages to LLM

### Agent Pattern
- **Proactive Assistant**: Monitors messages, detects patterns (scheduling discussions)
- **Function calling**: LLM calls tools (extract action items, search conversations)
- **Workflows**: Long-running tasks don't block Workers

### Caching Pattern
- **Workers KV**: Cache common AI responses
- **AI Gateway**: Cache LLM responses, reduce API costs

*Details will expand as we implement.*
