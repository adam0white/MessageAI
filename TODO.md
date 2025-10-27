# Production Release TODO

Quick checklist to release v1.0.0. Delete this file when done.

---

## 1. Clerk Production Key (5 min)

```bash
# 1. https://dashboard.clerk.com → API Keys → Production
# 2. Copy pk_live_... key
# 3. Replace in lib/config.ts:
#    clerkPublishableKey: 'pk_live_YOUR_KEY_HERE'
```

---

## 2. Build Android APK (10 min)

```bash
# Install EAS (one time)
npm install -g eas-cli
eas login

# Build
eas build --platform android --profile production

# Wait ~10 min, download APK from:
# https://expo.dev → messageai → Builds
```

---

## 3. Deploy Web (1 min)

```bash
npm run web:deploy
# Done! Updates https://message.adamwhite.work
```

---

## 4. Create GitHub Release (5 min)

```bash
# Tag
git tag -a v1.0.0 -m "Release 1.0.0"
git push origin v1.0.0

# Create release at:
# https://github.com/YOUR_USERNAME/messageai/releases/new

# Attach APK from step 2
# Use this description:
```

**Release Notes Template:**
```markdown
# MessageAI v1.0.0

Real-time messaging + RAG + multi-step AI agents on Cloudflare edge.

Built in 7 days for @GauntletAI Workers AI Gauntlet.

## Download

**Android APK:** [messageai-v1.0.0.apk](ATTACH_FILE)
**Web:** https://message.adamwhite.work

## Features

✅ Real-time WebSocket messaging with offline sync
✅ Group chat with presence & typing indicators  
✅ 5 AI features: Thread summarization, action items, priority detection, decision tracking, smart search
✅ Multi-step event planner agent (6-step workflow)
✅ Video calls via Cloudflare RealtimeKit
✅ Media sharing with R2 storage
✅ Message reactions & read receipts
✅ Multi-platform: iOS, Android, Web

## Tech Stack

**Frontend:** React Native (Expo) · SQLite · React Query · Clerk  
**Backend:** Cloudflare Workers · Durable Objects · D1 · R2 · Workers AI · Vectorize  
**AI:** Qwen 1.5 14B, Llama 3.1 8B, bge-base-en-v1.5 embeddings

## Install (Android)

1. Download APK
2. Settings → Security → Enable "Unknown sources"
3. Tap APK → Install
4. Sign up with email

## Setup Your Own

See [SETUP-QUICK.md](https://github.com/YOUR_USERNAME/messageai/blob/main/SETUP-QUICK.md) - takes ~15 min.
```

---

## 5. Test (10 min)

- [ ] Install APK on Android device
- [ ] Sign up with new account
- [ ] Create conversation
- [ ] Send messages (test real-time sync)
- [ ] Test offline mode (airplane mode)
- [ ] Test AI features (ask AI, summarize)
- [ ] Test video call
- [ ] Force quit → reopen (persistence check)

---

## 6. Share (Optional)

**X/Twitter Post:**
```
🚀 Built MessageAI in 7 days for @GauntletAI!

Real-time messaging + RAG + multi-step AI agents - all on Cloudflare edge 🔥

✅ Sub-100ms AI responses
✅ WebSocket hibernation  
✅ Multi-platform (iOS/Android/Web)
✅ 100% Cloudflare stack

Live: https://message.adamwhite.work
Code: [GitHub link]

[Demo video/screenshot]

#CloudflareWorkers #WorkersAI
```

---

## Quick Commands

```bash
# Build Android
eas build --platform android --profile production

# Deploy Web
npm run web:deploy

# Create Release
git tag v1.0.0 && git push origin v1.0.0
```

---

## Optional: iOS Build

**Skip if no Apple Developer account ($99/year)**

```bash
eas build --platform ios --profile production
eas submit --platform ios
```

---

**That's it!** Delete this file when done. 🚀


