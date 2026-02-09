# Minecraft AI Bot - Work Log

## Current Status
- **Architecture**: Two-EC2 deployment (Minecraft + Agents separated)
- **Minecraft Server**: AWS EC2 #1 (18.217.111.253:25565)
- **Agent Server**: AWS EC2 #2 (18.222.122.59:8080)
- **Active Agents**: Builder Bob, Explorer Emma, Builder Max (3 agents)
- **Process Manager**: pm2 with tsx (auto-restart on boot)
- **Agent Philosophy**: 95% building, 5% communication (aggressive build mode)

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
│             │                               │    └── Supervisor (Claude)│
│             │                               │                           │
│             └─────────────────────────────► ├── Explorer Emma :3002     │
│               TCP/25565                     │    └── Supervisor (Claude)│
│                                             │                           │
│                                             ├── Builder Max :3003       │
│                                             │    └── Supervisor (Claude)│
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
