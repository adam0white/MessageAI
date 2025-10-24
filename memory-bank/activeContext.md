# Active Context: MessageAI

**Last Updated**: 2025-10-24  
**Phase**: Phase 7.0 COMPLETE ✅ (Multi-Step Agent for Team Event Planning Working!)

## Current Status
Phase 7.0 Multi-Step Agent implementation completed and deployed:
- ✅ **Multi-Step Event Planner**: 6-step autonomous workflow for team event planning
- ✅ **Context-Aware**: Analyzes conversation to understand event type (meeting vs food event)
- ✅ **Smart Workflow**: Skips venue/poll steps for simple meetings
- ✅ **Availability Analysis**: Extracts suggested times from team messages
- ✅ **Venue Recommendations**: AI-generated suggestions (2 options, no fake addresses)
- ✅ **Progress Tracking**: Real-time step updates broadcast to all participants
- ✅ **State Persistence**: Workflow survives interruptions, resumes from last step
- ✅ **Error Recovery**: Automatic retries with graceful degradation
- **Backend**: Version fb0b4758 deployed with agent endpoint live

**Previous Phase 6.0 AI Features (All Working):**
- ✅ Thread Summarization, Action Items, Priority Detection, Decision Tracking, Smart Search
- ✅ Unified AI Panel with 7 feature buttons (Ask, Summary, Actions, Priority, Decisions, Search, Planner)
- ✅ Modal Results Display with clickable message references

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
- **D1 Database**: Migrations 0001-0003 applied
- **Durable Objects**: SQLite enabled
- **Vectorize**: messageai-embeddings (768D, cosine)
- **Workers AI**: Llama 3.1 8B Fast via AI Gateway (aw-cf-ai)
- **Embedding**: bge-base-en-v1.5, 50/batch, no delay, parallel (~1-2s for 100 msgs)
- **WebSocket**: wss:// secure connections
- **AI Endpoints**: 
  - POST /api/conversations/:id/start-embedding (proactive background)
  - POST /api/conversations/:id/ask-ai (RAG query)
  - POST /api/conversations/:id/summarize (thread summary)
  - POST /api/conversations/:id/action-items (extract tasks)
  - POST /api/conversations/:id/priority-messages (detect urgent)
  - POST /api/conversations/:id/decisions (track consensus)
  - POST /api/conversations/:id/smart-search (semantic search)
  - POST /api/ai/chat (legacy standalone)
- **Foreground Notifications**: Polling (3s) + local notifications
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

### Phase 5 Learnings (RAG - CRITICAL)
31. **Parallel Embedding with Rate Limits Off**: 50/batch, no delay, parallel within batch = ~1-2s for 100 msgs (vs 24s sequential)
32. **Vectorize Upsert is Idempotent**: Same message ID won't duplicate. Safe to re-embed.
33. **AI Gateway in Call Arguments**: Gateway ID in `AI.run()` call, not config. Enables per-request metadata.
34. **Proactive Embedding UX**: Start embedding when panel opens (background). User can type while waiting, Ask button disabled until ready.
35. **AI as Participant Pattern**: AI responses saved as messages (sender: "ai-assistant"), broadcast like any message.
36. **D1 Update Parameters**: updateConversationLastMessage(db, convId, timestamp, content, senderId) - wrong params cause "Invalid date".
37. **Model Selection**: Llama 3.1 8B Fast (fastest Workers AI model). Qwen 1.5 14B deprecated Oct 2025.
38. **Input Always Editable**: Better UX - disable Ask button, not input. Users can prepare question while RAG loads.
40. **MessageBubble Performance**: Wrap with React.memo to prevent re-renders on large lists (fixes VirtualizedList warning).
41. **Smart Embedding Check**: Use `getByIds()` to check existing embeddings (faster than querying with test embedding).

### Phase 7 Learnings (Multi-Step Agent - Oct 24, 2025)
42. **Context is Everything for Agents**: Initial implementation ignored conversation context and worked on placeholders. Fixed by passing recent messages to INIT step for proper event type detection.
43. **Adaptive Workflows Beat Rigid Ones**: Not all events need venues/polls. Simple meetings should skip directly to scheduling. Implemented `needsVenue` flag to branch workflow dynamically.
44. **No Fake Data in Production**: Placeholder addresses ("123 Main St") look unprofessional. Better to use area names ("Downtown") or show "To be decided" than fake specifics.
45. **Poll Overkill for 2 Options**: Creating formal polls for 2 venue choices adds complexity without value. Better to suggest top 2 and let team discuss in chat naturally.
46. **Extract Real Data from Conversation**: Agent should find actual suggested times from messages ("2pm works", "Friday at 3"), not default to hardcoded values like "12:00 PM".
47. **Progressive Disclosure in UI**: Modal should adapt to event type - hide venue sections for simple meetings, show full details only for food events.
48. **Test Early with Real Scenarios**: Testing revealed the agent treating all requests as food events. Real-world testing is essential for validating agent workflows.

## Recent Changes (Phase 7.0 - Multi-Step Agent - Oct 24, 2025)

**Multi-Step Agent Implementation:**
- Created agent workflow system with 6 steps (INIT → AVAILABILITY → PREFERENCES → VENUES → POLL → CONFIRM)
- Implemented RPC method `runAgent()` in Conversation DO
- Added agent state management with SQLite table
- Built Event Planner UI with progress tracking
- Deployed version fb0b4758

**Critical Improvements After Testing:**
- Added conversation context to INIT step (agent now reads recent messages)
- Implemented `needsVenue` flag to differentiate meetings from food events
- Smart workflow branching: Simple meetings skip PREFERENCES/VENUES/POLL steps
- Improved availability extraction to find actual suggested times from messages
- Reduced venue suggestions from 3 to 2 options
- Removed fake addresses (now uses area names like "Downtown")
- Skipped formal poll creation - agent picks top venue automatically
- Adaptive UI: Modal hides venue info for non-food events

**Architecture:**
- Agent state stored in DO SQLite for persistence
- Each step calls Workers AI (Llama 3.1 8B Fast) for reasoning
- Progress broadcast as messages to conversation (visible to all)
- Frontend auto-continues workflow until completion (1s delays between steps)
- Error recovery: 1 retry per step, then mark as failed

## Previous Changes (Phase 6.0 - AI Features Implementation - Oct 24, 2025)

**All 5 AI Features for Remote Teams:**
- Implemented Thread Summarization with structured JSON output (3 key points)
- Built Action Item Extraction with assignee and due date parsing
- Created Priority Message Detection (HIGH/MEDIUM with urgency reasons)
- Added Decision Tracking with consensus phrase detection
- Integrated Smart Search with semantic ranking (top-10 results)
- Designed unified AI Panel UI with 6 feature buttons
- Created beautiful modal results display with feature-specific layouts
- Added clickable message references (tap to jump to original message)
- Fixed invisible text issue (button colors improved for visibility)
- Added onScrollToIndexFailed handler for smooth message navigation

**Backend Enhancements:**
- 5 new RPC methods in Conversation DO (all using Workers AI + AI Gateway)
- 5 new REST endpoints for each AI feature
- Low temperature (0.2-0.3) for consistent structured output
- JSON parsing with graceful fallbacks for robustness
- Deployed version d90d72dc with all endpoints live

**Frontend UX:**
- Feature buttons with active state highlighting
- Progress indicators for all AI operations
- Input field only shown for Ask and Search features
- One-click actions for Summary, Actions, Priority, Decisions
- Modal with scrollable results and empty state handling
- Color-coded priority badges (🔴 HIGH / 🟡 MEDIUM)
- Relevance scores shown as percentages
- "Tap to view in conversation →" hints

## Previous Changes (Phase 5.0 - RAG Implementation - Oct 23, 2025)

**RAG Pipeline Complete:**
- Created Vectorize index (messageai-embeddings, 768 dimensions, cosine similarity)
- Implemented on-demand embedding pipeline with batching (10 msgs/batch, 100ms delay between batches)
- Added askAI() RPC method to Conversation DO with full RAG workflow
- Semantic search retrieves top-5 most relevant messages using bge-base-en-v1.5 embeddings
- AI Gateway integration (aw-cf-ai) - removed local rate limiting, gateway handles it
- Deployed worker version f853390b with RAG endpoint tested

**Frontend UX Improvements:**
- Replaced blocking modal with sticky AI input at top of chat
- Non-blocking: users can continue chatting while AI processes
- Progress indicator shows "Embedding messages..." during processing
- AI button toggles input (blue when active)
- AI responses appear as messages from "ai-assistant" (visible to all)

**Critical Fixes:**
- **Rate Limiting Issue**: Initial implementation hit gateway limits (106 parallel embeddings)
- **Solution**: Batch embeddings (10 per batch, 100ms delay) - prevents rate limit errors
- **Result**: Successfully embedded 106 messages without errors

**Key Technical Decisions:**
- **Batched Embeddings**: Prevents rate limiting on large conversations
- **On-Demand RAG**: Embeddings created on first query, cached in Vectorize
- **AI as Participant**: Responses visible to all (collaborative AI)
- **Sticky UI**: Non-blocking input so users can chat while waiting
- **RPC Pattern**: Direct DO method calls, cleaner than REST endpoints

**Previous Phase 4.1 Changes (Bug Fixes & UX Improvements):**

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

**Phase 5 Cleanup (Oct 23, 2025):**
- Fixed WebSocket error logging (removed verbose console.error)
- Memoized MessageBubble component (fixes VirtualizedList performance warning)
- Fixed AI context bug: changed `slice(0, 10)` → `slice(-10)` to get **recent** messages, not oldest
- Removed debug console.logs from proactive embedding flow
- Production-ready: All code clean, tested, optimized

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
**Recommended**: Phase 4.5-4.7: Final MVP Deployment & Documentation
- Deploy Expo app to Expo Go / TestFlight
- Run final verification checklist (all AI features + agent)
- Document deployment steps in README
- Create demo video showing all features
- Prepare social media posts

**Alternative**: Phase 8.0: Typing Indicators & Quick Wins
- Typing indicators for real-time presence
- Group member list UI
- Polish and UX improvements

**Note**: All 6 AI features (5 analysis tools + multi-step agent) are now complete and deployed!
