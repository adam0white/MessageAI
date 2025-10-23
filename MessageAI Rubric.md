# **MessageAI Rubric**

Total Points: 100

---

## **Section 1: Core Messaging Infrastructure (35 points)**

### **Real-Time Message Delivery (12 points)**

**Excellent (11-12 points)**

* Sub-200ms message delivery on good network  
* Messages appear instantly for all online users  
* Zero visible lag during rapid messaging (20+ messages)  
* Typing indicators work smoothly  
* Presence updates (online/offline) sync immediately

**Good (9-10 points)**

* Consistent delivery under 300ms  
* Occasional minor delays with heavy load  
* Typing indicators mostly responsive

**Satisfactory (6-8 points)**

* Messages deliver but noticeable delays (300-500ms)  
* Some lag during rapid messaging  
* Typing indicators work but laggy

**Poor (0-5 points)**

* Inconsistent delivery  
* Frequent delays over 500ms  
* Broken under concurrent messaging

### **Offline Support & Persistence (12 points)**

**Excellent (11-12 points)**

* User goes offline → messages queue locally → send when reconnected  
* App force-quit → reopen → full chat history preserved  
* Messages sent while offline appear for other users once online  
* Network drop (30s+) → auto-reconnects with complete sync  
* Clear UI indicators for connection status and pending messages  
* Sub-1 second sync time after reconnection

**Good (9-10 points)**

* Offline queuing works for most scenarios  
* Reconnection works but may lose last 1-2 messages  
* Connection status shown  
* Minor sync delays (2-3 seconds)

**Satisfactory (6-8 points)**

* Basic offline support but loses some messages  
* Reconnection requires manual refresh  
* Inconsistent persistence  
* Slow sync (5+ seconds)

**Poor (0-5 points)**

* Messages lost when offline  
* Reconnection fails frequently  
* App restart loses recent messages  
* No connection indicators

**Testing Scenarios:**

1. Send 5 messages while offline → go online → all messages deliver  
2. Force quit app mid-conversation → reopen → chat history intact  
3. Network drop for 30 seconds → messages queue and sync on reconnect  
4. Receive messages while offline → see them immediately when online

### **Group Chat Functionality (11 points)**

**Excellent (10-11 points)**

* 3+ users can message simultaneously  
* Clear message attribution (names/avatars)  
* Read receipts show who's read each message  
* Typing indicators work with multiple users  
* Group member list with online status  
* Smooth performance with active conversation

**Good (8-9 points)**

* Group chat works for 3-4 users  
* Good message attribution  
* Read receipts mostly work  
* Minor issues under heavy use

**Satisfactory (5-7 points)**

* Basic group chat functionality  
* Attribution works but unclear  
* Read receipts unreliable  
* Performance degrades with 4+ users

**Poor (0-4 points)**

* Group chat broken or unusable  
* Messages get mixed up  
* Can't tell who sent what  
* Crashes with multiple users

## **Section 2: Mobile App Quality (20 points)**

### **Mobile Lifecycle Handling (8 points)**

**Excellent (7-8 points)**

* App backgrounding → WebSocket maintains or reconnects instantly  
* Foregrounding → instant sync of missed messages  
* Push notifications work when app is closed  
* No messages lost during lifecycle transitions  
* Battery efficient (no excessive background activity)

**Good (5-6 points)**

* Lifecycle mostly handled  
* Reconnection takes 2-3 seconds  
* Push notifications work  
* Minor sync delays

**Satisfactory (3-4 points)**

* Basic lifecycle support  
* Slow reconnection (5+ seconds)  
* Push notifications unreliable  
* Some message loss

**Poor (0-2 points)**

* Backgrounding breaks connection  
* Manual restart required  
* Push notifications don't work  
* Frequent message loss

### **Performance & UX (12 points)**

**Excellent (11-12 points)**

* App launch to chat screen \<2 seconds  
* Smooth 60 FPS scrolling through 1000+ messages  
* Optimistic UI updates (messages appear instantly before server confirm)  
* Images load progressively with placeholders  
* Keyboard handling perfect (no UI jank)  
* Professional layout and transitions

**Good (9-10 points)**

* Launch under 3 seconds  
* Smooth scrolling through 500+ messages  
* Optimistic updates work  
* Good keyboard handling  
* Minor layout issues

**Satisfactory (6-8 points)**

* Launch 3-5 seconds  
* Scrolling smooth for 200+ messages  
* Some optimistic updates  
* Keyboard causes minor issues  
* Basic layout

**Poor (0-5 points)**

* Slow launch (5+ seconds)  
* Laggy scrolling  
* No optimistic updates  
* Keyboard breaks UI  
* Janky or missing components

## **Section 3: AI Features Implementation (30 points)**

### **Required AI Features for Chosen Persona (15 points)**

**Excellent (14-15 points)**

* All 5 required AI features implemented and working excellently  
* Features genuinely useful for persona's pain points  
* Natural language commands work 90%+ of the time  
* Fast response times (\<2s for simple commands)  
* Clean UI integration (contextual menus, chat interface, or hybrid)  
* Clear loading states and error handling

**Good (11-13 points)**

* All 5 features implemented and working well  
* 80%+ command accuracy  
* Response times 2-3 seconds  
* Good UI integration  
* Basic error handling

**Satisfactory (8-10 points)**

* All 5 features present but quality varies  
* 60-70% command accuracy  
* Response times 3-5 seconds  
* Basic UI integration  
* Limited error handling

**Poor (0-7 points)**

* Missing required features  
* Poor accuracy (\<60%)  
* Slow responses (5+ seconds)  
* Broken or confusing UI  
* No error handling

**Feature Evaluation by Persona:**

*Remote Team Professional:*

1. Thread summarization captures key points  
2. Action items correctly extracted  
3. Smart search finds relevant messages  
4. Priority detection flags urgent messages accurately  
5. Decision tracking surfaces agreed-upon decisions

*International Communicator:*

1. Real-time translation accurate and natural  
2. Language detection works automatically  
3. Cultural context hints actually helpful  
4. Formality adjustment produces appropriate tone  
5. Slang/idiom explanations clear

*Busy Parent/Caregiver:*

1. Calendar extraction finds dates/times correctly  
2. Decision summarization captures group consensus  
3. Priority highlighting surfaces urgent info  
4. RSVP tracking accurate  
5. Deadline extraction finds commitments

*Content Creator/Influencer:*

1. Auto-categorization sorts correctly  
2. Response drafting matches creator's voice  
3. FAQ auto-responder handles common questions  
4. Sentiment analysis flags concerning messages  
5. Collaboration scoring identifies opportunities

### **Persona Fit & Relevance ( 5 points )**

**Excellent (5 points)**

*  AI features clearly map to real pain points of the chosen persona.  
*  Each feature demonstrates daily usefulness and contextual value.  
*  The overall experience feels purpose-built for that user type.

**Good (4 points)**

*  Most features solve relevant persona challenges; some may feel generic but alignment is clear.

**Satisfactory (3 points)**

* Features work technically but their practical benefit to the persona is unclear or inconsistent.

**Poor (0–2 points)**

*  AI features are generic or misaligned with persona needs; little connection to stated pain points.

### **Advanced AI Capability (10 points)**

**Excellent (9-10points)**

* Advanced capability fully implemented and impressive  
* **Multi-Step Agent**: Executes complex workflows autonomously, maintains context across 5+ steps, handles edge cases gracefully  
* **Proactive Assistant**: Monitors conversations intelligently, triggers suggestions at right moments, learns from user feedback  
* **Context-Aware Smart Replies**: Learns user style accurately, generates authentic-sounding replies, provides 3+ relevant options  
* **Intelligent Processing**: Extracts structured data accurately, handles multilingual content, presents clear summaries  
* Uses required agent framework correctly (if applicable)  
* Response times meet targets (\<15s for agents, \<8s for others)  
* Seamless integration with other features

**Good (7-8 points)**

* Advanced capability works well  
* Handles most scenarios correctly  
* Minor issues with edge cases  
* Good framework usage  
* Meets most performance targets

**Satisfactory (5-6 points)**

* Advanced capability functional but basic  
* Limited scenarios covered  
* Frequent edge case failures  
* Framework used but not optimally  
* Slow performance

**Poor (0-4 points)**

* Advanced capability broken or missing  
* Doesn't work reliably  
* Framework misused or not used  
* Fails performance targets  
* Poor integration

## **Section 4: Technical Implementation (10 points)**

### **Architecture (5 points)**

**Excellent (5 points)**

* Clean, well-organized code  
* API keys secured (never exposed in mobile app)  
* Function calling/tool use implemented correctly  
* RAG pipeline for conversation context  
* Rate limiting implemented  
* Response streaming for long operations (if applicable)

**Good (4 points)**

* Solid app structure  
* Keys mostly secure  
* Function calling works  
* Basic RAG implementation  
* Minor organizational issues

**Satisfactory (3 points)**

* Functional app but messy  
* Security gaps exist  
* Function calling basic  
* No RAG or very limited  
* Needs improvement

**Poor (0-2 points)**

* Poor app organization  
* Exposed API keys  
* Function calling broken  
* No RAG implementation  
* Major security issues

### **Authentication & Data Management (5 points)**

**Excellent (5 points)**

* Robust auth system (Firebase Auth, Auth0, or equivalent)  
* Secure user management  
* Proper session handling  
* Local database (SQLite/Realm/SwiftData) implemented correctly  
* Data sync logic handles conflicts  
* User profiles with photos working

**Good (4 points)**

* Functional auth  
* Good user management  
* Basic sync logic  
* Local storage works  
* Minor issues

**Satisfactory (3 points)**

* Basic auth works  
* User management limited  
* Sync has issues  
* Local storage basic  
* Needs improvement

**Poor (0-2 points)**

* Broken authentication  
* Poor user management  
* Sync doesn't work  
* No local storage  
* Major vulnerabilities

## **Section 5: Documentation & Deployment (5 points)**

### **Repository & Setup (3 points)**

**Excellent (3 points)**

* Clear, comprehensive README  
* Step-by-step setup instructions  
* Architecture overview with diagrams  
* Environment variables template  
* Easy to run locally  
* Code is well-commented

**Good (2 points)**

* Good README  
* Setup mostly clear  
* Architecture explained  
* Can run with minor issues

**Satisfactory (1 point)**

* Basic README  
* Setup unclear in places  
* Minimal architecture docs  
* Difficult to run

**Poor (0 points)**

* Missing or inadequate documentation  
* Cannot be set up  
* No architecture explanation

### **Deployment (2 points)**

**Excellent (2 points)**

* App deployed to TestFlight/APK/Expo Go  
* Or, app runs on emulator locally  
* Works on real devices  
* Fast and reliable

**Good (1 point)**

* Deployed but minor issues  
* Accessible with some effort  
* Works on most devices

**Poor (0 points)**

* Not deployed  
* Deployment broken  
* Cannot access or test

## **Section 6: Required Deliverables (Pass/Fail)**

### **Demo Video (Required \- Pass/Fail)**

**PASS Requirements**: 5-7 minute video demonstrating:

* Real-time messaging between two physical devices (show both screens)  
* Group chat with 3+ participants  
* Offline scenario (go offline, receive messages, come online)  
* App lifecycle (background, foreground, force quit)  
* All 5 required AI features with clear examples  
* Advanced AI capability with specific use cases  
* Brief technical architecture explanation  
* Clear audio and video quality

**FAIL Penalty**: Missing requirements OR poor quality OR not submitted \= **\-15 points**

### **Persona Brainlift (Required \- Pass/Fail)**

**PASS Requirements**: 1-page document including:

* Chosen persona and justification  
* Specific pain points being addressed  
* How each AI feature solves a real problem  
* Key technical decisions made

**FAIL Penalty**: Missing or inadequate \= **\-10 points**

### **Social Post (Required \- Pass/Fail)**

**PASS Requirements**: Post on X or LinkedIn with:

* Brief description (2-3 sentences)  
* Key features and persona  
* Demo video or screenshots  
* Link to GitHub  
* Tag @GauntletAI

**FAIL Penalty**: Not posted \= **\-5 points**

## **Bonus Points (Maximum \+10)**

**Innovation (+3 points)**

* Novel AI features beyond requirements  
* Examples: Voice message transcription with AI, smart message clustering, conversation insights dashboard, AI-powered search with semantic understanding

**Polish (+3 points)**

* Exceptional UX/UI design  
* Smooth animations throughout  
* Professional design system  
* Delightful micro-interactions  
* Dark mode support  
* Accessibility features

**Technical Excellence (+2 points)**

* Advanced offline-first architecture (CRDTs, OT)  
* Exceptional performance (handles 5000+ messages smoothly)  
* Sophisticated error recovery  
* Comprehensive test coverage

**Advanced Features (+2 points)**

* Voice messages  
* Message reactions  
* Rich media previews (link unfurling)  
* Advanced search with filters  
* Message threading

## **Grade Scale**

**A (90-100 points)**: Exceptional implementation, exceeds targets, production-ready quality, persona needs clearly addressed

**B (80-89 points)**: Strong implementation, meets all core requirements, good quality, useful AI features

**C (70-79 points)**: Functional implementation, meets most requirements, acceptable quality, basic AI features work

**D (60-69 points)**: Basic implementation, significant gaps, needs improvement, AI features limited

**F (\<60 points)**: Does not meet minimum requirements, major issues, broken functionality