# Quick Setup Guide

*For anyone who wants to run this locally or deploy their own*

---

## Prerequisites

- Node.js 18+
- Cloudflare account (free tier works)
- Clerk account (free tier works)
- iOS/Android device with Expo Go app

---

## Frontend Configuration

**File:** `lib/config.ts`

```typescript
export const config = {
  clerkPublishableKey: 'pk_test_YOUR_KEY_HERE',
  workerUrl: 'https://your-worker.workers.dev',  // or custom domain
} as const;
```

**Get Clerk Key:**
1. Create app at clerk.com
2. Dashboard → API Keys → Publishable key
3. Disable email verification in Settings → Email/SMS (for dev)

---

## Backend Configuration

**File:** `worker/wrangler.jsonc`

### Required Changes:

1. **Custom Domain** (or remove):
```json
"routes": [
  {
    "pattern": "your-domain.com",  // Change this
    "custom_domain": true
  }
]
```

Or use workers.dev subdomain:
```json
"workers_dev": true,
// Remove routes array
```

2. **D1 Database** (create new):
```bash
cd worker
npx wrangler d1 create messageai-db
```

Copy the database_id into wrangler.jsonc:
```json
"d1_databases": [{
  "database_id": "YOUR_ID_HERE"  // Replace
}]
```

3. **Vectorize Index** (create new):
```bash
npx wrangler vectorize create messageai-embeddings --dimensions=768 --metric=cosine
```

Update index_name if you used different name.

4. **AI Gateway** (optional but recommended):
- Create at Cloudflare Dashboard → AI → AI Gateway
- Name it (e.g., "messageai-gateway")
- Update gateway ID in `worker/src/durable-objects/Conversation.ts` if different from "aw-cf-ai"

---

## Database Migrations

```bash
cd worker

# Run migrations (do this ONCE per database)
npx wrangler d1 execute messageai-db --remote --file=src/db/migrations/0001_initial_schema.sql
npx wrangler d1 execute messageai-db --remote --file=src/db/migrations/0002_add_push_tokens.sql
npx wrangler d1 execute messageai-db --remote --file=src/db/migrations/0003_add_message_metadata.sql
```

---

## Clerk Webhook (Optional)

**Purpose:** Sync user signups to D1 database

**Setup:**
1. Clerk Dashboard → Webhooks
2. Endpoint URL: `https://your-worker-url.com/webhooks/clerk`
3. Subscribe to: `user.created`, `user.updated`
4. Copy signing secret (not needed - webhook is open for demo)

**Note:** App works without this - users auto-created on first message

---

## Running Locally

### Backend (Already Deployed):
Backend is already live at `https://message.adamwhite.work`

**For your own deployment:**
```bash
cd worker
npm install
# Create D1 database and Vectorize index
# Run migrations
# Update wrangler.jsonc with your database_id
npm run deploy
```

### Frontend:
```bash
npm install
# Update lib/config.ts with Clerk key
npm start
# Scan QR with Expo Go
```

### Local Development Workflow:

**Web (fastest iteration):**
```bash
npm run web  # Opens http://localhost:8081
```
- ✅ Fast refresh, Chrome DevTools
- ✅ Works with deployed backend
- ⚠️ Some features behave differently (notifications)

**iOS Simulator:**
```bash
npm start
# Press 'i' for iOS simulator
```
- ✅ Full native features
- ⚠️ Haptics don't work (only on physical device)
- ⚠️ Video calls may be unstable

**Android Emulator:**
```bash
npm start
# Press 'a' for Android emulator
```

**Physical Device (recommended):**
```bash
npm start
# Scan QR with Expo Go app
```
- ✅ All features work correctly
- ✅ Real performance testing
- ✅ Push notifications work

---

## Deployment

### Backend (Cloudflare Workers):
```bash
cd worker

# Deploy to production
npm run deploy

# Output: Deployment URL
# Example: https://messageai-worker.YOUR_NAME.workers.dev
```

**Custom Domain (optional):**
1. Cloudflare Dashboard → Workers & Pages → Your Worker → Settings → Domains & Routes
2. Add custom domain (e.g., `message.example.com`)
3. Update `worker/wrangler.jsonc`:
```json
"routes": [
  { "pattern": "message.example.com", "custom_domain": true }
],
"workers_dev": false
```

### Frontend (Expo):

**Option 1: Expo Go (Development/Testing)**
```bash
npm start
# Share QR code link with testers
```
- ✅ No build needed
- ✅ Instant updates
- ⚠️ Development build only
- ⚠️ Clerk dev keys work

**Option 2: Development Build**
```bash
npx expo install expo-dev-client
eas build --profile development --platform ios
```
- ✅ Native modules included
- ✅ Better debugging

**Option 3: Production Build (iOS)**
```bash
# Install EAS CLI
npm install -g eas-cli

# Login to Expo
eas login

# Configure
eas build:configure

# Build for iOS
eas build --platform ios --profile production

# Submit to TestFlight
eas submit --platform ios
```

**Option 4: Production Build (Android)**
```bash
# APK (direct install)
eas build --platform android --profile production

# Download .apk from build output
# Share APK file with users
```

**Option 5: Web Deployment**
```bash
# Build and deploy (web assets served from Worker)
npm run web:deploy

# Output: https://message.adamwhite.work (same domain as backend)
```

### Production Checklist:
- [ ] Update `lib/config.ts` → Set `IS_PRODUCTION = true`
- [ ] Replace Clerk test key with production key (`pk_live_...`)
- [ ] Verify `workerUrl` points to production worker
- [ ] Test on multiple devices
- [ ] Enable Clerk production mode (Settings → Environment)
- [ ] Set up Clerk webhook to production URL
- [ ] Monitor usage in Cloudflare Dashboard

---

## Common Issues

**"Failed to connect to WebSocket"**
→ Check workerUrl in lib/config.ts matches deployed worker

**"Clerk authentication failed"**
→ Verify clerkPublishableKey matches your Clerk app

**"Messages not persisting"**
→ Run D1 migrations (see above)

**"AI features error"**
→ Check Workers AI binding exists, Vectorize index created

---

## Cost Breakdown (Free Tier Limits)

- **Cloudflare Workers:** 100K req/day free
- **Durable Objects:** 1M requests/month free
- **Workers AI:** 10K neurons/day free (enough for testing)
- **Vectorize:** 5M queries/month free
- **D1:** 5GB storage free
- **Clerk:** 10K MAU free

**Realistic usage:** Free tier handles ~100 active users easily

---

## What You'll Need to Change (Minimal)

1. ✏️ `lib/config.ts` - Clerk key, worker URL
2. ✏️ `worker/wrangler.jsonc` - D1 database_id, domain/route
3. 🏃 Run D1 migrations (one-time)
4. 🏃 Create Vectorize index (one-time)
5. 🚀 Deploy worker

**That's it.** No .env files, no complex config, no external services.

---

## Testing Your Deployment

### 1. Backend Health Check:
```bash
# Test REST API
curl https://your-worker-url.com/api/conversations?userId=test

# Should return: {"conversations": []}
```

### 2. WebSocket Test:
```bash
# Install wscat
npm install -g wscat

# Connect to WebSocket
wscat -c wss://your-worker-url.com/api/ws/test-conv-id

# Should see: Connected message
```

### 3. Frontend Testing:
- Sign up with email
- Create conversation (use your own user ID for self-chat)
- Send message
- Force-quit app → reopen → messages persist
- Enable airplane mode → send message → disable → message syncs

### 4. Multi-Device Testing:
- Two phones with Expo Go
- Sign up as different users on each
- Create conversation with other user's ID
- Messages appear in real-time on both devices

---

## Environment Setup

### Node.js Version:
```bash
node --version  # Should be 18+
```

If using nvm:
```bash
nvm install 18
nvm use 18
```

### Expo CLI:
```bash
npm install -g expo-cli
npx expo --version
```

### Wrangler (Cloudflare CLI):
```bash
npm install -g wrangler
wrangler --version
```

### Cloudflare Login:
```bash
cd worker
npx wrangler login
# Opens browser to authenticate
```

### EAS CLI (for production builds):
```bash
npm install -g eas-cli
eas login
```

---

## Development Best Practices

### 1. Use Production Backend for Testing:
- Local worker development is complex (R2, D1, Vectorize)
- Deploy backend early, iterate on frontend
- Backend changes rarely break frontend

### 2. Web for Rapid Iteration:
```bash
npm run web
```
- Instant refresh
- Chrome DevTools
- Test UI changes quickly

### 3. Physical Device for Final Testing:
- Expo Go on real phone
- Test WebSocket reconnection (airplane mode)
- Test haptics, camera, notifications

### 4. Clear Caches When Stuck:
```bash
# Frontend
rm -rf node_modules .expo
npm install

# Backend
cd worker && rm -rf node_modules dist && npm install
```

### 5. Monitor Cloudflare Dashboard:
- Workers & Pages → Your Worker → Analytics
- Check request count, errors, latency
- Durable Objects → See active instances

### 6. Version Control:
```bash
# Before making changes
git checkout -b feature/your-feature

# After testing
git add .
git commit -m "feat: description"
git push origin feature/your-feature
```

---

## Troubleshooting

### "Cannot connect to WebSocket"
**Cause:** workerUrl incorrect or backend not deployed  
**Fix:** 
```bash
cd worker && npm run deploy
# Copy URL to lib/config.ts
```

### "Clerk authentication failed"
**Cause:** Publishable key mismatch  
**Fix:** Verify key in Clerk Dashboard → API Keys

### "Messages not persisting"
**Cause:** D1 migrations not run  
**Fix:** Run all migration files (see Database Migrations section)

### "AI features returning errors"
**Cause:** Workers AI binding missing or Vectorize not created  
**Fix:**
```bash
npx wrangler vectorize list  # Check if index exists
# Check wrangler.jsonc has ai and vectorize bindings
```

### "Video calls not working"
**Cause:** RealtimeKit credentials not configured  
**Fix:** Check `worker/wrangler.jsonc` has REALTIMEKIT_ORG_ID and REALTIMEKIT_API_KEY

### "Build failed" (EAS)
**Cause:** Multiple reasons  
**Fix:**
```bash
# Clear Expo cache
npx expo start -c

# Check eas.json configuration
# Ensure Apple Developer account connected (for iOS)
```

### "Network request failed" on physical device
**Cause:** HTTPS required for WebSocket on real devices  
**Fix:** Deploy backend (workers.dev URLs have HTTPS by default)

### Duplicate messages appearing
**Cause:** Local SQLite + WebSocket race condition  
**Fix:** Already handled in code via deduplication. If persists:
```bash
# Clear app data or reinstall
```

---

*Built to be forkable. Should take ~15 minutes to deploy your own instance.*


