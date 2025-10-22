# Testing Guide - Post Bug Fixes

## What Was Fixed

### 🐛 Bug #1: WebSocket Connection Error (CRITICAL)
**Status:** ✅ FIXED  
**Error:** `TypeError: Cannot read property 'type' of undefined` in usePresence.ts  
**Solution:** Changed presence hook to handle `connected` message through `onMessage` instead of `onConnected` callback

**Test:** Open any chat → You should NOT see this error anymore

---

### 🐛 Bug #2: User Data Leakage (CRITICAL)  
**Status:** ✅ FIXED  
**Issue:** After logout → signup with new user → old user's chats still visible  
**Solution:** 
- Added user filtering to conversation queries
- Implemented automatic database cleanup on logout
- Created `clearAllData()` function

**Test:**
1. Sign out of current account
2. Sign up with a new account  
3. Chat list should be EMPTY ✅
4. No old conversations should appear

---

### 🎨 Enhancement: Simplified Conversation Creation
**Status:** ✅ IMPLEMENTED  
**Change:** Single generic flow for all conversation types  

**Old Flow:**
- Toggle between "Direct Chat" and "Group Chat"
- Different UI for each type
- Separate buttons for self-chat vs user chat

**New Flow:**
- Single "Create Conversation" button
- Optional name field (works for all types)
- Optional participants field:
  - Leave empty → Self-chat
  - Add 1 user → Direct chat
  - Add 2+ users → Group chat

**Test:**
1. Click "+ New" button
2. Try creating:
   - Self-chat: Leave participants empty, click "Create Conversation"
   - Direct chat: Add 1 user ID, click "Create Conversation"
   - Group chat: Add 2+ user IDs (comma-separated), click "Create Conversation"
3. All types should create successfully

---

## Backend Cleanup Completed

### D1 Database Cleaned ✅
- Deleted 28 conversation participants
- Deleted 20 conversations
- Deleted 6 users

**Note:** Durable Object storage (message history) still exists but will be inaccessible since conversation IDs no longer exist in D1.

---

## Deployment Status

### Backend
- **Version:** 5e4c244f-475a-4241-961b-e6f49d11b18e  
- **URL:** https://messageai-worker.abdulisik.workers.dev  
- **Status:** ✅ DEPLOYED & CLEAN

### Frontend
- **Status:** ⏳ NEEDS RELOAD  
- **Action Required:** Restart Expo app to pick up new code

---

## Testing Checklist

### Priority 1: Verify Bug Fixes

#### WebSocket Connection
- [ ] Open app → No "Cannot read property 'type' of undefined" errors
- [ ] Create a chat → Open chat screen
- [ ] Check online status indicator appears in header
- [ ] No presence-related errors in console

#### User Data Isolation  
- [ ] Sign out of current account
- [ ] Sign up with NEW test account
- [ ] Verify chat list is EMPTY (no old chats)
- [ ] Create a new chat with this new account
- [ ] Sign out → Sign in with ORIGINAL account
- [ ] Verify chats are separate (new account's chat not visible)

---

### Priority 2: Test New Conversation Flow

#### Self-Chat
- [ ] Click "+ New"
- [ ] Leave "Add Participants" field EMPTY
- [ ] Optionally add a name (e.g., "My Notes")
- [ ] Click "Create Conversation"
- [ ] Should navigate to chat with only you as participant
- [ ] Send a message → Should appear immediately

#### Direct Chat (1-on-1)
- [ ] Click "+ New"
- [ ] Add ONE user ID in participants field
- [ ] Optionally add a name (e.g., "Chat with Alice")
- [ ] Click "Create Conversation"
- [ ] Should navigate to chat with 2 participants
- [ ] Send a message from both users → Should work

#### Group Chat (3+ participants)
- [ ] Click "+ New"
- [ ] Add TWO OR MORE user IDs (comma-separated)
- [ ] Add a group name (e.g., "Team Chat")
- [ ] Click "Create Conversation"
- [ ] Should navigate to chat with 3+ participants
- [ ] Header should show group name
- [ ] Header should show "X online" count
- [ ] Messages should show sender names
- [ ] Send messages from multiple users → All should appear

---

### Priority 3: Test Presence & Read Receipts

#### Presence Tracking
- [ ] Open a group chat
- [ ] Check header shows online user count
- [ ] Have another user join the same chat
- [ ] Online count should increase
- [ ] Have user leave the chat
- [ ] Online count should decrease
- [ ] No errors in console

#### Read Receipts
- [ ] Send a message (yours)
- [ ] Should show gray ○ (sending)
- [ ] Should change to gray ✓ (sent)
- [ ] Should change to gray ✓✓ (delivered)
- [ ] Have another user read the message
- [ ] Should change to blue ✓✓ (read)

---

### Priority 4: Offline Features

#### Message Queueing
- [ ] Turn off WiFi/mobile data
- [ ] Send a message
- [ ] Should show gray ○ (sending/queued)
- [ ] Turn WiFi back on
- [ ] Message should automatically send
- [ ] Status should update to ✓✓

#### Offline Viewing
- [ ] Open a chat with message history
- [ ] Turn off WiFi
- [ ] Navigate to another chat
- [ ] Navigate back to original chat
- [ ] Messages should still be visible (from SQLite cache)

---

## Known Issues / Limitations

### Not Fixed (Deferring to Post-MVP)
1. **Durable Object Cleanup:** Old DO instances with message history still exist
   - **Impact:** They'll hibernate and take up minimal resources
   - **Solution:** See CLEANUP.md for manual cleanup options
   
2. **Hash Collision Handling:** No detection for conversation ID hash collisions
   - **Impact:** Extremely low probability (SHA-256)
   - **Solution:** Implement collision detection post-MVP

3. **No Conversation Deletion API:** Can't delete conversations from UI
   - **Impact:** Test conversations accumulate
   - **Solution:** Use CLEANUP.md manual steps for now

---

## Fresh Start Instructions

If you encounter persistent issues or want to completely reset:

### Full Reset (Nuclear Option)

1. **Sign out all test accounts in app**
2. **Clear backend (already done):**
   ```bash
   cd worker
   wrangler d1 execute messageai-db --remote --command "DELETE FROM conversation_participants"
   wrangler d1 execute messageai-db --remote --command "DELETE FROM conversations"
   wrangler d1 execute messageai-db --remote --command "DELETE FROM users"
   ```

3. **Clear local app data:**
   - iOS Simulator: Delete app → Reinstall
   - Android: Settings → Apps → MessageAI → Clear Data

4. **Create fresh test accounts:**
   - Sign up with new email addresses
   - Test with clean slate

---

## What to Test Next

After verifying all bug fixes work:

1. **Group Chat Features:**
   - Create groups with 3-5 users
   - Test group naming
   - Test sender attribution (messages show sender names)
   - Test presence count

2. **Edge Cases:**
   - Very long message content
   - Rapid message sending
   - Multiple users typing simultaneously
   - Network switching (WiFi → Mobile → WiFi)

3. **Performance:**
   - Chat with 100+ messages (scrolling performance)
   - 10+ simultaneous users in a group
   - App backgrounding/foregrounding

---

## Getting Help

If you encounter issues:

1. Check frontend console logs (Expo)
2. Check backend logs: `cd worker && wrangler tail --format pretty`
3. Refer to `BUGFIXES.md` for details on fixes
4. Refer to `CLEANUP.md` for data cleanup options

---

## Success Criteria

✅ **Phase 3 is VALIDATED when:**
- [ ] No WebSocket connection errors
- [ ] User data properly isolated between accounts
- [ ] All 3 conversation types work (self/direct/group)
- [ ] Presence tracking works in group chats
- [ ] Read receipts show correct colored states
- [ ] Offline message queueing works
- [ ] Messages persist across app restarts
- [ ] Sender names appear in group chats

Once all checkboxes are complete → Phase 3 is DONE ✅

---

**Current Status:** 🧪 READY FOR TESTING  
**Next Phase:** Phase 4.0 - Push Notifications & MVP Deployment

