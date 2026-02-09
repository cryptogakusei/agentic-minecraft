# Minecraft AI Bot - Work Log

## Current Status
- **Architecture**: Two-EC2 deployment (Minecraft + Agents separated)
- **Minecraft Server**: AWS EC2 #1 (18.217.111.253:25565)
- **Agent Server**: AWS EC2 #2 (18.222.122.59:8080)
- **Active Agents**: 5 total (2 builders, 3 warriors)
- **Process Manager**: pm2 with tsx (auto-restart on boot)
- **Builder Philosophy**: Blueprint → Complete Build → Verify → Move On
- **Warrior Philosophy**: 99% combat, silent mob extermination

---

## Features Implemented

### Core Bot Infrastructure
- [x] Mineflayer bot connection to Minecraft server
- [x] Prismarine 3D web viewer (port 3000)
- [x] REST API server (port 8080)
- [x] Event-driven architecture with EventBus
- [x] JSON-based persistent storage

### AI Supervisor
- [x] Claude-powered autonomous agent (claude-sonnet-4)
- [x] Episode-based task loop (explore → build → refine → plan)
- [x] Tool-based interaction system
- [x] Automatic reconnection on disconnect
- [x] Prompt caching with Anthropic API (90% cost reduction)

### Bot Capabilities (Tools)
- [x] Movement: walkTo, sprint, jump, swim
- [x] Building: placeBlock, breakBlock, fillBlocks
- [x] Inventory: getInventory, craftItem, equipItem
- [x] World awareness: status, localSiteSummary, getWorldSummary
- [x] Memory: readMemory, writeMemory, appendMemory
- [x] Episodes: readEpisodeHistory, done (complete episode)
- [x] Blueprints: listBlueprints, loadBlueprint, saveBlueprint
- [x] Combat: attack, useItem

### Memory & Persistence
- [x] Agent memory (facts, preferences, learned info)
- [x] Episode history tracking
- [x] World index (discovered locations)
- [x] Blueprint storage
- [x] Event logging (events.jsonl)

### Deployment
- [x] Docker support for Minecraft server
- [x] AWS EC2 deployment
- [x] Environment-based configuration

---

## Features To Implement

### Phase 1: Multi-Agent Foundation (IMPLEMENTED)
- [x] Agent configuration types (AgentConfig, AgentPersonality)
- [x] AgentCoordinator for managing multiple agents
- [x] RegionManager for preventing build conflicts
- [x] AgentMessenger for inter-agent communication
- [x] Per-agent data directories (.data/agents/{id}/)
- [x] Personality-aware system prompts
- [x] New supervisor tools: sendMessage, getMessages, claimRegion, releaseRegion, listAgents
- [x] Multi-agent API endpoints
- [x] New event types for agent coordination

### Phase 2: Social Relationships (Future)
- [ ] Trust/reputation system between agents
- [ ] Relationship memory
- [ ] Social interactions

### Phase 3: Economy (Future)
- [ ] Resource trading between agents
- [ ] Value/pricing system
- [ ] Inventory sharing

### Phase 4: Governance (Future)
- [ ] Voting mechanisms
- [ ] Rules/laws system
- [ ] Conflict resolution

### Phase 5: Emergent Behaviors (Future)
- [ ] Faction formation
- [ ] Complex social dynamics
- [ ] Long-term civilization building

---

## Session Log

### 2026-02-08
- Ran single agent locally, verified AI supervisor works
- Fixed bug in supervisor.ts: API key check now accepts ANTHROPIC_API_KEY when SUPERVISOR_PROVIDER=anthropic
- Deployed to AWS EC2 (18.217.111.253)
  - Ubuntu instance with Docker, Node.js 22, pnpm
  - Minecraft server running in Docker (version 1.21.4)
  - Switched to PaperMC for better performance
  - Enabled whitelist for security (only bot can join)
  - Bot connected and AI supervisor running
- Created multi-agent plan document (docs/MULTI_AGENT_PLAN.md)
- **Implemented Phase 1: Multi-Agent Foundation**
  - Created `src/types/agent-config.ts` - Agent personality types, predefined personalities
  - Created `src/coordinator/agent-coordinator.ts` - Central agent manager
  - Created `src/coordinator/region-manager.ts` - Prevents build conflicts
  - Created `src/coordinator/agent-messenger.ts` - Inter-agent messaging
  - Created `src/main-multi.ts` - Multi-agent entry point
  - Modified `src/supervisor/supervisor.ts` - Added 8 inter-agent tools
  - Modified `src/supervisor/prompt-pack.ts` - Personality-aware prompts
  - Modified `src/bot-runner.ts` - Per-agent data directories
  - Modified `src/events/event-types.ts` - 6 new coordination events
  - Modified `src/api/server.ts` - Multi-agent API endpoints
  - Added npm scripts: `dev:multi`, `start:multi`

### 2026-02-08 (continued) / 2026-02-09
- **Fixed Spam Kick Issue**
  - Agents were getting "Kicked for spamming" from PaperMC
  - Increased `spam-limiter.incoming-packet-threshold` from 300 to 10000
  - Added token bucket rate limiter in `agent-runtime.ts`
  - Added packet budget tracker for client-side throttling

- **Fixed Reconnection Issues**
  - Added `agentId` to bot events for proper filtering
  - Fixed port cleanup on disconnect (EADDRINUSE errors)
  - Added port availability checker with wait logic

- **Created Agent Message Portal** (`public/messages.html`)
  - Real-time SSE connection for live messages
  - Premium dark theme with glassmorphism design
  - Color-coded messages by agent role
  - Animated counters and micro-interactions
  - Added `/v1/messages` endpoint for recent messages

- **Added Periodic Message Check Reminder**
  - 60-second timer prompts agents to check messages
  - Ensures agents stay coordinated and responsive
  - Timer resets on send/receive/check actions

- **Added Multi-Agent Tools to All Modes**
  - sendMessage, getMessages, broadcastMessage now available in explore/build/refine/plan modes

- **Added New Agent Personalities**
  - `builderFast` - Builder Max: fast, aggressive, productive
  - `observer` - Observer: passive camera for surveying

- **Current Agent Roster (4 agents)**
  - Builder Bob (builder_1) - meticulous, patient builder - port 3001
  - Explorer Emma (explorer_1) - curious scout/coordinator - port 3002
  - Builder Max (builder_2) - fast aggressive builder - port 3003
  - Observer (observer_1) - passive survey camera - port 3004

- **Current Build Progress**
  - Village Blacksmith at (-58, 62, -3)
  - Dark Oak Neighbor House at (-46, 62, -11)
  - Cartographer Shop at (-38, 62, -3)
  - Market Square at (-50, 62, -50)
  - Terraced hillside houses at Y:115
  - Marketplace plaza at (-65, 62, 0)
  - Castle with siege equipment at (110,140,-10)
  - Bridge at (123,107,-30)

### 2026-02-09 (Production Deployment)

- **Two-EC2 Architecture Deployment**
  - EC2 #1 (18.217.111.253): Minecraft server only (Docker)
  - EC2 #2 (18.222.122.59): Agent runtime + supervisors (pm2)
  - Private IP communication: 172.31.30.41 (MC) ↔ 172.31.20.245 (Agents)
  - Auto-restart on boot via pm2 + systemd

- **GitHub Repository**
  - Pushed to https://github.com/cryptogakusei/agentic-minecraft
  - Full multi-agent system with 7000+ lines added

- **Agent Personality Updates**
  - Builder Max: Changed from "silent" to "70% build / 30% communicate"
  - Created docs/AGENTS.md for personality documentation

- **Message Portal Fix**
  - Fixed 404 error by updating to fetch from per-agent endpoints
  - Portal combines messages from all agents

- **Configuration**
  - SUPERVISOR_AUTOSTART=true for self-healing after restarts
  - VIEWER_VIEW_DISTANCE_CHUNKS=4 (reduced for stability)
  - VIEWER_FIRST_PERSON=true (fixes camera issues)

### 2026-02-09 (Aggressive Build Mode)

- **Fixed EC2 Security Groups**
  - Added port 8080 to EC2 #2 security group (external API access)
  - Added port 25565 from EC2 #2 private IP to EC2 #1 security group
  - Private IP communication now working: 172.31.20.245 → 172.31.30.41

- **Activated Builder Max (3 Agents Running)**
  - Synced latest code from local to AWS
  - Switched pm2 from compiled dist to tsx direct execution
  - All 3 agents now active: Builder Bob, Explorer Emma, Builder Max

- **Aggressive Building Personalities (95/5 Rule)**
  - Changed all agent ratios from 70-80% build to **95% build / 5% talk**
  - Builder Bob: "Relentless building machine" - no planning, just build
  - Builder Max: "Silent building machine" - almost never communicates
  - Explorer Emma: "Fast silent scout" - 90% explore, 10% report
  - New philosophy: Blocks placed > words spoken
  - Agents now ignore messages, make autonomous decisions, never ask questions

- **Updated Documentation**
  - Rewrote `docs/AGENTS.md` with new aggressive personalities
  - Design philosophy: BUILD > TALK, Maximum Autonomy, Silent by Default

- **pm2 Configuration**
  - Changed from `node dist/main-multi.js` to `npx tsx src/main-multi.ts`
  - Bypasses TypeScript compilation issues
  - Saved config for auto-restart on boot

### 2026-02-09 (Warriors & Blueprint Workflow)

- **Added 3 Warrior Agents (6 Total Agents Now)**
  - Warrior Wolf (`warrior_1`) - Roaming patrol hunter, silent killer
  - Warrior Shadow (`warrior_2`) - Underground cave exterminator
  - Warrior Stone (`warrior_3`) - Stationary guard at town center (0,100,0)
  - All warriors use 99% combat / 1% communication ratio
  - Auto-equip netherite gear and strength effects
  - Constantly run `/kill @e[type=zombie,distance=..50]` etc.

- **New Warrior Role Type**
  - Added `warrior` to AgentRole type
  - Created 3 warrior personalities: `warrior`, `warriorNight`, `warriorGuard`
  - Warriors protect builders from hostile mobs

- **Blueprint-First Build Workflow**
  - Changed builder personalities from "aggressive random building" to structured workflow
  - New process: Blueprint → Complete Build → Verify → Move On
  - Builders must finish 100% of structure before starting next
  - Small structures (300-500 blocks) to ensure completion
  - Every structure must have: floor, walls, roof, door, interior
  - Quality over quantity philosophy

- **Current Agent Roster (6 Agents)**
  | Agent | Role | Port | Behavior |
  |-------|------|------|----------|
  | Builder Bob | builder | 3001 | Blueprint-first, methodical |
  | Explorer Emma | explorer | 3002 | Fast scout, 90% explore |
  | Builder Max | builder | 3003 | Fast but complete builds |
  | Warrior Wolf | warrior | 3004 | Roaming patrol |
  | Warrior Shadow | warrior | 3005 | Underground clearing |
  | Warrior Stone | warrior | 3006 | Stationary guard |

- **Player Access**
  - Whitelisted `godmode26` for direct Minecraft client access
  - Granted operator permissions
  - Server: 18.217.111.253:25565 (version 1.21.4)

- **pm2 Auto-Start Configured**
  - Ran `pm2 startup` with systemd
  - All 6 agents will auto-restart on EC2 reboot

### 2026-02-09 (Surface Building Rules)

- **Updated Builder Location Rules**
  - Changed from "y > 62" to "can see sky" rule
  - Surface = anywhere with open sky above, regardless of Y level
  - Valid locations: mountains, hills, riversides, beaches, coastlines, plains
  - Invalid locations: caves, tunnels, underground enclosed spaces

- **Valid Build Locations**
  | Location | Y-Level | Status |
  |----------|---------|--------|
  | Mountain peak | y=140 | ✅ Sky visible |
  | Hilltop | y=100 | ✅ Sky visible |
  | Plains | y=70 | ✅ Sky visible |
  | Riverbank | y=62 | ✅ Sky visible |
  | Beach | y=63 | ✅ Sky visible |
  | Cave | y=40 | ❌ Enclosed |
  | Tunnel | y=30 | ❌ Enclosed |

- **Builder Behavior Now**
  - Builders will build riverside cottages, beach houses, harbors
  - Must have open sky above build location
  - If in cave/enclosed space, walkTo surface first
  - Complete structures with: floor, walls, roof, door, interior

### 2026-02-09 (Explorer Role Fix)

- **Fixed Explorer Building Problem**
  - Explorer Emma was building rail networks (8000+ blocks out) instead of scouting
  - She was sending many messages asking builders for help (violating 90/10 rule)
  - Explorers should NEVER build - only scout and report

- **Updated Explorer Personality**
  - Changed ratio from 90/10 to **95% explore / 5% report / 0% BUILD**
  - Added explicit "YOU DO NOT BUILD. EVER. NOT A SINGLE BLOCK." rule
  - Forbade: /setblock, /fill, execCommandBatch for building
  - Forbade: coordinating, asking for help, responding to messages
  - New value metric: "DISTANCE COVERED, not blocks placed"

- **Role Separation Clarified**
  | Role | Builds? | Talks? | Primary Activity |
  |------|---------|--------|------------------|
  | Builder | ✅ 95% | 5% | Construct structures |
  | Explorer | ❌ 0% | 5% | Scout and report coords |
  | Warrior | ❌ 0% | 1% | Kill mobs silently |

### 2026-02-09 (Explorer Removed)

- **Removed Explorer Emma**
  - Emma was building void rail networks (8000+ blocks out) instead of scouting
  - Sent excessive messages asking for help (violated 90/10 rule)
  - Personality update didn't fix behavior due to cached supervisor context
  - Decision: Remove explorer role entirely, focus on builders + warriors

### 2026-02-09 (Phantom Builds Fix & Bodyguard Mode)

- **CRITICAL BUG FIX: Phantom Builds**
  - **Problem**: AI agents reported completing builds but no blocks were placed
  - **Root Cause**: `bot.chat('/setblock...')` was being treated as chat message, not command
    - Chat messages were spam-filtered by PaperMC
    - AI received no error feedback → assumed success → updated memory as complete
    - Result: Agents "built" imaginary cities with zero actual blocks
  - **Evidence**: Server logs showed `[Not Secure] <BuilderBot> setblock...` (chat, filtered)
    instead of `BuilderBot issued server command: /setblock...` (command, executed)

  - **Fix Applied in `agent-runtime.ts`**:
    1. Ensured all commands start with `/` prefix
    2. Slowed execution: 1 command per batch (was 3), 300ms delay (was 200ms)
    3. Added block verification after setblock commands
    4. Added `verifiedSetBlock()` with retry logic (up to 3 attempts)
    5. Added `verifiedFill()` for verified area fills
    6. Record packets to track budget and avoid spam kicks

  - **Verification**: Server logs now show `issued server command:` prefix

- **Warrior Bodyguard Mode**
  - **Problem**: Warriors patrolled fixed coordinates while builders died 250+ times
  - **Fix**: Changed warriors from static patrols to dynamic bodyguards

  - **New Warrior Behaviors**:
    | Warrior | Old Behavior | New Behavior |
    |---------|--------------|--------------|
    | Warrior Wolf | Roaming patrol | Bodyguard for Builder Bob |
    | Warrior Shadow | Underground clearing | Bodyguard for Builder Max |
    | Warrior Stone | Stationary guard at (0,100,0) | Rotates between both builders |

  - **Bodyguard Loop**:
    1. `listAgents` to find builder's current position
    2. `/tp @s BuilderBot` to teleport to builder
    3. Kill all mobs within 30-40 blocks
    4. Wait 3-5 seconds
    5. Repeat forever

  - **Key Insight**: Guard the asset (player), not the location (coordinates)
    Use `/tp @s BuilderBot` instead of `/tp @s 0 100 0`

- **Created LEARNINGS.md**
  - New documentation file for multi-agent engineering lessons
  - Documents 3 failure modes:
    1. Phantom Builds (AI hallucinating completed work)
    2. Role Drift (Explorer becoming builder)
    3. Bodyguard Problem (Warriors patrolling empty zones)
  - Includes trust hierarchy diagram and architecture principles
  - Location: `/LEARNINGS.md`

- **Current Agent Roster (5 Agents)**
  | Agent | Role | Port | Behavior |
  |-------|------|------|----------|
  | Builder Bob | builder | 3001 | Blueprint-first, methodical |
  | Builder Max | builder | 3003 | Fast but complete builds |
  | Warrior Wolf | warrior | 3004 | **Bodyguard for Builder Bob** |
  | Warrior Shadow | warrior | 3005 | **Bodyguard for Builder Max** |
  | Warrior Stone | warrior | 3006 | **Rotates between both builders** |

- **Build Verification Status**
  - Builders now placing REAL blocks (confirmed via MC server logs)
  - Copper stairs, copper bulbs, weathered copper, chains, signs visible
  - Structures: "Blacksmith Workshop", "Grocery Shop", "Public Library", "Modern House"
  - Y-level 145-165 bridge construction confirmed

### 2026-02-09 (Async Crash Fix & Build Progress)

- **Fixed Async Callback Crash**
  - **Error**: `TypeError: Cannot read properties of undefined (reading 'position')`
  - **Cause**: `walkTo()` timeout/interval callbacks accessed `bot.entity.position` after bot disconnected
  - **Fix**: Added `safeGetPosition()` helper with optional chaining and fallback values
  - **Also fixed**: Chunk loading loop now checks `if (!bot.entity) break;`
  - Added to LEARNINGS.md as Learning #4

- **Confirmed Build Progress (from Server Logs)**
  - 778+ build commands executed and verified
  - **Builder Bob structures**:
    - Service District Hub (150, 170, 110) - Cable network signs
    - Blacksmith Workshop (48, 82, 8)
    - Grocery Shop (35, 77, 0)
    - Public Library (58, 83, 11)
    - Modern House (32, 80, 18) - "Resident: Cleric"
    - Quartz Beacon Monument (85, 157, 117)
    - Polished Granite Plaza (90-110, 145, 32-48)
  - **Builder Max structures**:
    - Cherry Library (20, 103, -10)
    - Bamboo Farm (5, 63, 12)
    - Birch Harbor (37, 62, -16)
    - Modern Tower #1 (50, 150, 30) - White/gray concrete, iron bars
    - Modern Tower #2 (80, 180, 60) - Sea lantern rooftop
    - Deepslate Skyscraper (46, 150, 63)

- **Warrior Bodyguard Mode Verified**
  - WarriorStone executed `/tp @s BuilderMax` (confirmed in server logs)
  - All warriors actively killing mobs (zombies, skeletons, phantoms, etc.)
  - Kill radius: 40-75 blocks depending on warrior

### 2026-02-09 (Structured Workflow & Behavioral Experiments)

- **Updated Builder Personalities with Structured 4-Phase Workflow**
  - Changed from verbose paragraph instructions to structured format
  - 4 mandatory phases: DECIDE → BLUEPRINT → BUILD → VERIFY
  - Visual separators (═══, ────) for scannability
  - Required announcements: "I will build: X at Y,Z", "Blueprint: X, N blocks", "DONE: X"
  - Hard rules with ✗/✓ markers

- **LEARNINGS.md Methodology Improved**
  - Changed from "Fix Applied" to "Proposed Fix (Verification Pending)"
  - Document issue → propose fix → implement → verify → update learning
  - Added contribution guidelines at top of file

- **Experiment: Testing Behavioral Pattern Sources**

  | Fix Attempted | Result |
  |---------------|--------|
  | Structured prompts | ⚠️ Partial - some compliance |
  | Supervisor restart | ⚠️ Partial - old patterns return |
  | Memory file clearing | ❌ No effect - patterns not stored there |
  | Disable messaging | 🔬 Testing in progress |

- **Discovery: Behavioral Contagion**
  - Cleared blueprints.json, scripts.json, world-index.json
  - Backed up to `.data/backups/2026-02-09-pre-reset/`
  - Patterns STILL persisted after memory clear
  - Hypothesis: Patterns spread through inter-agent communication
  - Builder Bob's "portfolio tracking" style infected Builder Max

- **Current Experiment: Isolated Builder Behavior**
  - Disabled sendMessage, broadcastMessage, getMessages for builders
  - Kept region tools (claimRegion, etc.) for coordination
  - Testing if isolated agents follow structured workflow
  - Warriors still have full messaging (they need to coordinate protection)

- **LEARNINGS.md Now Contains 6 Entries**
  1. Phantom Builds (verified ✅)
  2. Role Drift (verified ✅)
  3. Bodyguard Problem (verified ✅)
  4. Prompt Structure (partial ⚠️)
  5. Cached Context (partial ⚠️)
  6. Behavioral Contagion (investigating 🔬)

### 2026-02-09 (Messaging Disable Experiment - Inconclusive)

- **Experiment: Isolated Builder Behavior**
  - **Goal**: Test if disabling inter-agent messaging for builders changes their workflow compliance
  - **Code Changes Applied**:
    - `supervisor.ts`: Removed messaging tools (sendMessage, broadcastMessage, getMessages) for builders
    - `prompt-pack.ts`: Removed "Other Agents" context and messaging hints for builders
    - Builders still have region tools (claimRegion, getClaimedRegions, etc.)

- **Multiple Restart Attempts**:
  1. `pm2 restart minecraft-agents` - messaging still worked (supervisor context cached)
  2. API call to restart supervisors - messaging still worked
  3. `pm2 delete minecraft-agents && pm2 start` - session ended before verification

- **Status: INCONCLUSIVE**
  - Session ended before we could verify if fresh start fixed the messaging issue
  - Agents are currently NOT running
  - Last activity: builder_2 at Feb 9 00:37

- **Next Steps When Resuming**:
  1. Start agents fresh: `npx pm2 start 'npx tsx src/main-multi.ts' --name minecraft-agents`
  2. Verify builders do NOT have messaging tools available
  3. Observe if structured workflow (DECIDE → BLUEPRINT → BUILD → VERIFY) is followed
  4. Update Learning #6 with results

---

## Architecture Reference

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    Two-EC2 Production Architecture                       │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   EC2 #1: Minecraft Server              EC2 #2: Agent Server            │
│   (18.217.111.253)                      (18.222.122.59)                 │
│   ─────────────────────                 ─────────────────               │
│                                                                         │
│   Docker: itzg/minecraft-server         pm2: minecraft-agents           │
│   └── Paper 1.21.4                      └── tsx src/main-multi.ts      │
│       └── Port 25565                        │                           │
│                                             ├── AgentCoordinator        │
│             ▲                               │    ├── RegionManager      │
│             │                               │    └── AgentMessenger     │
│             │ Private IP                    │                           │
│             │ 172.31.30.41                  ├── Builder Bob :3001       │
│             │                               ├── Explorer Emma :3002     │
│             └─────────────────────────────► ├── Builder Max :3003       │
│               TCP/25565                     ├── Warrior Wolf :3004      │
│                                             ├── Warrior Shadow :3005    │
│                                             ├── Warrior Stone :3006     │
│                                             │   (All with Claude AI)    │
│                                             │                           │
│                                             └── REST API :8080          │
│                                                  ├── /v1/agents/*       │
│                                                  ├── /v1/messages       │
│                                                  └── /messages.html     │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Useful Commands

```bash
# ===== PRODUCTION (Two-EC2 Setup) =====

# SSH to servers
ssh -i multiagent.pem ubuntu@18.217.111.253    # Minecraft server
ssh -i multiagent.pem ubuntu@18.222.122.59     # Agent server

# Agent server (EC2 #2) - pm2 commands
pm2 status                                      # Check agent status
pm2 logs minecraft-agents                       # View logs
pm2 restart minecraft-agents                    # Restart agents
pm2 stop minecraft-agents                       # Stop agents

# Minecraft server (EC2 #1) - Docker commands
sudo docker logs minecraft-server --tail 50
sudo docker restart minecraft-server

# Production API (from anywhere)
curl http://18.222.122.59:8080/v1/agents
curl http://18.222.122.59:8080/v1/messages?limit=20
curl -X POST http://18.222.122.59:8080/v1/supervisors/start-all
curl -X POST http://18.222.122.59:8080/v1/supervisors/stop-all

# Production Web UIs
# Message Portal: http://18.222.122.59:8080/messages.html
# Builder Bob:    http://18.222.122.59:3001
# Explorer Emma:  http://18.222.122.59:3002

# ===== LOCAL DEVELOPMENT =====

# Start locally (connects to AWS Minecraft)
pnpm dev:multi              # Hot reload mode
pnpm start:multi            # Production mode

# Local API
curl http://localhost:8080/v1/agents

# Sync code to production
rsync -avz --exclude node_modules --exclude .git --exclude .data \
  ~/projects/agentic-minecraft/ ubuntu@18.222.122.59:~/minecraft-agents/

# Deploy after sync
ssh ubuntu@18.222.122.59 "cd ~/minecraft-agents && pnpm install && pm2 restart minecraft-agents"
```

---

## Files Reference

| File | Purpose |
|------|---------|
| `src/main-multi.ts` | Multi-agent entry point |
| `src/main.ts` | Single-agent entry point |
| `src/bot-runner.ts` | Bot orchestration |
| `src/runtime/agent-runtime.ts` | Mineflayer wrapper + rate limiter |
| `src/supervisor/supervisor.ts` | AI brain + message check reminder |
| `src/supervisor/prompt-pack.ts` | System prompts |
| `src/coordinator/agent-coordinator.ts` | Multi-agent manager |
| `src/coordinator/region-manager.ts` | Build conflict prevention |
| `src/coordinator/agent-messenger.ts` | Inter-agent messaging |
| `src/types/agent-config.ts` | Agent personalities |
| `src/events/event-bus.ts` | Event system |
| `src/events/jsonl-event-store.ts` | Event persistence |
| `src/api/server.ts` | REST API |
| `public/messages.html` | Agent message portal UI |
| `.data/events.jsonl` | Event log |
| `.data/world-index.json` | Built structures |
| `.data/agents/{id}/memory.json` | Per-agent memory |
| `docs/MULTI_AGENT_PLAN.md` | Multi-agent implementation plan |
