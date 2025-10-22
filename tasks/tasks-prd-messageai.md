# Task List: MessageAI

**Generated from:** `prd-messageai.md`  
**Date:** October 21, 2025  
**Timeline:** 7 days (MVP: 24 hours)

---

## Relevant Files

### Frontend (Expo App) - Created
- `app.json` - Expo configuration (app name: MessageAI, bundle: com.messageai.app)
- `package.json` - Dependencies (Expo SDK 54, React 19.1, TypeScript 5.9)
- `tsconfig.json` - TypeScript configuration
- `App.tsx` - Root app component (placeholder)
- `index.ts` - App entry point
- `assets/` - App icons and splash screens

### Frontend (Expo App) - Database Created
- `lib/db/schema.ts` - SQLite schema (users, conversations, messages, read_receipts, presence)
- `lib/db/queries.ts` - Type-safe query helpers for all database operations
- `lib/db/index.ts` - Database exports

### Frontend (Expo App) - Auth & Navigation Created
- `app/_layout.tsx` - Root layout with ClerkProvider and database initialization
- `app/index.tsx` - Root redirect (auth or app based on state)
- `app/auth/sign-in.tsx` - Email/password sign-in with Clerk
- `app/auth/sign-up.tsx` - Email/password sign-up with verification
- `app/(app)/_layout.tsx` - Protected app layout
- `app/(app)/index.tsx` - Conversation list screen (placeholder UI)
- `SETUP.md` - Setup and configuration instructions

### Frontend (Expo App) - State Management Created
- `lib/stores/auth.ts` - Zustand store for auth state (userId, isAuthenticated)
- `lib/stores/network.ts` - Zustand store for network and WebSocket status

### Frontend (Expo App) - Chat & Messaging Created
- `app/(app)/chat/[id].tsx` - Chat screen with message list, input, send button, real-time updates
- `app/(app)/index.tsx` - Conversation list with pull-to-refresh and navigation
- `hooks/useMessages.ts` - React Query hook for optimistic message sending and receiving
- `hooks/useConversations.ts` - React Query hook for conversation management
- `hooks/useNetworkMonitor.ts` - Network monitoring and offline sync
- `components/MessageBubble.tsx` - Message bubble with timestamps and status indicators
- `lib/api/websocket.ts` - WebSocket client with auto-reconnection, message queue, and type-safe handlers

### Frontend (Expo App) - To Be Created
- `app/(app)/new-conversation.tsx` - Create conversation screen
- `components/ConversationListItem.tsx` - Conversation preview component (using inline for now)

### Backend (Cloudflare Workers) - Created
- `worker/wrangler.jsonc` - Cloudflare configuration with Durable Objects and D1 bindings
- `worker/package.json` - Worker dependencies (Wrangler 4.43, TypeScript 5.9)
- `worker/tsconfig.json` - TypeScript configuration for Workers
- `worker/src/index.ts` - Main Worker entry point with conversation routing
- `worker/src/durable-objects/Conversation.ts` - Durable Object with WebSocket support, in-memory session tracking, broadcast helpers
- `worker/worker-configuration.d.ts` - Auto-generated Cloudflare types

### Backend (Cloudflare Workers) - Database Created
- `worker/src/db/schema.ts` - D1 query helpers (users, conversations, push tokens)
- `worker/src/db/migrations/0001_initial_schema.sql` - Initial D1 schema migration
- `worker/src/db/migrations/README.md` - Migration instructions

### Backend (Cloudflare Workers) - Handlers Created
- `worker/src/handlers/auth.ts` - Clerk webhook handler (user.created, user.updated events)
- `worker/src/handlers/conversations.ts` - Conversation CRUD endpoints (create, list, get by ID)

### Backend (Cloudflare Workers) - To Be Created
- `worker/src/handlers/notifications.ts` - Push notification sender

### Shared - Created
- `shared/types.ts` - Complete type definitions (User, Message, Conversation, WebSocket protocol with ConnectedEvent)
- `lib/api/types.ts` - Frontend re-exports with frontend-specific types
- `worker/src/types/index.ts` - Backend re-exports with backend-specific types

### Configuration
- `package.json` - Frontend dependencies
- `app.json` - Expo configuration
- `tsconfig.json` - TypeScript configuration
- `worker/package.json` - Worker dependencies
- `worker/tsconfig.json` - Worker TypeScript configuration

### Notes
- Shared types should be synchronized between `lib/api/types.ts` (frontend) and `worker/src/types/` (backend)
- Testing will be added in later phases (post-MVP)
- Use latest stable versions via `npm install @latest`: Expo SDK 54+, React Query v5, Zustand v5, Clerk v2+

---

## Tasks

### MVP Phase (24 Hours)

- [x] **1.0 Foundation & Authentication Setup**
  - [x] 1.1 Initialize Expo project with TypeScript template and configure app.json with proper bundle identifier and app name
    - **✓ TEST:** Run `npx expo start`, scan QR code with Expo Go, see default app on phone
  - [x] 1.2 Initialize Cloudflare Workers project with Wrangler, set up TypeScript, and configure wrangler.toml with Durable Objects bindings
  - [x] 1.3 Create shared types structure (`shared/types.ts`) for WebSocket messages, Message, Conversation, and User models
  - [x] 1.4 Set up Expo SQLite database with schema for messages, conversations, and read_receipts tables
  - [x] 1.5 Create D1 database, write migration files for users, conversations, and conversation_participants tables
  - [x] 1.6 Integrate Clerk in Expo app (install @clerk/clerk-expo, configure ClerkProvider, create sign-in/sign-up screens)
    - **✓ TEST:** Sign up with email, see authenticated state, sign out, sign back in
  - [x] 1.7 Set up Clerk webhook handler in Worker to sync user data to D1 when users sign up
  - [x] 1.8 Install and configure React Query v5 and Zustand v5 with providers in root layout
  - [x] 1.9 Build basic UI screens: conversation list skeleton with navigation, protected routes using Clerk
    - **✓ TEST:** Navigate between screens, verify protected routes redirect to sign-in when logged out

- [x] **2.0 Real-Time Messaging Infrastructure** ✅ COMPLETE
  - [x] 2.1 Create Durable Object class for Conversation with WebSocket accept handler and in-memory connection tracking
    - **✅ TESTED:** Postman WebSocket connected successfully, hibernation API working
  - [x] 2.2 Implement WebSocket upgrade endpoint in Worker that routes to correct Durable Object by conversation ID
  - [x] 2.3 Build WebSocket client module in Expo (`lib/api/websocket.ts`) with connection, reconnection, and message handling
    - **✅ ENHANCED:** Added connection event callbacks (onConnected, onReconnected, onDisconnected)
    - **✅ ENHANCED:** Added force reconnection method for network recovery
  - [x] 2.4 Implement SQLite storage in Durable Object for messages with schema and basic CRUD operations
  - [x] 2.5 Create message sending flow: optimistic SQLite write → UI update → WebSocket send → server confirmation → status update
  - [x] 2.6 Implement message receiving: WebSocket listener → SQLite write → React Query cache invalidation → UI update
  - [x] 2.7 Build chat screen UI with message list (FlatList), input field, send button, and timestamp display
    - **✅ TESTED:** Messages persist after force-quit, UI displays correctly
  - [x] 2.8 Implement offline detection (expo-network), queue messages locally, and sync on reconnection
    - **✅ FIXED:** Network monitor now triggers WebSocket reconnection when network returns
    - **✅ FIXED:** Offline messages sync automatically after successful reconnection
    - **✅ TESTED:** Messages sent while offline queue and sync when network returns
  - [x] 2.9 Add conversation metadata endpoints: create conversation, list conversations, fetch conversation details from D1
    - **✅ FIXED:** History now requested on every reconnection (catches missed messages)
    - **✅ TESTED:** REST endpoints working (POST /api/conversations, GET /api/conversations?userId=X, GET /api/conversations/:id)

- [x] **3.0 Group Chat & Advanced Messaging Features** ✅ COMPLETE
  - [x] 3.1 Implement SHA-256 conversation ID hashing for scalable group IDs (backward compatible with 1-on-1)
  - [x] 3.2 Update message schema to include sender attribution and display sender names in group chat UI
  - [x] 3.3 Create group conversation creation flow with multi-user picker, group name input, and type selector
    - **✓ TEST READY:** Create group with 3+ users via comma-separated user IDs
  - [x] 3.4 Enhance read receipts UI with colored status indicators (blue checkmarks for read, gray for sent)
    - **✓ IMPLEMENTED:** Colored checkmarks, visible status updates
  - [x] 3.5 Implement presence system: online/offline tracking in Durable Object, broadcast presence events, show online count in UI
    - **✅ TESTED READY:** Online users tracked, presence updates broadcast, UI shows "X online" for groups
  - [x] 3.6 Deploy backend with all group chat features enabled
    - **✅ DEPLOYED:** https://messageai-worker.abdulisik.workers.dev (Version: e1e242df)

- [ ] **4.0 Push Notifications & MVP Deployment**
  - [ ] 4.1 Set up Expo Notifications: install expo-notifications, configure app.json permissions, request notification permissions on app launch
    - **✓ TEST:** Accept notification permission, verify token generated
  - [ ] 4.2 Implement foreground notification handling: show notification when message received while app is open
    - **✓ TEST:** Have app open, receive message, verify notification banner appears
  - [ ] 4.3 Add notification trigger in Worker: when broadcasting message, send push notification to offline/backgrounded users via Expo Push API
    - **✓ TEST:** Background the app, send message from another device, verify notification received
  - [ ] 4.4 Deploy Cloudflare Workers to production: run wrangler deploy, verify D1 migrations applied, test WebSocket endpoint
    - **✓ TEST:** Connect to production WebSocket URL, verify connection successful
  - [ ] 4.5 Deploy Expo app to Expo Go: run eas build or expo publish, generate QR code, test on two physical devices
    - **✓ TEST:** Two physical devices chatting in real-time on production backend
  - [ ] 4.6 Run final MVP verification: all 11 features working, all 7 test scenarios passing, fix critical bugs
    - **✓ TEST:** Complete checklist: ✅ Auth ✅ 1-on-1 ✅ Persistence ✅ Optimistic UI ✅ Status ✅ Timestamps ✅ Groups ✅ Receipts ✅ Notifications ✅ Deployed backend ✅ Deployed app
  - [ ] 4.7 Document deployment steps in README with setup instructions for running locally and deploying

### Post-MVP Phase (Days 2-7)

- [ ] 5.0 **Media Support & Enhanced UX**
- [ ] 6.0 **AI Features for Remote Team Professional**

---

**Status:** Phase 3.0 Complete! ✅ 

**Phase 3 Achievements (Oct 22, 2025):**
- ✅ **SHA-256 Conversation Hashing**: Scalable group IDs using crypto hashing for 3+ participants
- ✅ **Group Chat UI**: Type selector (Direct/Group), group name input, multi-user picker with comma-separated IDs
- ✅ **Sender Attribution**: Messages in group chats show sender names above bubbles
- ✅ **Presence Tracking**: Real-time online/offline status tracking in Durable Objects
- ✅ **Presence UI**: Online user count displayed in group chat headers ("X online")
- ✅ **Enhanced Read Receipts**: Colored status indicators (blue ✓✓ for read, gray for sent, red ! for failed)
- ✅ **Backend Deployed**: All features live at https://messageai-worker.abdulisik.workers.dev

**Architecture Enhancements:**
- 🔧 Unified architecture: Self-chat, 1-on-1, and group chat use the same infrastructure
- 🔧 Deterministic IDs: Simple concat for 1-2 users, SHA-256 hash for 3+ (backward compatible)
- 🔧 Presence broadcasts: Join/leave events automatically sent to all connected participants
- 🔧 Type-safe WebSocket protocol: ConnectedEvent now includes onlineUserIds list
- 🔧 Local-first with sync: Presence and read receipts persist to SQLite for offline viewing

**Group Chat Features Implemented:**
1. ✅ Create groups with 3+ participants
2. ✅ Custom group names
3. ✅ Sender names displayed on messages
4. ✅ Real-time online user tracking
5. ✅ Broadcast messaging to all participants
6. ✅ Read receipt tracking per user

**Testing Ready:**
- Create group chat with 3+ users (comma-separated user IDs)
- Send messages and verify sender names appear
- Check online user count updates when participants join/leave
- Verify colored checkmarks (gray → blue when read)

**Next Phase:** Phase 4.0 - Push Notifications & Final MVP Deployment

**Known Limitations (to be addressed in Phase 4):**
- Messages only received when chat is open (background messages require push notifications)
- No user search/directory (currently paste user IDs manually)