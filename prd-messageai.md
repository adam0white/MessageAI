# Product Requirements Document: MessageAI

**Version:** 1.0  
**Date:** October 21, 2025  
**Project Timeline:** 7 days (MVP: 24 hours)  
**Target Platform:** React Native with Expo  

---

## Introduction

MessageAI is a production-quality, real-time messaging application inspired by WhatsApp's reliability and speed, enhanced with AI-powered features tailored for remote team professionals. The app enables instant messaging between users with robust offline support, optimistic UI updates, and intelligent assistance for managing team communications.

**The Core Problem:** Modern messaging apps either lack reliability (messages get lost, poor offline support) or lack intelligence (no help managing information overload, context switching, or extracting actionable insights from conversations).

**Our Solution:** Build a rock-solid messaging foundation first, then layer AI capabilities that help remote teams work more effectively—summarizing threads, extracting action items, and proactively assisting with coordination.

---

## Goals

### Primary Goals
1. **Deliver a reliable MVP in 24 hours** with all 11 core messaging features working end-to-end
2. **Never lose messages** - Messages must persist through crashes, offline scenarios, and poor network conditions
3. **Instant UI responsiveness** - Optimistic updates make the app feel native and fast
4. **Pass all 7 testing scenarios** defined in the assignment document
5. **Deploy to Expo Go** with a live Cloudflare Workers backend

### Post-MVP Goals (Days 2-7)
1. Implement 5 required AI features for Remote Team Professional persona
2. Build 1 advanced AI capability (Proactive Assistant)
3. Add media support (images, profile pictures)
4. Achieve basic automated test coverage
5. Polish UI/UX for demo video quality

---

## User Stories

### Core Messaging (MVP)

**As a user**, I want to:
- Create an account and sign in securely so my messages are private and persistent
- Send text messages to another user and see them appear instantly in the conversation
- See my message history even when offline so I can reference past conversations
- Know when my messages have been sent and read by recipients
- See when other users are online or offline
- Chat with multiple people in a group conversation (3+ users)
- Receive notifications when new messages arrive while the app is open

### Post-MVP: AI Features for Remote Team Professional

**As a remote team professional**, I want to:
- Get automatic summaries of long conversation threads so I can catch up quickly
- See extracted action items from my team chats so nothing falls through the cracks
- Search conversations intelligently (semantic search) to find relevant context
- Identify priority messages automatically so I focus on what matters
- Track decisions made in conversations so I have a clear record
- Have the AI proactively suggest meeting times when it detects scheduling discussions (advanced feature)

---

## Functional Requirements

### MVP Requirements (24 Hours - Hard Gate)

These 11 features are non-negotiable for MVP completion:

#### 1. User Authentication
- Users must be able to create accounts using Clerk authentication
- Users must be able to sign in and sign out
- User sessions must persist across app restarts
- The app must sync user profile data (name, user ID) from Clerk to the D1 database

#### 2. One-on-One Chat Functionality
- Users must be able to start a conversation with another user
- Users must be able to view a list of their conversations
- Selecting a conversation must open a chat screen showing message history

#### 3. Real-Time Message Delivery
- When User A sends a message, User B must receive it in real-time (within 1 second on good network)
- Messages must be delivered to all online participants in a conversation
- The system must use WebSocket connections between the Expo app and Cloudflare Workers

#### 4. Message Persistence
- Messages must be stored locally in Expo SQLite
- Users must see their complete message history when opening a conversation, even offline
- Messages must survive app force-quit and restart
- The app must work completely offline (read-only mode for existing messages)

#### 5. Optimistic UI Updates
- When a user sends a message, it must appear immediately in the chat UI
- The message must show a "sending" status initially
- The status must update to "sent" when the server confirms receipt
- If sending fails, the user must see an error state and option to retry

#### 6. Online/Offline Status Indicators
- Users must see whether conversation participants are currently online or offline
- Status must update in real-time when participants connect/disconnect
- The app must detect its own network connectivity status

#### 7. Message Timestamps
- Every message must display a timestamp showing when it was sent
- Timestamps must be accurate and timezone-aware
- Messages from the same day should group timestamps appropriately

#### 8. Basic Group Chat
- Users must be able to create group conversations with 3 or more participants
- All participants in a group must receive messages in real-time
- Group messages must show sender attribution (who sent each message)
- Group conversations must have no participant limit for MVP

#### 9. Message Read Receipts
- When a user views a message, the sender must see a read receipt
- In 1-on-1 chats, show "Read" status when the recipient has seen the message
- In group chats, track read status per participant
- Read receipts must persist and sync across devices

#### 10. Push Notifications (Foreground)
- Users must receive notifications for new messages when the app is in the foreground
- Notifications must use Expo's Notifications API
- Background/killed app notifications are deferred to post-MVP

#### 11. Deployment
- The Expo app must run on iOS and Android via Expo Go
- The Cloudflare Workers backend must be deployed and accessible
- Two physical test devices must be able to message each other in real-time

### Post-MVP Requirements (Days 2-7)

Brief overview of features to implement after MVP:

#### Media Support
- Image upload and display in conversations
- Profile picture support
- Media stored in Cloudflare R2

#### Delivery State Indicators
- Typing indicators (show when someone is typing)
- Enhanced delivery states: sending → sent → delivered → read

#### AI Features (Remote Team Professional Persona)

**Required AI Features (5):**
1. Thread summarization - Summarize long conversations on demand
2. Action item extraction - Identify and list action items from chats
3. Smart search - Semantic search across message history
4. Priority message detection - Flag important/urgent messages
5. Decision tracking - Extract and track decisions made in conversations

**Advanced AI Capability (1):**
- Proactive Assistant - Auto-detects scheduling discussions and suggests meeting times based on context

#### Testing & Quality
- Automated test coverage using Jest and React Native Testing Library
- E2E tests for critical paths (send message, offline sync)

#### Additional Features (Time Permitting)
- Message editing and deletion
- Custom reactions/emoji
- Voice/video calls (using Cloudflare Realtime Kit)
- End-to-end encryption (research required)

---

## Non-Goals (Out of Scope)

The following are explicitly **NOT** included in the initial release:

### Definitely Out of Scope
- Desktop applications (web, Windows, macOS)
- Message backup to cloud storage
- Stickers or GIF support
- Voice messages
- Location sharing
- Payment/commerce features
- App-to-app message forwarding

### Deferred for Research/Future Consideration
- End-to-end encryption (complex, needs research)
- Video/voice calls (interest in Cloudflare Realtime Kit, but post-week 1)
- Message editing/deletion (maybe, needs design consideration)
- Custom emoji/reactions (nice-to-have)

### Technical Non-Goals
- Supporting web browsers (mobile-only via Expo)
- Offline message sending queue with conflict resolution if possible (reconnection fetches missed messages instead)
- Admin/moderation tools
- Analytics dashboard

---

## Design Considerations

### Design Philosophy
- **Modern but minimal** - Clean interface, not cluttered
- **Prioritize development speed** - Use proven UI patterns and existing component libraries
- **Prior art over custom design** - Reference established messaging apps (WhatsApp, Telegram, Signal) for UX patterns

### UI Guidelines
- Use Expo's recommended UI component library for consistency
- Follow platform conventions (iOS Human Interface Guidelines, Material Design for Android)
- Ensure accessibility (readable text, sufficient touch targets)
- Support both light and dark themes if time permits

### Key Screens
1. **Authentication Screen** - Sign in/sign up using Clerk
2. **Conversation List** - Shows all conversations with last message preview, timestamps, unread counts
3. **Chat Screen** - Message thread with input field, send button, timestamps, read receipts
4. **New Conversation Screen** - Select contacts to start 1-on-1 or group chat
5. **Group Info Screen** - View participants, conversation settings

### Visual Hierarchy
- Active conversations at top
- Unread messages prominently highlighted
- Own messages aligned right, others aligned left
- Clear visual distinction between sending/sent/read states

---

## Technical Considerations

### Architecture Overview

**Frontend:**
- React Native with Expo (TypeScript)
- Expo Router for navigation
- Expo SQLite for local storage
- React Query for server state management
- Zustand for app state management
- Clerk Expo SDK for authentication
- WebSocket for real-time communication

**Backend:**
- Cloudflare Workers (entry point, routing)
- Cloudflare Durable Objects (conversation rooms with WebSocket + SQLite storage)
- Cloudflare D1 (user profiles and conversation metadata)
- Cloudflare R2 (media storage, post-MVP)
- Workers RPC for Worker ↔ Durable Object communication

### State Management Strategy
- **React Query**: Server state (messages from Durable Objects, user data from D1)
- **Zustand**: App state (current user, draft messages, UI toggles, network status)
- **SQLite**: Local-first storage (messages, conversations, read receipts)

### Communication Protocol
- Client ↔ Worker: WebSocket with JSON messages
- Worker ↔ Durable Object: Workers RPC (type-safe, built-in)
- Shared TypeScript types for type safety across client and server

### Data Flow Pattern: Local-First
1. User action triggers immediate local SQLite write
2. UI updates from local data (instant feedback)
3. WebSocket sends update to server
4. Server confirms and broadcasts to other clients
5. Clients receive updates and merge with local SQLite

### Key Technical Decisions
- **Durable Objects for chat rooms**: One DO per conversation handles all messages and connections for that conversation
- **No traditional REST API**: Real-time messaging over WebSocket, metadata queries can use Workers RPC
- **Expo Go for deployment**: Fastest path to testing on physical devices
- **TypeScript everywhere**: Shared types between client and Workers for type safety

### Dependencies & Integrations
- Clerk for authentication (webhooks to sync user data to D1)
- Expo Notifications API for push notifications
- Expo NetInfo for network status detection
- Shared TypeScript types between mobile and Workers

### Performance Considerations
- Messages load from local SQLite first (instant)
- Background sync from Durable Objects for new messages
- Pagination for long conversation histories
- WebSocket reconnection with exponential backoff

### Scalability Considerations
- Durable Objects can handle 1000 RPS per conversation (more than sufficient)
- D1 limit of 10GB is acceptable for user profiles
- Each conversation is isolated in its own Durable Object (natural sharding)

---

## Success Metrics

### MVP Success Criteria (24 Hours)
- ✅ All 11 MVP features implemented and functional
- ✅ All 7 testing scenarios pass successfully:
  1. Two physical devices chatting in real-time
  2. One device offline → receives messages → comes online
  3. Messages sent while app is backgrounded
  4. App force-quit and reopened (persistence verified)
  5. Poor network conditions (airplane mode, throttled connection)
  6. Rapid-fire messages (20+ sent quickly without loss)
  7. Group chat with 3+ participants working smoothly
- ✅ Backend deployed to Cloudflare Workers
- ✅ App deployable to Expo Go and testable on physical devices

### Post-MVP Success Criteria (Days 2-7)
- ✅ Remote Team Professional persona fully implemented
- ✅ All 5 required AI features working with real LLM integration
- ✅ 1 advanced AI capability (Proactive Assistant) functional
- ✅ Media support (images, profile pictures) working
- ✅ Basic automated test coverage for critical paths
- ✅ Demo video (5-7 minutes) showcasing all features
- ✅ GitHub repository with comprehensive README

### Quality Metrics (Aspirational)
- Zero message loss across all testing scenarios
- WebSocket reconnection successful within 3 seconds of connectivity restoration
- UI updates feel instant (optimistic updates working correctly)
- No crashes during demo video recording

---

## Testing Strategy

### Development Testing (Continuous)
- Use Expo development tools for hot reload and debugging
- Test on physical iOS and Android devices from day 1 (not simulators)
- Two developers/testers messaging each other to validate real-time features
- Use Expo Go for rapid iteration

### Manual Testing Scenarios (Before MVP Completion)
Run through all 7 scenarios defined in the assignment:
1. Real-time chat between two devices
2. Offline → online message sync
3. Backgrounded app message receipt
4. Force-quit persistence
5. Airplane mode / poor network handling
6. Rapid message sending (stress test)
7. Group chat with 3+ participants

### Post-MVP: Automated Testing
- Jest + React Native Testing Library for component tests
- Test critical paths: sending messages, optimistic updates, offline sync
- Mock WebSocket connections for unit tests
- E2E tests using Detox or Maestro (if time permits)

---

## Implementation Phases

### Phase 0: Setup & Foundation (Hours 1-3)
- Initialize Expo project with TypeScript
- Set up Cloudflare Workers project
- Configure Clerk authentication
- Set up Expo SQLite and basic data models
- Create shared TypeScript types

### Phase 1: Basic UI & Text Messaging (Hours 4-8)
- Build conversation list screen
- Build chat screen with message display
- Implement local message sending (no server yet)
- Add optimistic UI updates with local SQLite

### Phase 2: Authentication (Hours 9-11)
- Integrate Clerk Expo SDK
- Build sign-in/sign-up screens
- Sync user data to D1 via Clerk webhooks
- Protect routes requiring authentication

### Phase 3: Real-Time 1-on-1 Chat (Hours 12-16)
- Set up Cloudflare Worker with WebSocket endpoint
- Create Durable Object for conversations
- Implement WebSocket message protocol
- Connect Expo app to Workers via WebSocket
- Store messages in Durable Object SQLite
- Broadcast messages to connected clients

### Phase 4: Group Chat (Hours 17-19)
- Extend Durable Object to support N participants
- Update UI to show sender names in group messages
- Test with 3+ participants

### Phase 5: Read Receipts & Presence (Hours 20-22)
- Implement read receipt tracking in Durable Objects
- Add online/offline presence detection
- Update UI to show read status and online indicators

### Phase 6: Push Notifications (Hours 23-24)
- Integrate Expo Notifications API
- Implement foreground notifications
- Test notification delivery

### Phase 7: Testing & Deployment (End of Day 1)
- Run all 7 testing scenarios
- Fix critical bugs
- Deploy Workers to Cloudflare
- Deploy Expo app to Expo Go
- Verify two devices can communicate

### Phase 8: Media Support (Day 2)
- Set up Cloudflare R2 bucket
- Implement image upload from Expo
- Display images in chat
- Add profile picture support

### Phase 9: AI Integration (Days 3-6)
- Research and choose LLM provider (OpenAI/Anthropic)
- Set up Cloudflare Vectorize for message embeddings
- Implement 5 required AI features
- Build Proactive Assistant advanced capability
- Test AI features thoroughly

### Phase 10: Testing & Polish (Day 7)
- Add automated test coverage
- UI/UX polish
- Performance optimization
- Record demo video
- Write persona brainlift document
- Finalize README and documentation

---

## Open Questions

### Pre-Development Questions
1. Should we create a shared TypeScript package for types, or duplicate types between client and server?
2. What should the conversation creation UX be? (Contact list? Enter username? QR code?)
3. Should group chats have names/titles, or just show participant list?
4. How should we handle conversation discovery? (User directory? Invite links?)

### Technical Questions for Research
1. What's the best approach for WebSocket reconnection in React Native with Expo?
2. How do we handle message deduplication when syncing from both local SQLite and server?
3. Should we batch read receipts or send immediately on message view?
4. What's the optimal pagination size for message history?
5. How do we generate unique conversation IDs? (UUID on client or server?)

### AI Feature Questions (Post-MVP)
1. Which LLM provider gives best results for action item extraction?
2. How do we handle LLM rate limits and costs during development?
3. Should RAG use conversation-level or user-level vector database?
4. How do we cache AI responses to reduce API costs?

### Design Questions
1. What should the app icon look like?
2. Color scheme preferences beyond "modern and minimal"?
3. Should we show "last seen" timestamps for offline users?

---

## Appendix: Assignment Requirements Checklist

### MVP Must-Haves (24 Hours)
- [ ] One-on-one chat functionality
- [ ] Real-time message delivery between 2+ users
- [ ] Message persistence (survives app restarts)
- [ ] Optimistic UI updates (messages appear instantly)
- [ ] Online/offline status indicators
- [ ] Message timestamps
- [ ] User authentication (Clerk)
- [ ] Basic group chat functionality (3+ users)
- [ ] Message read receipts
- [ ] Push notifications (foreground minimum)
- [ ] Deployment (Expo Go + deployed backend)

### Testing Scenarios
- [ ] Two devices chatting in real-time
- [ ] Offline → online sync
- [ ] Messages while backgrounded
- [ ] Force-quit persistence
- [ ] Poor network conditions
- [ ] Rapid-fire messages (20+)
- [ ] Group chat with 3+ participants

### Final Submission Requirements
- [ ] GitHub repository with README
- [ ] Demo video (5-7 minutes)
- [ ] Deployed application (Expo Go link)
- [ ] Persona brainlift document
- [ ] Social post (X/LinkedIn)

---

**End of PRD**

