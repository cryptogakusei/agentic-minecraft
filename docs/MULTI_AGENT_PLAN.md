# Phase 1: Cooperative Multi-Agent Foundation

## Goal
Get multiple Claude-powered agents working together in the same Minecraft world with distinct personalities. This is the foundation for future social simulation features.

---

## Scope (This Phase Only)

```
┌─────────────────────────────────────────────────────────────────┐
│                    WHAT WE'RE BUILDING NOW                      │
│                                                                 │
│   ✅ Multiple agents connecting to same Minecraft server       │
│   ✅ Each agent has unique personality/role                    │
│   ✅ Agents can send messages to each other                    │
│   ✅ Agents claim regions to avoid build conflicts             │
│   ✅ Per-agent memory and state                                │
│   ✅ Basic coordination (who builds where)                     │
│                                                                 │
│   ❌ NOT YET: Economy, governance, complex social dynamics     │
│   ❌ NOT YET: Conflict resolution, factions, voting            │
│   ❌ NOT YET: Emergent society behaviors                       │
└─────────────────────────────────────────────────────────────────┘
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        AGENT COORDINATOR                                │
│                                                                         │
│   agents: Map<agentId, AgentContext>                                    │
│   messenger: AgentMessenger                                             │
│   regionManager: RegionManager                                          │
│                                                                         │
│          ┌───────────────────┬───────────────────┐                      │
│          │                   │                   │                      │
│          ▼                   ▼                   ▼                      │
│   ┌─────────────┐     ┌─────────────┐     ┌─────────────┐              │
│   │  Builder    │     │  Explorer   │     │  Decorator  │              │
│   │  Agent      │     │  Agent      │     │  Agent      │              │
│   │             │     │             │     │             │              │
│   │ AgentRuntime│     │ AgentRuntime│     │ AgentRuntime│              │
│   │ BotRunner   │     │ BotRunner   │     │ BotRunner   │              │
│   │ Supervisor  │     │ Supervisor  │     │ Supervisor  │              │
│   └─────────────┘     └─────────────┘     └─────────────┘              │
│                                                                         │
│   ┌─────────────────────────────────────────────────────────────────┐   │
│   │                      SHARED                                      │   │
│   │   EventBus (with agentId)    WorldIndex    BlueprintStore        │   │
│   └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│   ┌─────────────────────────────────────────────────────────────────┐   │
│   │                     PER-AGENT                                    │   │
│   │   .data/agents/{id}/memory.json                                  │   │
│   │   .data/agents/{id}/supervisor.json                              │   │
│   │   .data/agents/{id}/episodes.json                                │   │
│   └─────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Implementation Tasks

### Task 1: Agent Configuration Types
**New file:** `src/types/agent-config.ts`

```typescript
export type AgentPersonality = {
  name: string;
  role: 'builder' | 'explorer' | 'decorator' | 'general';
  traits: string[];
  systemPromptAddition: string;
};

export type AgentConfig = {
  agentId: string;
  username: string;        // Minecraft username
  personality: AgentPersonality;
  viewerPort: number;      // Unique per agent
  dataDir: string;         // .data/agents/{agentId}/
};

export type AgentContext = {
  agentId: string;
  config: AgentConfig;
  runtime: AgentRuntime;
  botRunner: BotRunner;
  supervisor: Supervisor;
  messenger: AgentMessenger;
};
```

---

### Task 2: Agent Coordinator
**New file:** `src/coordinator/agent-coordinator.ts`

```typescript
import { AgentConfig, AgentContext } from '../types/agent-config.js';
import { AppConfig } from '../config.js';
import { EventBus } from '../events/event-bus.js';
import { AppEvents } from '../events/event-types.js';
import { AgentRuntime } from '../runtime/agent-runtime.js';
import { BotRunner } from '../bot-runner.js';
import { Supervisor } from '../supervisor/supervisor.js';
import { RegionManager } from './region-manager.js';
import { AgentMessenger } from './agent-messenger.js';

export class AgentCoordinator {
  private agents: Map<string, AgentContext> = new Map();
  readonly regionManager: RegionManager;

  constructor(
    private readonly config: AppConfig,
    private readonly events: EventBus<AppEvents>,
  ) {
    this.regionManager = new RegionManager(events);
  }

  async createAgent(agentConfig: AgentConfig): Promise<AgentContext> {
    const { agentId } = agentConfig;

    // Create per-agent config overrides
    const agentAppConfig = {
      ...this.config,
      MC_USERNAME: agentConfig.username,
      VIEWER_PORT: agentConfig.viewerPort,
    };

    // Create runtime with unique username
    const runtime = new AgentRuntime(agentAppConfig, this.events);

    // Create BotRunner with per-agent data directory
    const botRunner = new BotRunner(agentId, agentAppConfig, this.events, runtime);
    await botRunner.init();

    // Create messenger for inter-agent communication
    const messenger = new AgentMessenger(agentId, this.events);

    // Create supervisor with personality
    const supervisor = new Supervisor(
      agentId,
      agentAppConfig,
      this.events,
      botRunner,
      messenger,
      this.regionManager,
      this,
      agentConfig.personality,
    );
    await supervisor.init();

    const context: AgentContext = {
      agentId,
      config: agentConfig,
      runtime,
      botRunner,
      supervisor,
      messenger,
    };

    this.agents.set(agentId, context);
    this.events.publish('agent.created', {
      agentId,
      personality: agentConfig.personality.name,
    });

    return context;
  }

  async destroyAgent(agentId: string, reason = 'destroyed'): Promise<void> {
    const agent = this.agents.get(agentId);
    if (!agent) return;

    agent.supervisor.stop(reason);
    await agent.runtime.disconnect(reason);
    this.regionManager.release(agentId);
    this.agents.delete(agentId);

    this.events.publish('agent.destroyed', { agentId, reason });
  }

  getAgent(agentId: string): AgentContext | undefined {
    return this.agents.get(agentId);
  }

  getAllAgents(): AgentContext[] {
    return Array.from(this.agents.values());
  }

  getOtherAgents(excludeId: string): AgentContext[] {
    return this.getAllAgents().filter(a => a.agentId !== excludeId);
  }
}
```

---

### Task 3: Region Manager (Prevent Build Conflicts)
**New file:** `src/coordinator/region-manager.ts`

```typescript
import { EventBus } from '../events/event-bus.js';
import { AppEvents } from '../events/event-types.js';
import { BBox, normalizeBBox } from '../types/geometry.js';

export type RegionClaim = {
  agentId: string;
  bbox: BBox;
  claimedAt: number;
  expiresAt: number;
};

export class RegionManager {
  private claims: Map<string, RegionClaim> = new Map();

  constructor(private readonly events: EventBus<AppEvents>) {}

  claim(agentId: string, bbox: BBox, ttlMs = 300000): boolean {
    const normalizedBbox = normalizeBBox(bbox);

    // Check for overlaps with existing non-expired claims
    for (const [id, claim] of this.claims) {
      if (id !== agentId && claim.expiresAt > Date.now()) {
        if (this.overlaps(normalizedBbox, claim.bbox)) {
          return false; // Region already claimed
        }
      }
    }

    // Clean up expired claim if exists
    this.claims.delete(agentId);

    const claim: RegionClaim = {
      agentId,
      bbox: normalizedBbox,
      claimedAt: Date.now(),
      expiresAt: Date.now() + ttlMs,
    };

    this.claims.set(agentId, claim);
    this.events.publish('region.claimed', { agentId, bbox: normalizedBbox, ttlMs });
    return true;
  }

  release(agentId: string): void {
    if (this.claims.has(agentId)) {
      this.claims.delete(agentId);
      this.events.publish('region.released', { agentId });
    }
  }

  extendClaim(agentId: string, additionalMs: number): boolean {
    const claim = this.claims.get(agentId);
    if (!claim) return false;

    claim.expiresAt = Math.max(claim.expiresAt, Date.now()) + additionalMs;
    return true;
  }

  getClaimedRegion(agentId: string): BBox | null {
    const claim = this.claims.get(agentId);
    if (!claim || claim.expiresAt < Date.now()) return null;
    return claim.bbox;
  }

  getAllClaims(): RegionClaim[] {
    const now = Date.now();
    return Array.from(this.claims.values()).filter(c => c.expiresAt > now);
  }

  isRegionAvailable(bbox: BBox, excludeAgentId?: string): boolean {
    const normalizedBbox = normalizeBBox(bbox);
    const now = Date.now();

    for (const [id, claim] of this.claims) {
      if (excludeAgentId && id === excludeAgentId) continue;
      if (claim.expiresAt > now && this.overlaps(normalizedBbox, claim.bbox)) {
        return false;
      }
    }
    return true;
  }

  private overlaps(a: BBox, b: BBox): boolean {
    return (
      a.min.x <= b.max.x && a.max.x >= b.min.x &&
      a.min.y <= b.max.y && a.max.y >= b.min.y &&
      a.min.z <= b.max.z && a.max.z >= b.min.z
    );
  }
}
```

---

### Task 4: Inter-Agent Messaging
**New file:** `src/coordinator/agent-messenger.ts`

```typescript
import { EventBus } from '../events/event-bus.js';
import { AppEvents } from '../events/event-types.js';

export type AgentMessage = {
  from: string;
  to: string;
  content: string;
  ts: string;
  read: boolean;
};

export class AgentMessenger {
  private inbox: AgentMessage[] = [];
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly agentId: string,
    private readonly events: EventBus<AppEvents>,
  ) {
    // Listen for direct messages to this agent
    const unsub1 = this.events.onType('agent.message', (event) => {
      if (event.data.to === this.agentId) {
        this.inbox.push({
          from: event.data.from,
          to: event.data.to,
          content: event.data.content,
          ts: event.data.ts,
          read: false,
        });
      }
    });

    // Listen for broadcasts (from other agents)
    const unsub2 = this.events.onType('agent.broadcast', (event) => {
      if (event.data.from !== this.agentId) {
        this.inbox.push({
          from: event.data.from,
          to: '*',
          content: event.data.content,
          ts: event.data.ts,
          read: false,
        });
      }
    });

    this.unsubscribe = () => {
      unsub1();
      unsub2();
    };
  }

  send(to: string, content: string): void {
    this.events.publish('agent.message', {
      from: this.agentId,
      to,
      content,
      ts: new Date().toISOString(),
    });
  }

  broadcast(content: string): void {
    this.events.publish('agent.broadcast', {
      from: this.agentId,
      content,
      ts: new Date().toISOString(),
    });
  }

  getUnreadMessages(): AgentMessage[] {
    const unread = this.inbox.filter(m => !m.read);
    // Mark as read
    unread.forEach(m => (m.read = true));
    return unread;
  }

  getAllMessages(limit = 50): AgentMessage[] {
    return this.inbox.slice(-limit);
  }

  getMessageCount(): { total: number; unread: number } {
    return {
      total: this.inbox.length,
      unread: this.inbox.filter(m => !m.read).length,
    };
  }

  clearInbox(): void {
    this.inbox = [];
  }

  destroy(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }
}
```

---

### Task 5: New Event Types
**Modify:** `src/events/event-types.ts`

Add these event types to the `AppEvents` union:

```typescript
// Add to AppEvents union:

// Agent coordination events
| EventEnvelope<'agent.message', { from: string; to: string; content: string; ts: string }>
| EventEnvelope<'agent.broadcast', { from: string; content: string; ts: string }>
| EventEnvelope<'region.claimed', { agentId: string; bbox: BBox; ttlMs: number }>
| EventEnvelope<'region.released', { agentId: string }>
| EventEnvelope<'agent.created', { agentId: string; personality: string }>
| EventEnvelope<'agent.destroyed', { agentId: string; reason: string }>
```

---

### Task 6: Per-Agent Data Directories
**Modify:** `src/bot-runner.ts`

Change constructor signature and use per-agent paths:

```typescript
export class BotRunner {
  // ... existing private fields ...

  constructor(
    private readonly agentId: string,  // NEW PARAMETER
    private readonly config: AppConfig,
    private readonly events: EventBus<AppEvents>,
    private readonly agent: AgentRuntime,
  ) {
    // Per-agent data directory
    const dataDir = join(dirname(config.EVENTS_JSONL_PATH), 'agents', agentId);

    // Per-agent stores (each agent has their own)
    this.control = new ControlState(join(dataDir, 'control.json'));
    this.jobs = new JobStore(join(dataDir, 'jobs.json'));
    this.jobQueue = new JobQueue();
    this.episodes = new EpisodeStore(join(dataDir, 'episodes.json'));
    this.agentMemory = new AgentMemory(join(dataDir, 'memory.json'));

    // Shared stores (all agents share these)
    const sharedDir = dirname(config.EVENTS_JSONL_PATH);
    this.blueprints = new BlueprintStore(join(sharedDir, 'blueprints.json'));
    this.scripts = new ScriptStore(join(sharedDir, 'scripts.json'));
    this.worldIndex = new WorldIndex(join(sharedDir, 'world-index.json'));
    this.cityPlanStore = new JsonStore(join(sharedDir, 'city-plan.json'), { plan: null });
    this.templateStore = new TemplateStore(join(sharedDir, 'templates.json'));

    this.assetsDir = config.ASSETS_DIR;
  }

  // Add getter for agentId
  getAgentId(): string {
    return this.agentId;
  }

  // ... rest of the class unchanged ...
}
```

---

### Task 7: Personality-Aware Prompts
**Modify:** `src/supervisor/prompt-pack.ts`

Add personality support to the prompt builder:

```typescript
import { AgentPersonality } from '../types/agent-config.js';

// Add new function for multi-agent prompt building
export function buildMultiAgentPromptPack(opts: {
  mode: SupervisorMode;
  botRunner: BotRunner;
  nextObjective: string | null;
  personality: AgentPersonality;
  otherAgents: Array<{ agentId: string; name: string; role: string }>;
}): PromptPack {
  const { mode, botRunner, nextObjective, personality, otherAgents } = opts;
  const status = botRunner.getStatus();

  // --- System prompt with personality ---
  const systemParts: string[] = [
    `You are ${personality.name}, a Minecraft bot with the role of ${personality.role}.`,
    '',
    `YOUR PERSONALITY TRAITS: ${personality.traits.join(', ')}`,
    '',
    personality.systemPromptAddition,
    '',
    '--- OTHER AGENTS IN THIS WORLD ---',
    otherAgents.length > 0
      ? otherAgents.map(a => `- ${a.name} (${a.agentId}): ${a.role}`).join('\n')
      : '(No other agents currently active)',
    '',
    '--- COORDINATION RULES ---',
    '- Before building, ALWAYS claim a region with claimRegion to prevent conflicts.',
    '- Check messages regularly with getMessages — other agents may have requests.',
    '- Use sendMessage to coordinate with other agents (e.g., "Found good spot at 100,64,200").',
    '- Use listAgents to see who else is in the world.',
    '- Release your region with releaseRegion when done building.',
    '',
    MODE_INSTRUCTIONS[mode],
    '',
    BASE_RULES,
  ];

  // --- User message (same as before) ---
  const contextParts: string[] = [];

  if (nextObjective) {
    contextParts.push(`## Objective\n${nextObjective}`);
  } else {
    contextParts.push(`## Objective\nNo specific objective. Coordinate with other agents and contribute to the world.`);
  }

  const pos = status.bot.position;
  const posStr = pos ? `${pos.x.toFixed(0)}, ${pos.y.toFixed(0)}, ${pos.z.toFixed(0)}` : 'unknown';
  contextParts.push(`## You (${personality.name})\nPosition: ${posStr} | Role: ${personality.role}`);

  const memorySummary = botRunner.getMemorySummary();
  if (memorySummary) {
    contextParts.push(`## Your Memory\n${memorySummary}`);
  }

  contextParts.push(`## Context (pull via tools)
Call these as needed:
- getMessages: check for messages from other agents
- listAgents: see other agents and their roles
- readMemory: your persistent memory
- readEpisodeHistory: what you did in past episodes
- getWorldSummary: nearby structures
- getActiveCityPlan: city plan progress`);

  return {
    system: systemParts.join('\n'),
    userMessage: contextParts.join('\n\n'),
  };
}
```

---

### Task 8: Communication Tools for Supervisor
**Modify:** `src/supervisor/supervisor.ts`

Add new constructor parameters and tools:

```typescript
import { AgentMessenger } from '../coordinator/agent-messenger.js';
import { RegionManager } from '../coordinator/region-manager.js';
import { AgentCoordinator } from '../coordinator/agent-coordinator.js';
import { AgentPersonality } from '../types/agent-config.js';

export class Supervisor {
  // ... existing fields ...

  constructor(
    private readonly agentId: string,  // NEW
    private readonly config: AppConfig,
    private readonly events: EventBus<AppEvents>,
    private readonly botRunner: BotRunner,
    private readonly messenger: AgentMessenger,  // NEW
    private readonly regionManager: RegionManager,  // NEW
    private readonly coordinator: AgentCoordinator,  // NEW
    private readonly personality: AgentPersonality,  // NEW
  ) {
    this.stateStore = new JsonStore<SupervisorState>(
      join(dirname(config.EVENTS_JSONL_PATH), 'agents', agentId, 'supervisor-state.json'),
      { mode: 'explore', nextObjective: null },
    );
  }

  private buildTools() {
    // ... existing tools ...

    // === Multi-Agent Communication Tools ===
    const communicationTools = {
      sendMessage: tool({
        description: 'Send a message to another agent. Use for coordination, sharing discoveries, requesting help.',
        inputSchema: z.object({
          to: z.string().describe('Target agent ID (e.g., "builder_1", "explorer_1")'),
          message: z.string().max(500).describe('Message content'),
        }),
        execute: async ({ to, message }) => {
          this.messenger.send(to, message);
          return { sent: true, to, message };
        },
      }),

      broadcastMessage: tool({
        description: 'Send a message to ALL other agents. Use sparingly for important announcements.',
        inputSchema: z.object({
          message: z.string().max(500).describe('Message to broadcast'),
        }),
        execute: async ({ message }) => {
          this.messenger.broadcast(message);
          return { broadcast: true, message };
        },
      }),

      getMessages: tool({
        description: 'Check for messages from other agents. Call this regularly!',
        inputSchema: z.object({}),
        execute: async () => {
          const messages = this.messenger.getUnreadMessages();
          return {
            count: messages.length,
            messages: messages.map(m => ({
              from: m.from,
              content: m.content,
              ts: m.ts,
            })),
          };
        },
      }),

      listAgents: tool({
        description: 'List all other agents in the world with their roles and status',
        inputSchema: z.object({}),
        execute: async () => {
          return this.coordinator.getOtherAgents(this.agentId).map(a => ({
            agentId: a.agentId,
            name: a.config.personality.name,
            role: a.config.personality.role,
            traits: a.config.personality.traits,
            connected: a.runtime.isConnected(),
            position: a.runtime.getSnapshot().position,
          }));
        },
      }),
    };

    // === Region Management Tools ===
    const regionTools = {
      claimRegion: tool({
        description: 'Claim a region for building. Other agents cannot build here while claimed. ALWAYS claim before building!',
        inputSchema: z.object({
          bbox: z.object({
            min: z.object({ x: z.number().int(), y: z.number().int(), z: z.number().int() }),
            max: z.object({ x: z.number().int(), y: z.number().int(), z: z.number().int() }),
          }),
          durationMinutes: z.number().min(1).max(60).default(5).describe('How long to hold the claim'),
        }),
        execute: async ({ bbox, durationMinutes }) => {
          const success = this.regionManager.claim(this.agentId, bbox, durationMinutes * 60000);
          if (!success) {
            return { success: false, reason: 'Region overlaps with another agent\'s claim' };
          }
          return { success: true, bbox, expiresInMinutes: durationMinutes };
        },
      }),

      releaseRegion: tool({
        description: 'Release your currently claimed region. Do this when done building.',
        inputSchema: z.object({}),
        execute: async () => {
          this.regionManager.release(this.agentId);
          return { released: true };
        },
      }),

      extendClaim: tool({
        description: 'Extend your current region claim if you need more time',
        inputSchema: z.object({
          additionalMinutes: z.number().min(1).max(30).describe('Additional minutes to add'),
        }),
        execute: async ({ additionalMinutes }) => {
          const success = this.regionManager.extendClaim(this.agentId, additionalMinutes * 60000);
          return { success };
        },
      }),

      getMyRegion: tool({
        description: 'Get your currently claimed region',
        inputSchema: z.object({}),
        execute: async () => {
          const region = this.regionManager.getClaimedRegion(this.agentId);
          return region ? { claimed: true, bbox: region } : { claimed: false };
        },
      }),

      getAllClaimedRegions: tool({
        description: 'See all regions currently claimed by any agent',
        inputSchema: z.object({}),
        execute: async () => {
          return this.regionManager.getAllClaims().map(c => ({
            agentId: c.agentId,
            bbox: c.bbox,
            expiresIn: Math.round((c.expiresAt - Date.now()) / 1000) + 's',
          }));
        },
      }),

      checkRegionAvailable: tool({
        description: 'Check if a region is available for claiming',
        inputSchema: z.object({
          bbox: z.object({
            min: z.object({ x: z.number().int(), y: z.number().int(), z: z.number().int() }),
            max: z.object({ x: z.number().int(), y: z.number().int(), z: z.number().int() }),
          }),
        }),
        execute: async ({ bbox }) => {
          const available = this.regionManager.isRegionAvailable(bbox, this.agentId);
          return { available };
        },
      }),
    };

    return {
      ...coreTools,
      ...aestheticTools,
      ...worldIndexTools,
      ...cityPlanningTools,
      ...registryTools,
      ...rawCommandTools,
      ...proceduralTools,
      ...templateTools,
      ...memoryTools,
      ...controlTools,
      ...communicationTools,  // NEW
      ...regionTools,         // NEW
    };
  }

  // Update runEpisodeOnce to use personality-aware prompts
  private async runEpisodeOnce(): Promise<void> {
    const otherAgents = this.coordinator.getOtherAgents(this.agentId).map(a => ({
      agentId: a.agentId,
      name: a.config.personality.name,
      role: a.config.personality.role,
    }));

    const promptPack = buildMultiAgentPromptPack({
      mode: this.mode,
      botRunner: this.botRunner,
      nextObjective: this.nextObjective,
      personality: this.personality,
      otherAgents,
    });

    // ... rest of episode logic unchanged ...
  }
}
```

---

### Task 9: Update main.ts
**Modify:** `src/main.ts`

```typescript
import { loadConfig } from './config.js';
import { EventBus } from './events/event-bus.js';
import { AppEvents } from './events/event-types.js';
import { JsonlEventStore } from './events/jsonl-event-store.js';
import { buildServer } from './api/server.js';
import { AgentCoordinator } from './coordinator/agent-coordinator.js';
import { AgentConfig } from './types/agent-config.js';

const DEFAULT_AGENT_CONFIGS: AgentConfig[] = [
  {
    agentId: 'builder_1',
    username: 'BuilderBot',
    viewerPort: 3001,
    dataDir: '.data/agents/builder_1',
    personality: {
      name: 'Builder Bob',
      role: 'builder',
      traits: ['meticulous', 'patient', 'creative'],
      systemPromptAddition: `You are a master builder. Your job is to construct buildings.
- Always plan before building
- Use consistent materials within a structure
- Coordinate with Explorer for good build sites
- Message Decorator when a building frame is ready for finishing touches
- Vary your designs — no two buildings should be identical`,
    },
  },
  {
    agentId: 'explorer_1',
    username: 'ExplorerBot',
    viewerPort: 3002,
    dataDir: '.data/agents/explorer_1',
    personality: {
      name: 'Explorer Emma',
      role: 'explorer',
      traits: ['curious', 'energetic', 'helpful'],
      systemPromptAddition: `You love discovering new places and helping others find perfect spots.
- Scout terrain and find flat areas suitable for building
- Report interesting locations to Builder agents via messages
- Mark hazards and valuable resources
- You don't build much yourself — you find locations for others
- Walk the world physically (walkTo) to really explore`,
    },
  },
  {
    agentId: 'decorator_1',
    username: 'DecoratorBot',
    viewerPort: 3003,
    dataDir: '.data/agents/decorator_1',
    personality: {
      name: 'Decorator Dana',
      role: 'decorator',
      traits: ['artistic', 'detail-oriented', 'collaborative'],
      systemPromptAddition: `You add the finishing touches that make buildings feel alive.
- Wait for Builder to finish the structure before decorating
- Add interior furnishings: beds, tables, chairs, bookshelves
- Add exterior landscaping: paths, gardens, fences, lighting
- Summon villagers and animals to bring life to the world
- Check messages from Builder to know when buildings are ready`,
    },
  },
];

async function main() {
  const config = loadConfig();

  const events = new EventBus<AppEvents>();
  const eventStore = new JsonlEventStore<AppEvents>(config.EVENTS_JSONL_PATH);
  await eventStore.init();

  events.onAny(event => {
    void eventStore.append(event).catch(err => {
      console.error('eventStore.append failed', err);
    });
  });

  events.publish('app.start', { pid: process.pid });

  // Create coordinator instead of single agent
  const coordinator = new AgentCoordinator(config, events);

  // Load agent configs (could be from file in future)
  const agentConfigs = DEFAULT_AGENT_CONFIGS;

  // Create all agents
  for (const agentConfig of agentConfigs) {
    await coordinator.createAgent(agentConfig);
    events.publish('log.note', {
      text: `Created agent: ${agentConfig.personality.name} (${agentConfig.agentId})`,
      tags: ['startup', 'multi-agent'],
    });
  }

  // Connect all agents with staggered timing
  for (const agent of coordinator.getAllAgents()) {
    try {
      await agent.runtime.connect();
      events.publish('log.note', {
        text: `Connected: ${agent.config.personality.name}`,
        tags: ['startup', 'multi-agent'],
      });
      // Stagger connections to avoid overwhelming the server
      await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      events.publish('app.error', { message: `Failed to connect ${agent.agentId}: ${message}` });
    }
  }

  // Start API server with coordinator
  const server = await buildServer({ config, events, eventStore, coordinator });
  await server.listen({ port: config.PORT, host: config.HOST });

  // Start all supervisors if autostart enabled
  if (config.SUPERVISOR_AUTOSTART) {
    for (const agent of coordinator.getAllAgents()) {
      events.publish('log.note', {
        text: `Starting supervisor for ${agent.config.personality.name}`,
        tags: ['startup', 'multi-agent'],
      });
      void agent.supervisor.start();
      // Stagger supervisor starts
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }

  // --- Graceful shutdown ---
  async function shutdown(signal: string) {
    events.publish('log.note', { text: `shutdown requested (${signal})`, tags: ['lifecycle'] });

    for (const agent of coordinator.getAllAgents()) {
      agent.supervisor.stop(`shutdown: ${signal}`);
      agent.botRunner.cancelAllJobs();
      try {
        await agent.runtime.disconnect(`shutdown: ${signal}`);
      } catch { /* best effort */ }
    }

    try {
      await server.close();
    } catch { /* best effort */ }

    process.exit(0);
  }

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
```

---

### Task 10: Multi-Agent API Endpoints
**Modify:** `src/api/server.ts`

Update AppContext and add new endpoints:

```typescript
import { AgentCoordinator } from '../coordinator/agent-coordinator.js';

export type AppContext = {
  config: AppConfig;
  events: EventBus<AppEvents>;
  eventStore: JsonlEventStore<AppEvents>;
  coordinator: AgentCoordinator;  // CHANGED from individual agent/botRunner/supervisor
};

export async function buildServer(ctx: AppContext) {
  // ... existing setup ...

  // === Multi-Agent Endpoints ===

  // List all agents
  app.get('/v1/agents', async () => {
    return ctx.coordinator.getAllAgents().map(a => ({
      agentId: a.agentId,
      name: a.config.personality.name,
      role: a.config.personality.role,
      traits: a.config.personality.traits,
      connected: a.runtime.isConnected(),
      position: a.runtime.getSnapshot().position,
      supervisorRunning: a.supervisor.isRunning(),
      viewerPort: a.config.viewerPort,
    }));
  });

  // Get specific agent
  app.get('/v1/agents/:agentId', async (req, reply) => {
    const { agentId } = req.params as { agentId: string };
    const agent = ctx.coordinator.getAgent(agentId);
    if (!agent) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Agent not found' } });
    }
    return {
      agentId: agent.agentId,
      config: agent.config,
      status: agent.botRunner.getStatus(),
      supervisorRunning: agent.supervisor.isRunning(),
      supervisorMode: agent.supervisor.getMode(),
      messageCount: agent.messenger.getMessageCount(),
      claimedRegion: ctx.coordinator.regionManager.getClaimedRegion(agentId),
    };
  });

  // Start specific agent's supervisor
  app.post('/v1/agents/:agentId/supervisor/start', async (req, reply) => {
    const { agentId } = req.params as { agentId: string };
    const agent = ctx.coordinator.getAgent(agentId);
    if (!agent) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Agent not found' } });
    }
    if (!agent.supervisor.isRunning()) {
      void agent.supervisor.start();
    }
    return { ok: true };
  });

  // Stop specific agent's supervisor
  app.post('/v1/agents/:agentId/supervisor/stop', async (req, reply) => {
    const { agentId } = req.params as { agentId: string };
    const agent = ctx.coordinator.getAgent(agentId);
    if (!agent) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Agent not found' } });
    }
    agent.supervisor.stop('manual stop');
    return { ok: true };
  });

  // Set specific agent's objective
  app.post('/v1/agents/:agentId/supervisor/set-objective', async (req, reply) => {
    const { agentId } = req.params as { agentId: string };
    const parsed = parseBody(z.object({ objective: z.string().min(1).max(500) }), req.body);
    const agent = ctx.coordinator.getAgent(agentId);
    if (!agent) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Agent not found' } });
    }
    agent.supervisor.setObjective(parsed.objective);
    return { ok: true, objective: parsed.objective };
  });

  // Get all claimed regions
  app.get('/v1/regions', async () => {
    return ctx.coordinator.regionManager.getAllClaims();
  });

  // Connect specific agent
  app.post('/v1/agents/:agentId/connect', async (req, reply) => {
    const { agentId } = req.params as { agentId: string };
    const agent = ctx.coordinator.getAgent(agentId);
    if (!agent) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Agent not found' } });
    }
    await agent.runtime.connect();
    return { ok: true };
  });

  // Disconnect specific agent
  app.post('/v1/agents/:agentId/disconnect', async (req, reply) => {
    const { agentId } = req.params as { agentId: string };
    const agent = ctx.coordinator.getAgent(agentId);
    if (!agent) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Agent not found' } });
    }
    await agent.runtime.disconnect('manual disconnect');
    return { ok: true };
  });

  // Start ALL supervisors
  app.post('/v1/supervisors/start-all', async () => {
    for (const agent of ctx.coordinator.getAllAgents()) {
      if (!agent.supervisor.isRunning()) {
        void agent.supervisor.start();
      }
    }
    return { ok: true, count: ctx.coordinator.getAllAgents().length };
  });

  // Stop ALL supervisors
  app.post('/v1/supervisors/stop-all', async () => {
    for (const agent of ctx.coordinator.getAllAgents()) {
      agent.supervisor.stop('manual stop all');
    }
    return { ok: true };
  });

  // ... rest of existing routes (updated to use coordinator) ...

  return app;
}
```

---

## Example Personalities (Starter Set)

```typescript
const PERSONALITIES = {
  builder: {
    name: 'Builder Bob',
    role: 'builder',
    traits: ['meticulous', 'patient', 'creative'],
    systemPromptAddition: `You are a master builder. Your job is to construct buildings.
- Always plan before building
- Use consistent materials within a structure
- Coordinate with Explorer for good build sites
- Message Decorator when a building frame is ready
- Vary your designs — no two buildings should be identical`,
  },

  explorer: {
    name: 'Explorer Emma',
    role: 'explorer',
    traits: ['curious', 'energetic', 'helpful'],
    systemPromptAddition: `You love discovering new places.
- Scout terrain and find flat areas suitable for building
- Report interesting locations to Builder agents
- Mark hazards and resources
- You don't build much yourself, you find locations for others
- Walk the world physically to really explore`,
  },

  decorator: {
    name: 'Decorator Dana',
    role: 'decorator',
    traits: ['artistic', 'detail-oriented', 'collaborative'],
    systemPromptAddition: `You add finishing touches to buildings.
- Wait for Builder to finish structure before decorating
- Add interior furnishings: beds, tables, chairs, bookshelves
- Add landscaping: paths, gardens, lighting
- Summon villagers and animals
- Check messages from Builder to know when buildings are ready`,
  },
};
```

---

## Files Summary

### New Files (4)
| File | LOC | Purpose |
|------|-----|---------|
| `src/types/agent-config.ts` | ~30 | Type definitions |
| `src/coordinator/agent-coordinator.ts` | ~100 | Multi-agent lifecycle |
| `src/coordinator/region-manager.ts` | ~80 | Spatial conflict prevention |
| `src/coordinator/agent-messenger.ts` | ~90 | Inter-agent messaging |

### Modified Files (6)
| File | Changes |
|------|---------|
| `src/main.ts` | Use coordinator, load agent configs |
| `src/bot-runner.ts` | Accept agentId, per-agent data dirs |
| `src/supervisor/supervisor.ts` | Add communication & region tools |
| `src/supervisor/prompt-pack.ts` | Personality injection |
| `src/events/event-types.ts` | 6 new event types |
| `src/api/server.ts` | Multi-agent endpoints |

---

## Verification Tests

### Test 1: Multiple Connections
```
1. Start 2 agents with different usernames
2. Both connect to Minecraft server
3. Both appear as separate players in-game
```

### Test 2: Region Claiming
```
1. Agent A claims region at (0,64,0) to (50,100,50)
2. Agent B tries to claim overlapping region → FAILS
3. Agent B claims non-overlapping region → SUCCEEDS
4. Agent A releases region
5. Agent B can now claim that area
```

### Test 3: Messaging
```
1. Explorer finds good spot at (100, 64, 200)
2. Explorer sends message to Builder: "Found flat area at 100,64,200"
3. Builder receives message via getMessages
4. Builder claims that region and builds there
```

### Test 4: Cooperative Building
```
1. Explorer scouts, finds location, messages Builder
2. Builder claims region, constructs house frame
3. Builder messages Decorator: "House at 100,64,200 ready for decoration"
4. Decorator claims same region, adds furnishings
5. All three agents contributed to one building
```

---

## Running Multi-Agent Mode

### Server Requirements
The Minecraft server needs to accept multiple connections:
- `max-players=10` (or higher) in `server.properties`
- Op all bot usernames: `/op BuilderBot`, `/op ExplorerBot`, `/op DecoratorBot`

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/agents` | GET | List all agents |
| `/v1/agents/:id` | GET | Get agent details |
| `/v1/agents/:id/supervisor/start` | POST | Start agent's AI |
| `/v1/agents/:id/supervisor/stop` | POST | Stop agent's AI |
| `/v1/agents/:id/supervisor/set-objective` | POST | Set agent's goal |
| `/v1/agents/:id/connect` | POST | Connect agent to MC |
| `/v1/agents/:id/disconnect` | POST | Disconnect agent |
| `/v1/supervisors/start-all` | POST | Start all AIs |
| `/v1/supervisors/stop-all` | POST | Stop all AIs |
| `/v1/regions` | GET | List claimed regions |

### Viewers
Each agent has its own viewer port:
- Builder: http://localhost:3001
- Explorer: http://localhost:3002
- Decorator: http://localhost:3003

---

## Future Phases (Not In This PR)

After this foundation works:
- **Phase 2:** Social relationships (trust, reputation)
- **Phase 3:** Simple economy (trading resources)
- **Phase 4:** Governance (voting, laws)
- **Phase 5:** Conflict & emergent behaviors
