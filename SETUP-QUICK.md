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

### Frontend:
```bash
npm install
npm start
# Scan QR with Expo Go
```

### Backend:
```bash
cd worker
npm install
npm run dev  # Local on :8787
```

**Important:** Expo Go on phone can't reach `localhost:8787`. Either:
- Deploy worker first: `npm run deploy`
- Use ngrok to tunnel local worker
- Update `lib/config.ts` workerUrl to deployed URL

---

## Deployment

### Backend:
```bash
cd worker
npm run deploy
```

Copy the deployed URL → update `lib/config.ts`

### Frontend:
Already deployed via Expo Go (no build needed for testing)

For production builds:
```bash
eas build --platform android  # or ios
```

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

*Built to be forkable. Should take ~15 minutes to deploy your own instance.*


