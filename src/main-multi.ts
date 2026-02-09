/**
 * Multi-Agent Entry Point
 *
 * Runs multiple Claude-powered agents in the same Minecraft world.
 * Each agent has a unique personality and role.
 */

import { join, dirname } from 'node:path';
import { createServer } from 'node:net';
import { loadConfig } from './config.js';
import { EventBus } from './events/event-bus.js';
import { AppEvents } from './events/event-types.js';
import { JsonlEventStore } from './events/jsonl-event-store.js';
import { buildServer } from './api/server.js';
import { AgentCoordinator } from './coordinator/agent-coordinator.js';
import { AgentConfig, PERSONALITIES } from './types/agent-config.js';

/**
 * Check if a port is available. Returns true if port is free, false if in use.
 */
async function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => {
      resolve(false);
    });
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, '127.0.0.1');
  });
}

/**
 * Wait for a port to become available, with timeout.
 * Useful when restarting after a crash where ports may still be bound.
 */
async function waitForPort(port: number, timeoutMs: number = 10000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isPortAvailable(port)) {
      return true;
    }
    console.log(`  Port ${port} still in use, waiting...`);
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  return false;
}

const MAX_RECONNECT_DELAY = 120_000;  // 2 minutes max backoff
const BASE_RECONNECT_DELAY = 5_000;   // 5 seconds base delay (was 2s, too aggressive)

// Default agent configurations - can be overridden via environment or config file
const DEFAULT_AGENTS: AgentConfig[] = [
  {
    agentId: 'builder_1',
    username: 'BuilderBot',
    personality: PERSONALITIES.builder!,
    viewerPort: 3001,
    dataDir: '.data/agents/builder_1',
  },
  {
    agentId: 'explorer_1',
    username: 'ExplorerBot',
    personality: PERSONALITIES.explorer!,
    viewerPort: 3002,
    dataDir: '.data/agents/explorer_1',
  },
  {
    agentId: 'builder_2',
    username: 'BuilderMax',
    personality: PERSONALITIES.builderFast!,
    viewerPort: 3003,
    dataDir: '.data/agents/builder_2',
  },
  // Warriors - protect the builders from hostile mobs
  {
    agentId: 'warrior_1',
    username: 'WarriorWolf',
    personality: PERSONALITIES.warrior!,
    viewerPort: 3004,
    dataDir: '.data/agents/warrior_1',
  },
  {
    agentId: 'warrior_2',
    username: 'WarriorShadow',
    personality: PERSONALITIES.warriorNight!,
    viewerPort: 3005,
    dataDir: '.data/agents/warrior_2',
  },
  {
    agentId: 'warrior_3',
    username: 'WarriorStone',
    personality: PERSONALITIES.warriorGuard!,
    viewerPort: 3006,
    dataDir: '.data/agents/warrior_3',
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

  // Create coordinator
  const coordinator = new AgentCoordinator(config, events);

  // Parse agent configs from environment or use defaults
  const agentConfigs = parseAgentConfigs() ?? DEFAULT_AGENTS;

  console.log(`Starting multi-agent system with ${agentConfigs.length} agents...`);

  // Create all agents
  for (const agentConfig of agentConfigs) {
    console.log(`  Creating agent: ${agentConfig.personality.name} (${agentConfig.agentId})`);
    await coordinator.createAgent(agentConfig);
  }

  // Set up reconnection logic for each agent
  let shuttingDown = false;

  // Stagger connection delay to avoid server throttling
  // 10 seconds between agent connections prevents connection spam
  const CONNECTION_STAGGER_MS = 10_000;

  // Connect agents sequentially with delay to avoid throttling
  const allAgents = coordinator.getAllAgents();
  for (let i = 0; i < allAgents.length; i++) {
    const context = allAgents[i]!;
    const agentId = context.agentId;
    const viewerPort = context.config.viewerPort;

    // Wait before connecting (except for first agent)
    if (i > 0) {
      console.log(`  Waiting ${CONNECTION_STAGGER_MS / 1000}s before connecting next agent...`);
      await new Promise(resolve => setTimeout(resolve, CONNECTION_STAGGER_MS));
    }

    // Check viewer port availability before connecting
    console.log(`  Checking port ${viewerPort} for ${context.personality.name}...`);
    const portAvailable = await waitForPort(viewerPort, 15000);
    if (!portAvailable) {
      console.error(`  WARNING: Port ${viewerPort} still in use after 15s. Viewer may not start for ${context.personality.name}.`);
      events.publish('app.error', {
        message: `Port ${viewerPort} in use - viewer for ${agentId} may fail. Try: lsof -ti:${viewerPort} | xargs kill -9`,
      });
    }

    async function connectWithRetry(): Promise<void> {
      let reconnectAttempts = 0;
      while (!shuttingDown) {
        try {
          await context.runtime.connect();
          reconnectAttempts = 0;
          console.log(`  Agent ${context.personality.name} connected`);
          return;
        } catch (err) {
          reconnectAttempts += 1;
          const message = err instanceof Error ? err.message : String(err);
          events.publish('app.error', { message: `${agentId} connect failed (attempt ${reconnectAttempts}): ${message}` });
          // Longer delay for throttling errors
          const isThrottled = message.includes('throttled');
          const baseDelay = isThrottled ? 10000 : BASE_RECONNECT_DELAY;
          const delay = Math.min(baseDelay * 2 ** (reconnectAttempts - 1), MAX_RECONNECT_DELAY);
          events.publish('log.note', { text: `${agentId} retrying connection in ${delay}ms`, tags: ['reconnect'] });
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    // Track reconnection state to prevent duplicate reconnection attempts
    let isReconnecting = false;

    // Set up reconnection handler for this specific agent
    const handleDisconnect = (event: { data: { agentId?: string } }) => {
      // Only handle events for THIS agent
      if (event.data.agentId !== agentId) return;
      if (shuttingDown) return;
      if (isReconnecting) return;

      events.publish('log.note', { text: `${agentId} disconnected, scheduling reconnect`, tags: ['reconnect'] });

      isReconnecting = true;
      setTimeout(async () => {
        try {
          if (!shuttingDown && !context.runtime.isConnected()) {
            await connectWithRetry();
          }
        } finally {
          isReconnecting = false;
        }
      }, BASE_RECONNECT_DELAY);
    };

    // Listen for this agent's disconnects - filter by agentId in the event data
    events.onType('bot.end', handleDisconnect);
    events.onType('bot.kicked', handleDisconnect);

    // Initial connection
    await connectWithRetry();
  }

  // Start supervisors if autostart is enabled
  if (config.SUPERVISOR_AUTOSTART) {
    console.log('Starting all supervisors...');
    for (const context of coordinator.getAllAgents()) {
      void context.supervisor.start();
      console.log(`  Supervisor started for ${context.personality.name}`);
    }
  }

  // Build and start the API server with coordinator
  const server = await buildServer({
    config,
    events,
    eventStore,
    coordinator,
    // For single-agent API compatibility, use first agent
    agent: coordinator.getAllAgents()[0]?.runtime,
    supervisor: coordinator.getAllAgents()[0]?.supervisor,
    botRunner: coordinator.getAllAgents()[0]?.botRunner,
  });
  await server.listen({ port: config.PORT, host: config.HOST });

  console.log(`\nMulti-agent system running!`);
  console.log(`  API: http://${config.HOST}:${config.PORT}`);
  console.log(`  Agents:`);
  for (const ctx of coordinator.getAllAgents()) {
    console.log(`    - ${ctx.personality.name} (${ctx.agentId}): viewer on port ${ctx.config.viewerPort}`);
  }

  // --- Graceful shutdown ---
  async function shutdown(signal: string) {
    if (shuttingDown) return;
    shuttingDown = true;
    events.publish('log.note', { text: `shutdown requested (${signal})`, tags: ['lifecycle'] });

    console.log('\nShutting down...');
    await coordinator.shutdown(`shutdown: ${signal}`);

    try {
      await server.close();
    } catch { /* best effort */ }

    process.exit(0);
  }

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  process.on('uncaughtException', err => {
    events.publish('app.error', { message: `uncaughtException: ${err.message}`, stack: err.stack });
    console.error('uncaughtException:', err);
  });

  process.on('unhandledRejection', reason => {
    const message = reason instanceof Error ? reason.message : String(reason);
    const stack = reason instanceof Error ? reason.stack : undefined;
    events.publish('app.error', { message: `unhandledRejection: ${message}`, stack });
    console.error('unhandledRejection:', reason);
  });
}

/**
 * Parse agent configs from AGENTS environment variable
 * Format: AGENTS=builder:BuilderBot:3001,explorer:ExplorerBot:3002
 */
function parseAgentConfigs(): AgentConfig[] | null {
  const agentsEnv = process.env.AGENTS;
  if (!agentsEnv) return null;

  const configs: AgentConfig[] = [];
  const parts = agentsEnv.split(',');

  for (let i = 0; i < parts.length; i++) {
    const [role, username, portStr] = parts[i]!.split(':');
    if (!role || !username) continue;

    const personality = PERSONALITIES[role] ?? PERSONALITIES.general!;
    const viewerPort = portStr ? parseInt(portStr, 10) : 3001 + i;

    configs.push({
      agentId: `${role}_${i + 1}`,
      username,
      personality: { ...personality, name: username },
      viewerPort,
      dataDir: `.data/agents/${role}_${i + 1}`,
    });
  }

  return configs.length > 0 ? configs : null;
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
