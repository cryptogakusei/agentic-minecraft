# Minecraft AI Bot - Work Log

## Current Status
- **Multi-Agent**: Running locally with 4 agents
- **Minecraft Server**: AWS (18.217.111.253)
- **Agents**: Builder Bob, Explorer Emma, Builder Max, Observer

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

- **Local Development Setup**
  - Supervisor runs locally (your machine makes Claude API calls)
  - Minecraft server remains on AWS
  - Updated `.env` with `MC_HOST=18.217.111.253`

- **Current Build Progress**
  - Village Blacksmith at (-58, 62, -3)
  - Dark Oak Neighbor House at (-46, 62, -11)
  - Cartographer Shop at (-38, 62, -3)
  - Market Square at (-50, 62, -50)
  - Terraced hillside houses at Y:115
  - Marketplace plaza at (-65, 62, 0)

---

## Architecture Reference

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    Multi-Agent Architecture                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   LOCAL (Your Machine)                    AWS (18.217.111.253)          │
│   ────────────────────                    ────────────────────          │
│                                                                         │
│   main-multi.ts                           Docker: minecraft-server      │
│      │                                         │                        │
│      ├── AgentCoordinator                      │ Port 25565             │
│      │      ├── RegionManager                  │                        │
│      │      └── agents: Map<id, AgentContext>  │                        │
│      │                                         │                        │
│      ├── Builder Bob (builder_1)    ◄─────────►│                        │
│      │      ├── AgentRuntime + Viewer :3001    │                        │
│      │      ├── BotRunner + Memory             │                        │
│      │      └── Supervisor (Claude API)        │                        │
│      │                                         │                        │
│      ├── Explorer Emma (explorer_1) ◄─────────►│                        │
│      │      ├── AgentRuntime + Viewer :3002    │                        │
│      │      ├── BotRunner + Memory             │                        │
│      │      └── Supervisor (Claude API)        │                        │
│      │                                         │                        │
│      ├── Builder Max (builder_2)    ◄─────────►│                        │
│      │      ├── AgentRuntime + Viewer :3003    │                        │
│      │      ├── BotRunner + Memory             │                        │
│      │      └── Supervisor (Claude API)        │                        │
│      │                                         │                        │
│      ├── Observer (observer_1)      ◄─────────►│                        │
│      │      ├── AgentRuntime + Viewer :3004    │                        │
│      │      └── No Supervisor (manual control) │                        │
│      │                                         │                        │
│      └── Fastify Server :8080                                           │
│             ├── /v1/agents/* endpoints                                  │
│             ├── /v1/messages endpoint                                   │
│             ├── /v1/events/stream (SSE)                                 │
│             └── /messages.html (portal)                                 │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Useful Commands

```bash
# Local development (multi-agent)
pnpm dev:multi              # Start 4 agents locally

# Single agent
pnpm dev                    # Start single bot with hot reload

# AWS server (Minecraft only)
ssh -i multiagent.pem ubuntu@18.217.111.253

# Docker Minecraft server (on AWS)
sudo docker logs minecraft-server --tail 50
sudo docker restart minecraft-server

# Multi-Agent API
curl http://localhost:8080/v1/agents                           # List all agents
curl -X POST http://localhost:8080/v1/supervisors/start-all    # Start all supervisors
curl -X POST http://localhost:8080/v1/supervisors/stop-all     # Stop all supervisors
curl http://localhost:8080/v1/messages?limit=20                # Recent messages

# Teleport observer
curl -X POST "http://localhost:8080/v1/agents/observer_1/teleport" \
  -H "Content-Type: application/json" \
  -d '{"position": {"x": -45, "y": 80, "z": 0}}'

# Web UIs
# Message Portal: http://localhost:8080/messages.html
# Builder Bob:    http://localhost:3001
# Explorer Emma:  http://localhost:3002
# Builder Max:    http://localhost:3003
# Observer:       http://localhost:3004
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
