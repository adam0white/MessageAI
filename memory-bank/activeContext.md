# Active Context: MessageAI

**Last Updated**: 2025-10-24  
**Phase**: Phase 9.0 COMPLETE ✅ (Testing, Bug Fixes & Production Hardening)

## Current Status

**All MVP + AI Features Complete:**
- ✅ **Core Messaging**: Real-time chat, group chat, presence, read receipts
- ✅ **5 AI Analysis Tools**: Thread summaries, action items, priority detection, decisions, smart search
- ✅ **Multi-Step Agent**: Team event planner with context-aware workflow
- ✅ **Production Ready**: Deployed at message.adamwhite.work with debug panel
- ✅ **Performance Tested**: Handles 100+ rapid messages without errors

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
- **Backend URL**: https://message.adamwhite.work
- **D1 Database**: Migrations 0001-0003 applied
- **Durable Objects**: SQLite enabled for messages
- **Vectorize**: messageai-embeddings (768D, cosine)
- **Workers AI**: Llama 3.1 8B Fast via AI Gateway (aw-cf-ai)
- **WebSocket**: Secure wss:// connections
- **Message Limits**: 1000 from server, 10000 local storage
- **Config**: Centralized in lib/config.ts (no .env files)

## Tech Stack
- **Frontend**: React Native (Expo SDK 54), React 19.1.0 (locked)
- **Backend**: Cloudflare Workers + Durable Objects + D1
- **Auth**: Clerk (email/password)
- **State**: React Query v5 + Zustand v5
- **Database**: SQLite (local) + D1 (backend) + DO SQLite (messages)
- **AI**: Workers AI (Llama 3.1 8B) + Vectorize + AI Gateway

## Critical Learnings

### Phase 1 Learnings
1. **React Version Locking**: Must lock React at exact version (19.1.0) to match React Native renderer. Use `overrides` in package.json.
2. **Clerk Setup**: Disable email verification in dev to avoid SPF issues. Check `signUp.status` for immediate completion.
3. **Expo Dependencies**: Always use `npx expo install` for compatible versions.

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

### Phase 4 Learnings (Notifications)
23. **Polling for MVP**: 3-second polling works well for foreground notifications without FCM complexity
24. **Local Notifications**: Work in Expo Go, dev builds, and production with no special setup
25. **React Query Updates**: Use `setQueryData()` for immediate cache updates, not `invalidateQueries()`

### Phase 5 Learnings (RAG & AI)
26. **Parallel Embedding**: 50/batch, no delay = ~1-2s for 100 msgs (vs 24s sequential)
27. **Vectorize is Idempotent**: Same message ID won't duplicate, safe to re-embed
28. **AI Gateway**: Pass gateway ID in `AI.run()` call args, not config
29. **Model**: Llama 3.1 8B Fast (fastest Workers AI model)
30. **Performance**: React.memo on MessageBubble prevents re-renders

### Phase 7 Learnings (Multi-Step Agent)
31. **Context is Everything**: Pass recent messages to agent for proper event type detection
32. **Adaptive Workflows**: Use flags to skip irrelevant steps (meetings don't need venues)
33. **No Fake Data**: Use area names ("Downtown") not fake addresses ("123 Main St")
34. **Extract Real Data**: Find actual times from messages, not hardcoded defaults

## Phase 9 Highlights (Testing & Production Hardening)

**Debug Tools:**
- Tap chat title 3x for debug panel
- Shows: Conversation ID, live WebSocket status, message count, online users
- Test buttons: 20 rapid messages, 100 performance messages
- Clear local DB & reload button

**UX Improvements:**
- Inverted FlatList pattern (standard for chat apps)
- Zero scroll flash - opens instantly to newest messages
- Smart scroll-to-bottom button

**Bug Fixes:**
- Fixed duplicate key errors (render-level deduplication)
- Fixed 50 message limit → 1000 from server, 10000 local
- Fixed FOREIGN KEY constraint on read receipts
- Fixed WebSocket errors on closed connections
- Graceful handling during high-volume messaging

**Deployment:**
- Custom domain: message.adamwhite.work
- HTML landing page with GitHub link
- Eliminated .env files (centralized config)
- Workers subdomain disabled

**Performance Discovery:**
Backend delivers messages faster than React can process locally - Cloudflare Workers excellence! (See systemPatterns.md for details)

## Known Limitations
1. **Foreground notifications only**: App must be open (3s polling). Future: FCM for background
2. **Read receipts when sender online**: Sender must have chat open. Future: Push notifications
3. **DO message persistence**: Old messages persist. Future: Deletion endpoint with `ctx.storage.deleteAll()`

## Next Steps
- Phase 10+: Polish, iOS testing, demo video, deployment
- Post-MVP: Background notifications (FCM), media support, enhanced UX
