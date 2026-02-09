/**
 * AgentCoordinator - Central manager for multi-agent system
 *
 * Creates, manages, and coordinates multiple agents in the same Minecraft world.
 */

import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { AppConfig } from '../config.js';
import { EventBus } from '../events/event-bus.js';
import { AppEvents } from '../events/event-types.js';
import { AgentRuntime } from '../runtime/agent-runtime.js';
import { BotRunner } from '../bot-runner.js';
import { Supervisor } from '../supervisor/supervisor.js';
import { AgentConfig, AgentPersonality } from '../types/agent-config.js';
import { RegionManager } from './region-manager.js';
import { AgentMessenger } from './agent-messenger.js';

/**
 * Context for a single agent - contains all its components
 */
export type AgentContext = {
  agentId: string;
  config: AgentConfig;
  personality: AgentPersonality;
  runtime: AgentRuntime;
  botRunner: BotRunner;
  supervisor: Supervisor;
  messenger: AgentMessenger;
};

export class AgentCoordinator {
  private agents: Map<string, AgentContext> = new Map();
  readonly regionManager: RegionManager;

  constructor(
    private appConfig: AppConfig,
    private events: EventBus<AppEvents>,
  ) {
    this.regionManager = new RegionManager(events);
  }

  /**
   * Create a new agent with the given configuration
   */
  async createAgent(agentConfig: AgentConfig): Promise<AgentContext> {
    if (this.agents.has(agentConfig.agentId)) {
      throw new Error(`Agent ${agentConfig.agentId} already exists`);
    }

    // Ensure per-agent data directory exists
    await mkdir(agentConfig.dataDir, { recursive: true });

    // Create agent-specific config by overriding some values
    const agentAppConfig: AppConfig = {
      ...this.appConfig,
      MC_USERNAME: agentConfig.username,
      VIEWER_PORT: agentConfig.viewerPort,
      EVENTS_JSONL_PATH: join(agentConfig.dataDir, 'events.jsonl'),
      ASSETS_DIR: join(agentConfig.dataDir, 'assets'),
    };

    // Create runtime (mineflayer bot) - pass agentId for event identification
    const runtime = new AgentRuntime(agentAppConfig, this.events, agentConfig.agentId);

    // Create bot runner with per-agent data paths
    const botRunner = new BotRunner(agentAppConfig, this.events, runtime, agentConfig.agentId);
    await botRunner.init();

    // Create messenger
    const messenger = new AgentMessenger(agentConfig.agentId, this.events);

    // Create supervisor with personality
    const supervisor = new Supervisor(
      agentAppConfig,
      this.events,
      botRunner,
      agentConfig.agentId,
      agentConfig.personality,
      this,  // Pass coordinator for inter-agent tools
    );
    await supervisor.init();

    const context: AgentContext = {
      agentId: agentConfig.agentId,
      config: agentConfig,
      personality: agentConfig.personality,
      runtime,
      botRunner,
      supervisor,
      messenger,
    };

    this.agents.set(agentConfig.agentId, context);

    this.events.publish('agent.created', {
      agentId: agentConfig.agentId,
      personality: agentConfig.personality.name,
    });

    return context;
  }

  /**
   * Connect an agent to the Minecraft server
   */
  async connectAgent(agentId: string): Promise<void> {
    const context = this.agents.get(agentId);
    if (!context) throw new Error(`Agent ${agentId} not found`);

    await context.runtime.connect();
  }

  /**
   * Disconnect an agent from the Minecraft server
   */
  async disconnectAgent(agentId: string, reason: string = 'manual disconnect'): Promise<void> {
    const context = this.agents.get(agentId);
    if (!context) throw new Error(`Agent ${agentId} not found`);

    context.supervisor.stop(reason);
    await context.runtime.disconnect(reason);
  }

  /**
   * Destroy an agent - disconnect and remove from coordinator
   */
  async destroyAgent(agentId: string, reason: string = 'destroyed'): Promise<void> {
    const context = this.agents.get(agentId);
    if (!context) return;

    context.supervisor.stop(reason);
    this.regionManager.release(agentId);

    try {
      await context.runtime.disconnect(reason);
    } catch {
      // Best effort
    }

    this.agents.delete(agentId);

    this.events.publish('agent.destroyed', { agentId, reason });
  }

  /**
   * Get an agent by ID
   */
  getAgent(agentId: string): AgentContext | undefined {
    return this.agents.get(agentId);
  }

  /**
   * Get all agents
   */
  getAllAgents(): AgentContext[] {
    return Array.from(this.agents.values());
  }

  /**
   * Get list of agent IDs
   */
  getAgentIds(): string[] {
    return Array.from(this.agents.keys());
  }

  /**
   * Get summary of all agents for display
   */
  getAgentsSummary(): Array<{
    agentId: string;
    name: string;
    role: string;
    connected: boolean;
    supervisorRunning: boolean;
  }> {
    return this.getAllAgents().map(ctx => ({
      agentId: ctx.agentId,
      name: ctx.personality.name,
      role: ctx.personality.role,
      connected: ctx.runtime.isConnected(),
      supervisorRunning: ctx.supervisor.isRunning(),
    }));
  }

  /**
   * Start supervisor for an agent
   */
  startSupervisor(agentId: string): void {
    const context = this.agents.get(agentId);
    if (!context) throw new Error(`Agent ${agentId} not found`);

    void context.supervisor.start();
  }

  /**
   * Stop supervisor for an agent
   */
  stopSupervisor(agentId: string, reason: string = 'manual stop'): void {
    const context = this.agents.get(agentId);
    if (!context) throw new Error(`Agent ${agentId} not found`);

    context.supervisor.stop(reason);
  }

  /**
   * Start supervisors for all agents
   */
  startAllSupervisors(): void {
    for (const context of this.agents.values()) {
      void context.supervisor.start();
    }
  }

  /**
   * Stop supervisors for all agents
   */
  stopAllSupervisors(reason: string = 'manual stop'): void {
    for (const context of this.agents.values()) {
      context.supervisor.stop(reason);
    }
  }

  /**
   * Send a message from one agent to another
   */
  sendMessage(fromAgentId: string, toAgentId: string, content: string): void {
    const fromContext = this.agents.get(fromAgentId);
    if (!fromContext) throw new Error(`Agent ${fromAgentId} not found`);

    fromContext.messenger.send(toAgentId, content);
  }

  /**
   * Broadcast a message from an agent to all other agents
   */
  broadcastMessage(fromAgentId: string, content: string): void {
    const fromContext = this.agents.get(fromAgentId);
    if (!fromContext) throw new Error(`Agent ${fromAgentId} not found`);

    fromContext.messenger.broadcast(content);
  }

  /**
   * Shutdown all agents
   */
  async shutdown(reason: string = 'shutdown'): Promise<void> {
    const agentIds = this.getAgentIds();
    await Promise.all(agentIds.map(id => this.destroyAgent(id, reason)));
  }
}
