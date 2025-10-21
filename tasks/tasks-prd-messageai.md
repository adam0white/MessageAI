# Task List: MessageAI

**Generated from:** `prd-messageai.md`  
**Date:** October 21, 2025  
**Timeline:** 7 days (MVP: 24 hours)

---

## Relevant Files

### Frontend (Expo App)
- `app/_layout.tsx` - Root layout with providers (Clerk, React Query)
- `app/(auth)/sign-in.tsx` - Sign-in screen
- `app/(auth)/sign-up.tsx` - Sign-up screen
- `app/(app)/index.tsx` - Conversation list screen
- `app/(app)/chat/[id].tsx` - Chat screen (dynamic route)
- `app/(app)/new-conversation.tsx` - Create conversation screen
- `lib/db/schema.ts` - SQLite schema definitions
- `lib/db/queries.ts` - Database query helpers
- `lib/api/websocket.ts` - WebSocket client and connection management
- `lib/api/types.ts` - Shared types for client-server communication
- `lib/stores/auth.ts` - Zustand store for auth state
- `lib/stores/network.ts` - Zustand store for network status
- `hooks/useMessages.ts` - React Query hook for message state
- `hooks/useConversations.ts` - React Query hook for conversation state
- `components/MessageBubble.tsx` - Individual message component
- `components/ConversationListItem.tsx` - Conversation preview component

### Backend (Cloudflare Workers)
- `worker/src/index.ts` - Main Worker entry point (WebSocket upgrade, routing)
- `worker/src/durable-objects/Conversation.ts` - Durable Object for conversation rooms
- `worker/src/db/schema.ts` - D1 database schema
- `worker/src/db/migrations/` - D1 migration files
- `worker/src/types/` - Shared types (synced with frontend)
- `worker/src/handlers/auth.ts` - Clerk webhook handler
- `worker/src/handlers/notifications.ts` - Push notification sender
- `worker/wrangler.toml` - Cloudflare configuration

### Shared
- `shared/types.ts` - Shared TypeScript types between client and server

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

- [ ] **1.0 Foundation & Authentication Setup**
  - [ ] 1.1 Initialize Expo project with TypeScript template and configure app.json with proper bundle identifier and app name
    - **✓ TEST:** Run `npx expo start`, scan QR code with Expo Go, see default app on phone
  - [ ] 1.2 Initialize Cloudflare Workers project with Wrangler, set up TypeScript, and configure wrangler.toml with Durable Objects bindings
  - [ ] 1.3 Create shared types structure (`shared/types.ts`) for WebSocket messages, Message, Conversation, and User models
  - [ ] 1.4 Set up Expo SQLite database with schema for messages, conversations, and read_receipts tables
  - [ ] 1.5 Create D1 database, write migration files for users, conversations, and conversation_participants tables
  - [ ] 1.6 Integrate Clerk in Expo app (install @clerk/clerk-expo, configure ClerkProvider, create sign-in/sign-up screens)
    - **✓ TEST:** Sign up with email, see authenticated state, sign out, sign back in
  - [ ] 1.7 Set up Clerk webhook handler in Worker to sync user data to D1 when users sign up
  - [ ] 1.8 Install and configure React Query v5 and Zustand v5 with providers in root layout
  - [ ] 1.9 Build basic UI screens: conversation list skeleton with navigation, protected routes using Clerk
    - **✓ TEST:** Navigate between screens, verify protected routes redirect to sign-in when logged out

- [ ] **2.0 Real-Time Messaging Infrastructure**
  - [ ] 2.1 Create Durable Object class for Conversation with WebSocket accept handler and in-memory connection tracking
    - **✓ TEST:** Deploy Worker, test WebSocket connection with a WebSocket client tool (wscat or Postman)
  - [ ] 2.2 Implement WebSocket upgrade endpoint in Worker that routes to correct Durable Object by conversation ID
  - [ ] 2.3 Build WebSocket client module in Expo (`lib/api/websocket.ts`) with connection, reconnection, and message handling
  - [ ] 2.4 Implement SQLite storage in Durable Object for messages with schema and basic CRUD operations
  - [ ] 2.5 Create message sending flow: optimistic SQLite write → UI update → WebSocket send → server confirmation → status update
  - [ ] 2.6 Implement message receiving: WebSocket listener → SQLite write → React Query cache invalidation → UI update
  - [ ] 2.7 Build chat screen UI with message list (FlatList), input field, send button, and timestamp display
    - **✓ TEST:** Send message, see it appear in UI with timestamp, force-quit app, reopen, verify message persisted
  - [ ] 2.8 Implement offline detection (expo-network), queue messages locally, and sync on reconnection
    - **✓ TEST:** Enable airplane mode, send message, disable airplane mode, verify message syncs to server
  - [ ] 2.9 Add conversation metadata endpoints: create conversation, list conversations, fetch conversation details from D1
    - **✓ TEST:** Create new conversation, see it in list, open it, send first message between two devices in real-time

- [ ] **3.0 Group Chat & Advanced Messaging Features**
  - [ ] 3.1 Extend Durable Object to handle N participants (track multiple WebSocket connections, broadcast to all)
  - [ ] 3.2 Update message schema to include sender attribution and display sender names in group chat UI
  - [ ] 3.3 Create group conversation creation flow (select multiple users, create in D1, initialize Durable Object)
    - **✓ TEST:** Create group with 3 users, send message from one device, verify it appears on all 3 devices
  - [ ] 3.4 Implement read receipts: track in Durable Object SQLite, send read events via WebSocket, update UI with read status
    - **✓ TEST:** Send message, verify "sent" status, open on recipient device, verify sender sees "read" status
  - [ ] 3.5 Implement presence system: online/offline detection in Durable Object, broadcast presence updates, show indicators in UI
    - **✓ TEST:** Open app on Device A, verify online indicator on Device B, close app on Device A, verify offline on Device B
  - [ ] 3.6 Test all 7 scenarios: real-time chat, offline→online, backgrounded, force-quit, poor network, rapid messages, group chat
    - **✓ TEST:** Run through all 7 testing scenarios systematically, document any failures

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

**Status:** MVP sub-tasks generated. Post-MVP tasks remain high-level.

