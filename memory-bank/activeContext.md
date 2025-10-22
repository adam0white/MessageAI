# Active Context: MessageAI

**Last Updated**: 2025-10-22  
**Phase**: Phase 3.0 COMPLETE ✅

## Current Status
Phase 3.0 validated and complete! All features tested on real devices (iOS simulator + Android physical device):
- ✅ Group chat with 3+ participants working
- ✅ Presence tracking (online count) working across all chat types  
- ✅ Message status: gray ○ → gray ✓ → gray ✓✓ → green ✓✓ (read)
- ✅ Read receipts automatically sent when viewing messages
- ✅ Retroactive delivery status when recipient comes online
- ✅ Simplified conversation creation (auto-detects type from participant count)
- **Backend**: Version 6bfee91f deployed and stable

## Critical Test Results (Phase 3 Validated)
✅ **WORKING**: Messages appear instantly when both users have chat open
✅ **WORKING**: Status indicators: gray ○ → gray ✓ → gray ✓✓ → green ✓✓
✅ **WORKING**: Messages persist across app restarts
✅ **WORKING**: Group chat with 3+ participants
✅ **WORKING**: Online presence tracking (shows "X online")
✅ **WORKING**: Sender names in group chat messages
✅ **WORKING**: Auto-mark-as-read when viewing messages
✅ **WORKING**: Retroactive delivery status on reconnection
✅ **WORKING**: Database cleanup on logout (no cross-user leakage)
⚠️ **LIMITATION**: Read receipts only received when sender online (requires Phase 4 push)

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
18. **Retroactive Status Updates**: When recipient fetches history, backend marks undelivered messages as delivered and broadcasts status updates. This catches messages sent while recipient was offline.
19. **Read Receipts Require Active Connection**: Sender must be connected to receive read receipt updates. When sender closes chat, they miss read receipts. This is fundamental to per-conversation WebSocket pattern - requires push notifications (Phase 4) to solve.
20. **Status Indicator Colors Matter**: Blue checkmarks invisible against blue message bubbles. Changed read status to green (#44b700) for visibility.
21. **Auto-mark-as-read**: When user opens chat, all unread messages automatically marked as read via WebSocket. Prevents manual marking and provides instant feedback to senders (if they're connected).
22. **Presence Shows Other Users, Not Self**: Online indicator should show OTHER participants' status, not your own connection state. For all chat types, show "X online" count (excludes yourself).

## Recent Changes (Phase 3.0 - COMPLETE & VALIDATED)
- ✅ SHA-256 conversation ID hashing for scalable groups (3+ participants)
- ✅ Simplified conversation creation (single UI, auto-detects type, name optional for all)
- ✅ Sender name attribution in MessageBubble component for group chats
- ✅ Presence tracking system in Durable Objects (join/leave broadcasts)
- ✅ Presence UI with online count shown for ALL chat types (1=self, 2=direct, 3+=group)
- ✅ Auto-mark-as-read when viewing messages (sends read receipts automatically)
- ✅ Retroactive delivery status (messages marked delivered whenік fetches history)
- ✅ Enhanced status indicators: gray ○ → gray ✓ → gray ✓✓ → GREEN ✓✓ (read)
- ✅ Message deduplication on reconnection (prevents duplicate offline messages)
- ✅ Database cleanup on logout (prevents cross-user data leakage)
- ✅ usePresence hook for tracking online users
- ✅ useReadReceipts hook with markAsRead function
- ✅ Backend deployed to production (Version 6bfee91f) - all features working
- ✅ Tested on real devices: iOS simulator + Android physical device

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

## Known Limitations (Require Phase 4)
1. **Read receipts only work when sender is online**: Sender must have chat open to receive read receipt updates. When sender closes chat and recipient reads message, sender never sees green checkmarks. **Fix**: Push notifications to update status even when disconnected.
2. **Background messages require chat to be open**: Messages only received when chat screen is active. **FixMenuPhase 4 push notifications.
3. **Old DO messages persist**: Clearing D1 doesn't clear DO storage. Same conversation ID = old messages reappear. **Fix**: Implement conversation deletion endpoint with `ctx.storage.deleteAll()`.

## Next Session Priority
Phase 4: Push Notifications & Final MVP Deployment
