# Active Context: MessageAI

**Last Updated**: 2025-10-23  
**Phase**: Phase 4.1 COMPLETE ✅ (Bug Fixes & UX Improvements)

## Current Status
Phase 4.0 foreground notifications working via polling + local notifications (no FCM needed for MVP):
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
- **Latest Version**: f04f1532 (Phase 4 - Foreground Notifications Complete)
- **D1 Database**: Migrations 0001-0003 applied (users, conversations, push_tokens, read receipts, message previews)
- **Durable Objects**: SQLite enabled, syncs message previews to D1
- **WebSocket**: wss:// secure connections
- **Foreground Notifications**: Polling (3s) + local notifications + name fallback (email prefix)
- **Monitoring**: wrangler tail for live logs

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

### Phase 4 Learnings (Notifications - CRITICAL)
23. **Foreground vs Background Notifications**: For foreground notifications (app open), local notifications + polling is simpler and more reliable than FCM. FCM only needed for background/closed app scenarios.
24. **Polling is Acceptable for MVP**: 3-second polling for conversation list is lightweight and provides notification UX without FCM complexity. Can upgrade to global WebSocket or FCM later.
25. **Per-Conversation WebSocket Limitation**: Current architecture (one WS per open chat) means users on conversation list aren't connected to ANY chat. Need global user WebSocket or polling for notifications. Chose polling for MVP simplicity.
26. **Local Notifications Work Everywhere**: `Notifications.scheduleNotificationAsync` with `trigger: null` works in Expo Go, dev builds, and production without any special setup.
27. **ExponentPushToken vs ExpoPushToken**: ExponentPushToken = legacy Expo service (unreliable). ExpoPushToken = FCM (reliable). If seeing Exponent prefix, FCM isn't configured properly.
28. **FCM is Complex**: FCM requires google-services.json, service account JSON, proper manifest configuration, and production builds. Too complex for MVP foreground-only notifications.
29. **Test Local Notifications First**: Before debugging FCM, always test if local notifications work. If they do, FCM/config issue. If they don't, device/permissions issue.
30. **React Query Cache Updates**: When polling returns fresh data, use `setQueryData()` to update cache directly instead of `invalidateQueries()`. This avoids extra network requests and ensures immediate UI updates. Only invalidate when you don't have the fresh data.

## Recent Changes (Phase 4.1 - Bug Fixes & UX Improvements - Oct 23, 2025)

**Authentication & Profile:**
- Added first name and last name fields to signup form (optional)
- Created profile screen (`app/(app)/profile.tsx`) for viewing and updating user name
- Added Profile button to conversation list header

**Chat Experience:**
- Fixed double gray check marks (delivered status) now persisting and broadcasting
- Fixed chat history causing unnecessary refresh and scroll on enter
- Improved scroll behavior to only scroll on new messages, not on history reload
- Removed Enter key shortcut (multiline input on mobile doesn't support this pattern)

**UX Improvements:**
- Improved new conversation modal with quick "Self Chat" button
- Better labels and help text for conversation creation
- User ID prominently displayed with copy hint

**Code Quality:**
- Cleaned up excessive console.log noise in frontend (useMessages, usePresence, chat screen, index)
- Cleaned up backend logging (connection logs, broadcast logs, emoji logs)
- Removed redundant header comments from component files
- Fixed linter errors (React imports, type issues)

## Architecture Decisions for Future Phases

See `systemPatterns.md` for detailed notes on:
- Deterministic IDs → SHA-256 hashing (Phase 3)
- Delta sync with timestamps (Phase 4)
- Historical message pagination (Phase 3)
- Background message strategy: Push notifications (Phase 4)
- Single vs multiple WebSocket connections

## Known Limitations (Phase 4.0 - Foreground Polling)
1. **Polling-based (3s interval)**: Notifications have 0-3 second delay. **Future**: Upgrade to global user WebSocket for instant notifications.
2. **Foreground only**: App must be open to receive notifications. **Future**: Add FCM for background/closed app notifications.
3. **Generic notification body**: Shows "You have a new message" instead of actual content (messages stored in DO, not D1). **Future**: Fetch from DO or denormalize to D1.
4. **Old DO messages persist**: Clearing D1 doesn't clear DO storage. Same conversation ID = old messages reappear. **Fix**: Implement conversation deletion endpoint with `ctx.storage.deleteAll()`.

## Next Session Priority
Phase 4.5-4.7: Final MVP deployment and documentation
