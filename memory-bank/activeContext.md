# Active Context: MessageAI

**Last Updated**: 2025-10-22  
**Phase**: Phase 3.0 TESTING & BUG FIXES

## Current Status
Phase 3.0 features implemented and deployed. Currently fixing bugs found during real-device testing:
- ✅ Fixed: user_presence table creation on first use
- ✅ Fixed: Message status progression (sent → delivered)
- ✅ Fixed: Duplicate message prevention after reconnection
- 🔄 Testing: Status updates, presence tracking, group chat features
- **Backend**: Version 458da6b7 deployed with proper delivered status logic

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

### Phase 3 Learnings (Bug Fixes & Testing)
13. **DO Storage Persists Independent of D1**: Clearing D1 doesn't clear DO SQLite storage. Same conversation ID = same DO = old messages appear. Post-MVP: implement conversation deletion endpoint that calls `ctx.storage.deleteAll()` before removing from D1.
14. **Message Status Flow**: Backend must send 'delivered' status only when message actually reaches recipients. Check broadcast return count, not session count.
15. **Database Schema Evolution**: Old databases may lack new tables. Either: (a) create tables on-demand in hooks, or (b) run migration on app update. Opted for (a) for presence table.
16. **Conversation Creation UX**: Simplified to single generic flow - participant count determines type automatically (1=self, 2=direct, 3+=group). No separate UI for each type.
17. **Real-time Cache Updates**: Must call `queryClient.invalidateQueries()` after updating cache to force re-render, especially for status changes.

## Recent Changes (Phase 3.0 - COMPLETE)
- ✅ SHA-256 conversation ID hashing for scalable groups (3+ participants)
- ✅ Group conversation creation UI with type selector and multi-user input
- ✅ Sender name attribution in MessageBubble component for group chats
- ✅ Presence tracking system in Durable Objects (join/leave broadcasts)
- ✅ Presence UI with online user count in chat headers
- ✅ Enhanced read receipts with colored status indicators (blue/gray/red)
- ✅ usePresence hook for tracking online users
- ✅ useReadReceipts hook for tracking message read status
- ✅ Group name display in conversation list and chat headers
- ✅ Backend deployed to production with all Phase 3 features
- ✅ Type-safe WebSocket protocol updated with onlineUserIds in ConnectedEvent

## Files to Note

### Phase 3 New Files
- `shared/utils.ts`: SHA-256 hashing utilities for conversation IDs
- `hooks/usePresence.ts`: Presence tracking hook (online/offline status)
- `hooks/useReadReceipts.ts`: Read receipts tracking hook
- `components/MessageBubble.tsx`: Enhanced with sender names and colored status indicators

### Core Files (Updated in Phase 3)
- `app/(app)/chat/[id].tsx`: Chat screen with group support, presence, and online count
- `app/(app)/index.tsx`: Conversation list with group creation UI and type selector
- `worker/src/durable-objects/Conversation.ts`: Presence broadcasts on join/leave
- `worker/src/db/schema.ts`: Uses SHA-256 for group conversation IDs
- `shared/types.ts`: ConnectedEvent with onlineUserIds field

### Phase 1-2 Files
- `package.json`: React locked at 19.1.0 with overrides
- `hooks/useMessages.ts`: Message sending/receiving with optimistic updates
- `hooks/useConversations.ts`: Conversation management
- `lib/api/websocket.ts`: WebSocket client singleton
- `worker/src/handlers/conversations.ts`: REST API for conversations
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
