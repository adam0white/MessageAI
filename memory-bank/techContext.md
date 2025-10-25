# Tech Context: MessageAI

## Current Stack (Installed & Configured)

### Frontend
- **React** - 19.1.0 (LOCKED - do not upgrade)
- **React Native** - 0.81.4 (via Expo SDK 54)
- **Expo SDK** - ~54.0.16
- **TypeScript** - ~5.9.2
- **Expo Router** - ^6.0.13 (file-based navigation)
- **Expo SQLite** - ^16.0.8 (local persistence)
- **@tanstack/react-query** - Latest v5 (server state)
- **zustand** - Latest v5 (app state)
- **@clerk/clerk-expo** - ^2.17.0 (authentication)
- **expo-notifications** - Foreground notifications
- **expo-image-picker** - Image selection from library
- **expo-image-manipulator** - Image compression and resizing
- **Native WebSocket** - Built-in (real-time connection)

### Backend (Cloudflare)
- **Cloudflare Workers** - Entry point, API routing
- **Wrangler** - ^4.45.0 (deployment CLI with auto-provisioning)
- **TypeScript** - ^5.9.2
- **Durable Objects** - Conversation rooms (one DO per conversation)
  - WebSocket connections with hibernation
  - SQLite storage for messages
  - Presence tracking
- **D1** - User profiles, conversation metadata
- **R2** - Media storage (auto-provisioned: `messageai-worker-media-bucket`)
- **Workers AI** - Llama 3.1 8B Fast, embeddings (bge-base-en-v1.5)
- **Vectorize** - Semantic search index (messageai-embeddings, 768D)
- **Clerk** - Authentication provider
- **Workers RPC** - Worker ↔ Durable Object communication

## Communication Architecture
- **Client ↔ Worker**: WebSocket with JSON messages
- **Worker ↔ DO**: Workers RPC (type-safe)
- **Shared TypeScript types**: `shared/types.ts` re-exported in both projects

## Data Storage Strategy
- **Local-first**: SQLite is source of truth for UI
- **Optimistic updates**: Write local, sync to server, update on confirmation
- **Offline support**: Full read access, queued writes on reconnect

## Critical Configuration Notes

### React Version Locking
**IMPORTANT**: React must be locked at 19.1.0 to match React Native 0.81.4's renderer.

### Clerk Configuration
- Email verification: **Disabled** for development
- Sign-up flow checks `status === 'complete'` vs `'missing_requirements'`
- Webhook endpoint: `/webhooks/clerk` (POST)
- Events: `user.created`, `user.updated`

### Database Setup
**SQLite (Frontend)**:
- Auto-initialized on app launch
- Tables: users, conversations, messages, read_receipts, presence
- Schema: `lib/db/schema.ts`

**D1 (Backend)**:
- Manual setup required: `wrangler d1 create messageai-db`
- Migration: `wrangler d1 execute messageai-db --local --file=./src/db/migrations/0001_initial_schema.sql`
- Tables: users, conversations, conversation_participants, push_tokens

## Development Commands

### Frontend
```bash
npm start              # Start Expo dev server
npx expo-doctor       # Check project health
npx expo install      # Install compatible packages
```

### Backend
```bash
cd worker
npm run dev           # Start local Worker (port 8787)
npm run deploy        # Deploy to Cloudflare
npm run cf-typegen    # Regenerate types
```

## Development Tools
- **Expo Go** - Testing on physical devices (Android/iOS)
- **Cloudflare Wrangler** - Workers deployment
- **TypeScript** - Strict mode enabled everywhere
- **Git** - Version control (.env files gitignored)

## Known Issues & Solutions
1. **React version mismatch**: Use exact versions + overrides
2. **Clerk sign-up error**: Check `status` before attempting verification
3. **Peer dependencies**: Run `npx expo install` not `npm install`
4. **Metro cache**: Clear with `npx expo start --clear`
