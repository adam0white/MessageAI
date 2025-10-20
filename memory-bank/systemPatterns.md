# System Patterns: MessageAI

## Architecture (To Be Determined)
Will follow standard messaging app pattern:
- Mobile client ↔ Backend/Cloud ↔ AI Services
- Local storage for offline support
- Real-time sync for online messaging

## Core Patterns We'll Need

### Optimistic UI
Update UI immediately, confirm later:
- Add message to local DB with "sending" status
- Display immediately
- Update to "sent" → "delivered" → "read" on confirmation

### Local-First Storage
- Local DB is source of truth for UI
- Cloud DB is source of truth for sync
- Messages stored locally before sending

### Real-Time Sync
- WebSocket or Firebase listeners for live updates
- Subscribe to active conversations
- Update local DB and UI on new messages

### Offline Queue
- Queue messages when offline
- Retry with exponential backoff on reconnect

## AI Patterns (After MVP)
- RAG: Retrieve conversation context before LLM calls
- Function Calling: Let LLM use tools (search, extract, translate)
- Caching: Store common responses to reduce costs

*Details will be added as we implement.*
