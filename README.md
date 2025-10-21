# MessageAI

A production-quality real-time messaging app built with Expo and Cloudflare Workers, featuring AI-enhanced capabilities.

## 🎯 Project Status

**Phase 1.0: Foundation & Authentication** ✅ **COMPLETE**

All 9 foundation tasks completed and tested.

## 🚀 Quick Start

See [SETUP.md](./SETUP.md) for detailed setup instructions.

```bash
# Install dependencies
npm install
cd worker && npm install && cd ..

# Set up environment variables (see ENV_SETUP.md)
cp .env.example .env
# Edit .env with your Clerk keys

# Start development
npm start              # Frontend (Expo)
cd worker && npm run dev  # Backend (Worker)
```

## 📱 Features (Phase 1.0)

### Frontend
- ✅ Expo SDK 54 with TypeScript
- ✅ Clerk Authentication (email/password)
- ✅ SQLite Database (offline-first)
- ✅ React Query v5 (server state)
- ✅ Zustand v5 (app state)
- ✅ Expo Router (file-based navigation)
- ✅ Protected Routes
- ✅ Conversation List UI

### Backend
- ✅ Cloudflare Workers + Durable Objects
- ✅ D1 Database (users, conversations)
- ✅ Clerk Webhook Handler
- ✅ WebSocket Infrastructure
- ✅ Type-Safe APIs

## 🏗️ Architecture

```
[Expo App (React Native)]
    ↕ WebSocket (JSON)
[Cloudflare Worker] ← Routes to Durable Objects
    ↕ Workers RPC
[Durable Object: Conversation] ← One per conversation
    ↕ SQLite
[DO Storage] ← Messages, read receipts

Worker also uses:
├─ D1 (User profiles, conversation metadata)
├─ Clerk (Authentication)
└─ Expo Push API (Notifications)
```

## 📂 Project Structure

```
messageAI/
├── app/                          # Expo Router screens
│   ├── _layout.tsx              # Root with providers
│   ├── index.tsx                # Auth redirect
│   ├── auth/                    # Auth screens
│   │   ├── sign-in.tsx
│   │   └── sign-up.tsx
│   └── (app)/                   # Protected app routes
│       ├── _layout.tsx
│       └── index.tsx            # Conversation list
├── lib/                         # Frontend libraries
│   ├── api/                     # API client & types
│   ├── db/                      # SQLite schema & queries
│   └── stores/                  # Zustand stores
├── worker/                      # Cloudflare Worker
│   └── src/
│       ├── index.ts             # Main entry point
│       ├── durable-objects/     # Durable Object classes
│       ├── db/                  # D1 schema & migrations
│       ├── handlers/            # Webhook handlers
│       └── types/               # Backend types
├── shared/                      # Shared types
│   └── types.ts                 # Client-server types
└── tasks/                       # Task tracking
    └── tasks-prd-messageai.md
```

## 🛠️ Tech Stack

**Frontend:**
- React Native (Expo SDK 54)
- TypeScript 5.9
- Expo Router (navigation)
- React Query v5 (server state)
- Zustand v5 (app state)
- Expo SQLite (local storage)
- Clerk (authentication)

**Backend:**
- Cloudflare Workers
- Durable Objects (WebSocket rooms)
- D1 Database (metadata)
- TypeScript 5.9

## 📚 Documentation

- [SETUP.md](./SETUP.md) - Setup and installation
- [ENV_SETUP.md](./ENV_SETUP.md) - Environment variables
- [COMMIT_CHECKLIST.md](./COMMIT_CHECKLIST.md) - Pre-commit checks
- [tasks/tasks-prd-messageai.md](./tasks/tasks-prd-messageai.md) - Task tracking

## 🧪 Testing

### Manual Testing (Phase 1.0)
- ✅ App loads on phone via Expo Go
- ✅ Sign up with email (no verification in dev)
- ✅ Sign in with credentials
- ✅ Sign out redirects to auth
- ✅ Protected routes work
- ✅ Navigation between screens

### Development Health Checks
```bash
# Frontend
npx expo-doctor
# Should pass all checks

# Backend
cd worker && npm run dev
curl http://localhost:8787
# Should return "MessageAI Worker is running!"
```

## 🎯 Roadmap

### Phase 1.0 ✅ (COMPLETE)
- Foundation & Authentication Setup

### Phase 2.0 🔜 (Next)
- Real-Time Messaging Infrastructure
- WebSocket connections
- Message persistence
- Chat UI
- Offline queue

### Phase 3.0
- Group Chat & Advanced Features
- Read receipts
- Presence tracking
- Testing scenarios

### Phase 4.0
- Push Notifications & Deployment
- Production deployment
- Final MVP verification

### Post-MVP
- AI Features for Remote Team Professional
- Media support

## 📝 Development Notes

### React Version
React is locked at **19.1.0** to match React Native 0.81.4. Do not upgrade React manually.

### Dependencies
Always use `npx expo install <package>` for Expo-compatible versions.

### Environment Variables
Never commit `.env` files. See [ENV_SETUP.md](./ENV_SETUP.md) for configuration.

## 🤝 Contributing

This is a time-boxed project (7 days) with strict requirements. See the PRD in [prd-messageai.md](./prd-messageai.md).

## 📄 License

[Your License Here]
