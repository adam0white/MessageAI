# Tech Context: MessageAI

## Current Stack

### Frontend
- **React Native + Expo** (TypeScript)
- **Expo Router** - File-based navigation
- **Expo SQLite** - Local message persistence (offline-first)
- **@tanstack/react-query** - Server state management
- **zustand** - App state management
- **@clerk/clerk-expo** - Authentication
- **expo-notifications** - Foreground push notifications
- **WebSocket (native)** - Real-time connection to Workers

### Backend (Cloudflare)
- **Cloudflare Workers** - Entry point, API routing
- **Durable Objects** - Conversation rooms (one DO per conversation)
  - WebSocket connections
  - SQLite storage for messages
  - Presence tracking
- **D1** - User profiles, conversation metadata
- **R2** - Media storage (post-MVP)
- **Clerk** - Authentication provider
- **Workers RPC** - Worker ↔ Durable Object communication

### Post-MVP Services
- **Vectorize** - Message embeddings for RAG
- **Workflows** - Long-running AI operations
- **AI Gateway** - LLM traffic routing
- **OpenAI/Anthropic** - LLM provider (TBD)

## Communication Architecture
- **Client ↔ Worker**: WebSocket with JSON messages
- **Worker ↔ DO**: Workers RPC (type-safe)
- **Shared TypeScript types** across client and server

## Data Storage Strategy
- **Local-first**: SQLite is source of truth for UI
- **Optimistic updates**: Write local, sync to server, update on confirmation
- **Offline support**: Full read access, queued writes on reconnect

## Environment Setup
*To be documented during project initialization*

## Dependencies
*To be listed after `package.json` creation*

## Development Tools
- **Expo Go** - Testing on physical devices
- **Expo Dev Client** - Custom development builds (if needed)
- **Cloudflare Wrangler** - Workers deployment
- **TypeScript** - Type safety everywhere
