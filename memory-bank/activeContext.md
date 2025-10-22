# Active Context: MessageAI

**Last Updated**: 2025-10-21  
**Phase**: Phase 2.0 COMPLETE ✅ - Tested on Two Real Devices (Android + iPhone)

## Current Status
Phase 2.0 fully complete and validated! Real-time messaging working between Android and iPhone devices. Core messaging infrastructure solid and production-ready. Deployed to Cloudflare Workers.

## Critical Test Results
✅ **WORKING**: Messages appear instantly when both users have chat open
✅ **WORKING**: Status indicators update in real-time (○ → ✓)
✅ **WORKING**: Messages persist across app restarts
✅ **WORKING**: Deterministic conversation IDs prevent duplicates
✅ **WORKING**: Historical message loading via get_history
⚠️ **LIMITATION**: Background messages require chat to be open (need push notifications)

## Production Deployment
- **Worker URL**: https://messageai-worker.abdulisik.workers.dev
- **D1 Database**: Migrated and operational
- **Durable Objects**: SQLite enabled via `new_sqlite_classes`
- **WebSocket**: wss:// secure connections working
- **Monitoring**: wrangler tail running for live logs

## Key Decisions Made
- ✅ Platform: React Native with Expo SDK 54
- ✅ Backend: Cloudflare Workers + Durable Objects + D1
- ✅ Authentication: Clerk (email/password, verification optional)
- ✅ State Management: React Query v5 (server state) + Zustand v5 (app state)
- ✅ React Version: **Locked at 19.1.0** (critical for compatibility)
- ✅ Database: SQLite (frontend) + D1 (backend) + DO SQLite (messages)
- ✅ Navigation: Expo Router (file-based)

## Key Decisions Pending
- [ ] UI component library (using defaults for now)
- [ ] Conversation creation UX flow
- [ ] LLM provider for AI features (OpenAI vs Anthropic)

## Critical Learnings

### Phase 1 Learnings
1. **React Version Locking**: Must lock React at exact version (19.1.0) to match React Native renderer. Use `overrides` in package.json.
2. **Clerk Setup**: Disable email verification in dev to avoid SPF issues. Check `signUp.status` for immediate completion.
3. **Expo Dependencies**: Always use `npx expo install` for compatible versions.
4. **Environment Variables**: Use `EXPO_PUBLIC_` prefix for frontend env vars in Expo.

### Phase 2 Learnings (Hard-Won Insights)
5. **Expo Go + localhost = fail**: Expo Go on phone cannot reach `localhost` on your computer. Must use production URL or deploy early.
7. **Foreign Key Cascades**: Auto-create placeholder users/participants before inserting conversations/messages to prevent FK errors.
8. **WebSocket Hibernation API**: Use `serializeAttachment()` / `deserializeAttachment()` + restore sessions in constructor from `ctx.getWebSockets()`.
9. **Deterministic IDs Strategy**: Sorted participant IDs prevent duplicate conversations. Will need SHA-256 hashing for groups (Phase 3).
10. **Per-Conversation WebSockets**: Each chat = one DO = one WebSocket. Good for scaling, but means:
    - Messages only received when chat is open
    - Need push notifications for background (Phase 4)
    - This is the standard pattern
11. **Deploy Early, Deploy Often**: Production deployment revealed issues faster than local debugging. Always have wrangler tail running.
12. **Type Sharing**: Share more than types - share function names, constants, validation rules to prevent drift.

## Recent Changes (Phase 2.0 - FINAL)
- ✅ Durable Object with WebSocket handlers and session tracking
- ✅ SQLite storage in Durable Objects for messages + read receipts
- ✅ WebSocket client with connection event callbacks (onConnected, onReconnected, onDisconnected)
- ✅ Optimistic UI updates for instant message feedback
- ✅ Message sending: local write → WebSocket → server confirmation
- ✅ Message receiving: WebSocket → SQLite → React Query update
- ✅ Chat screen with message bubbles, timestamps, status indicators
- ✅ Network monitoring triggers WebSocket reconnection when network returns
- ✅ Offline messages sync automatically after reconnection (no duplicates)
- ✅ History fetched on every reconnection to catch missed messages
- ✅ WebSocket error spam reduced (only logs on initial failure)
- ✅ Conversation CRUD endpoints in Worker
- ✅ Deterministic conversation IDs working correctly

## Files to Note
- `package.json`: React locked at 19.1.0 with overrides, expo-network added
- `app/_layout.tsx`: Root providers (Clerk, React Query, DB init)
- `app/(app)/_layout.tsx`: Protected layout with network monitoring
- `app/(app)/chat/[id].tsx`: Chat screen (main messaging UI)
- `app/(app)/index.tsx`: Conversation list (shows all chats)
- `hooks/useMessages.ts`: Message sending/receiving with optimistic updates
- `hooks/useConversations.ts`: Conversation management
- `hooks/useNetworkMonitor.ts`: Network status and offline sync
- `lib/api/websocket.ts`: WebSocket client singleton
- `components/MessageBubble.tsx`: Message bubble component
- `worker/src/durable-objects/Conversation.ts`: Full DO implementation
- `worker/src/handlers/conversations.ts`: REST API for conversations
- `worker/src/index.ts`: Worker with all routes (WS + REST)
- `.env`: Contains Clerk keys + EXPO_PUBLIC_WORKER_URL (gitignored)

## Architecture Decisions for Future Phases

See `systemPatterns.md` for detailed notes on:
- Deterministic IDs → SHA-256 hashing (Phase 3)
- Delta sync with timestamps (Phase 4)
- Historical message pagination (Phase 3)
- Background message strategy: Push notifications (Phase 4)
- Single vs multiple WebSocket connections

## Next Session Priority
Phase 3 or Phase 4 tasks. Phase 2 is solid and tested on multiple real devices!
