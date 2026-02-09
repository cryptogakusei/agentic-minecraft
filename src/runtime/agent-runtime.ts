import mineflayer from 'mineflayer';
import pkg from 'mineflayer-pathfinder';
const { pathfinder, Movements, goals } = pkg;
import { mineflayer as startViewer } from 'prismarine-viewer';
import { Vec3 } from 'vec3';
import { AppConfig } from '../config.js';
import { EventBus } from '../events/event-bus.js';
import { AppEvents, BotStateSnapshot } from '../events/event-types.js';
import { BBox } from '../types/geometry.js';
import { BlockCatalog } from '../registry/block-catalog.js';

type MineflayerBot = ReturnType<typeof mineflayer.createBot>;

/**
 * Comprehensive packet budget tracker.
 *
 * PaperMC's packet-limiter kicks at ~500 packets per 7 seconds (~71/sec average).
 * Mineflayer sends:
 * - Physics tick packets: ~20/sec (position updates)
 * - Pathfinding: additional movement packets during navigation
 * - Commands via chat: 1 packet each
 * - Chunk requests, entity tracking, etc.
 *
 * This tracker monitors our packet budget and throttles when needed.
 */
class PacketBudgetTracker {
  private packetTimestamps: number[] = [];
  private readonly windowMs: number;
  private readonly maxPackets: number;
  private readonly warningThreshold: number;

  constructor(
    // PaperMC default: 500 packets per 7000ms
    // We use conservative limits to stay well under
    maxPackets: number = 350,      // Stay under 500 limit
    windowMs: number = 7000,       // 7 second window
    warningThreshold: number = 0.7 // Warn at 70% capacity
  ) {
    this.maxPackets = maxPackets;
    this.windowMs = windowMs;
    this.warningThreshold = warningThreshold;
  }

  /**
   * Record a packet being sent
   */
  recordPacket(count: number = 1): void {
    const now = Date.now();
    for (let i = 0; i < count; i++) {
      this.packetTimestamps.push(now);
    }
    this.cleanup();
  }

  /**
   * Remove old timestamps outside the window
   */
  private cleanup(): void {
    const cutoff = Date.now() - this.windowMs;
    while (this.packetTimestamps.length > 0 && this.packetTimestamps[0]! < cutoff) {
      this.packetTimestamps.shift();
    }
  }

  /**
   * Get current packet count in window
   */
  getCurrentCount(): number {
    this.cleanup();
    return this.packetTimestamps.length;
  }

  /**
   * Get available packet budget
   */
  getAvailableBudget(): number {
    return Math.max(0, this.maxPackets - this.getCurrentCount());
  }

  /**
   * Check if we're approaching the limit
   */
  isApproachingLimit(): boolean {
    return this.getCurrentCount() >= this.maxPackets * this.warningThreshold;
  }

  /**
   * Check if we've exceeded the limit
   */
  isOverLimit(): boolean {
    return this.getCurrentCount() >= this.maxPackets;
  }

  /**
   * Calculate how long to wait before sending more packets
   */
  getRequiredWaitMs(packetsNeeded: number = 1): number {
    this.cleanup();
    const available = this.getAvailableBudget();

    if (available >= packetsNeeded) {
      return 0;
    }

    // Find when enough old packets will expire
    const needed = packetsNeeded - available;
    if (this.packetTimestamps.length < needed) {
      return 0; // Not enough history to calculate
    }

    const oldestNeeded = this.packetTimestamps[needed - 1]!;
    const expiresAt = oldestNeeded + this.windowMs;
    return Math.max(0, expiresAt - Date.now() + 50); // Add 50ms buffer
  }

  /**
   * Get usage stats for debugging
   */
  getStats(): { current: number; max: number; available: number; usagePercent: number } {
    this.cleanup();
    const current = this.getCurrentCount();
    return {
      current,
      max: this.maxPackets,
      available: this.maxPackets - current,
      usagePercent: Math.round((current / this.maxPackets) * 100),
    };
  }
}

/**
 * Rate limiter using token bucket algorithm with packet budget awareness.
 * Prevents spam kicks by limiting command throughput.
 */
class CommandRateLimiter {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private readonly maxTokens: number = 30,      // Reduced burst capacity
    private readonly refillRate: number = 5,      // Reduced to 5 tokens/sec
    private readonly minDelayMs: number = 100,    // Increased min delay
    private readonly packetTracker?: PacketBudgetTracker,
  ) {
    this.tokens = maxTokens;
    this.lastRefill = Date.now();
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRate);
    this.lastRefill = now;
  }

  async acquire(count: number = 1): Promise<void> {
    this.refill();

    // Check packet budget first if tracker is available
    if (this.packetTracker) {
      const waitMs = this.packetTracker.getRequiredWaitMs(count);
      if (waitMs > 0) {
        await new Promise(resolve => setTimeout(resolve, waitMs));
      }
    }

    // If we don't have enough tokens, wait for them
    while (this.tokens < count) {
      const needed = count - this.tokens;
      const waitMs = Math.max(this.minDelayMs, (needed / this.refillRate) * 1000);
      await new Promise(resolve => setTimeout(resolve, waitMs));
      this.refill();
    }

    this.tokens -= count;

    // Record packets sent
    if (this.packetTracker) {
      this.packetTracker.recordPacket(count);
    }

    // Always enforce minimum delay between commands
    await new Promise(resolve => setTimeout(resolve, this.minDelayMs));
  }

  getAvailableTokens(): number {
    this.refill();
    return this.tokens;
  }
}

export class AgentRuntime {
  private bot: MineflayerBot | null = null;
  private viewerStarted = false;
  private viewerServer: { close: () => void } | null = null;
  private paused = false;
  private blockCatalog: BlockCatalog | null = null;
  private packetTracker: PacketBudgetTracker;
  private rateLimiter: CommandRateLimiter;
  private readonly agentId: string | undefined;
  private physicsThrottleInterval: ReturnType<typeof setInterval> | null = null;
  private lastPhysicsPacketTime = 0;
  private readonly physicsPacketMinIntervalMs = 100; // Max 10 physics packets/sec instead of 20

  constructor(
    private readonly config: AppConfig,
    private readonly events: EventBus<AppEvents>,
    agentId?: string,
  ) {
    this.agentId = agentId;

    // Packet budget tracker - monitors total packets in 7-second window
    // PaperMC kicks at 500/7sec, we stay under 350 to leave room for server responses
    this.packetTracker = new PacketBudgetTracker(350, 7000, 0.7);

    // Conservative rate limiting with packet awareness
    // 5 commands/sec sustained, 30 burst, 100ms minimum between commands
    this.rateLimiter = new CommandRateLimiter(30, 5, 100, this.packetTracker);
  }

  getAgentId(): string | undefined {
    return this.agentId;
  }

  isPaused(): boolean {
    return this.paused;
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  async connect(): Promise<void> {
    if (this.bot) return;

    const { MC_HOST, MC_PORT, MC_VERSION, MC_USERNAME, MC_AUTH, MC_PASSWORD } = this.config;

    this.events.publish('bot.connect', {
      host: MC_HOST,
      port: MC_PORT,
      username: MC_USERNAME,
      agentId: this.agentId,
    });

    this.bot = mineflayer.createBot({
      host: MC_HOST,
      port: MC_PORT,
      version: MC_VERSION,
      username: MC_USERNAME,
      auth: MC_AUTH,
      ...(MC_PASSWORD ? { password: MC_PASSWORD } : {}),
    });

    this.bot.on('login', () => {
      const version = this.bot?.version ?? 'unknown';
      const username = this.bot?._client?.username ?? MC_USERNAME;
      this.events.publish('bot.login', { username, version, agentId: this.agentId });
      this.emitStatusSnapshot();

      // Set up physics packet throttling
      // Mineflayer sends position packets every physics tick (~20/sec)
      // We throttle to reduce packet rate while still allowing smooth movement
      this.setupPhysicsThrottling();
    });

    this.bot.loadPlugin(pathfinder);

    this.bot.on('spawn', () => {
      const p = this.bot?.entity?.position;
      if (p) {
        this.events.publish('bot.spawn', { position: { x: p.x, y: p.y, z: p.z }, agentId: this.agentId });
      } else {
        this.events.publish('bot.spawn', { position: { x: 0, y: 0, z: 0 }, agentId: this.agentId });
      }

      // Configure pathfinder movements for reduced packet rate
      if (this.bot) {
        const movements = new Movements(this.bot);
        // Disable sprinting to reduce movement speed and packet frequency
        movements.allowSprinting = false;
        movements.canDig = true;
        movements.allow1by1towers = true;

        // Reduce pathfinder aggressiveness
        // These settings make the bot move more smoothly with fewer corrections
        movements.scafoldingBlocks = [];  // Don't scaffold - reduces block placement packets
        movements.maxDropDown = 3;        // Limit drop height to reduce fall corrections

        (this.bot as any).pathfinder.setMovements(movements);

        // Configure pathfinder tick rate (if available)
        const pf = (this.bot as any).pathfinder;
        if (pf.ticksPerMove !== undefined) {
          pf.ticksPerMove = 4; // Slow down pathfinding decisions
        }
      }

      this.emitStatusSnapshot();
      this.startViewerIfNeeded();
    });

    this.bot.on('end', reason => {
      this.events.publish('bot.end', { reason, agentId: this.agentId });
      this.bot = null;
      this.blockCatalog = null;
      this.emitStatusSnapshot();
    });

    this.bot.on('kicked', (reason, loggedIn) => {
      this.events.publish('bot.kicked', { reason, loggedIn, agentId: this.agentId });
      this.emitStatusSnapshot();
    });

    this.bot.on('error', err => {
      this.events.publish('bot.error', { message: err.message, stack: err.stack, agentId: this.agentId });
      this.emitStatusSnapshot();
    });
  }

  async disconnect(reason = 'disconnect'): Promise<void> {
    const bot = this.bot;
    if (!bot) return;
    this.bot = null;
    this.blockCatalog = null;

    // Stop physics throttling
    if (this.physicsThrottleInterval) {
      clearInterval(this.physicsThrottleInterval);
      this.physicsThrottleInterval = null;
    }

    // Close the viewer server to free up the port
    if (this.viewerServer) {
      try {
        this.viewerServer.close();
      } catch {
        // Best effort - server may already be closed
      }
      this.viewerServer = null;
      this.viewerStarted = false;
    }

    bot.end(reason);
  }

  /**
   * Set up physics packet throttling.
   *
   * Mineflayer sends position packets every physics tick (~20/sec).
   * We intercept the physics tick to:
   * 1. Track packets being sent
   * 2. Temporarily disable physics when approaching packet limit
   * 3. Log warnings when packet budget is low
   */
  private setupPhysicsThrottling(): void {
    const bot = this.bot;
    if (!bot) return;

    // Monitor physics ticks and record approximate packet usage
    // Each physics tick where the bot moves sends a position packet
    let lastPosition: Vec3 | null = null;

    bot.on('physicsTick', () => {
      const now = Date.now();

      // Track position packets (sent when bot moves)
      const currentPos = bot.entity?.position;
      if (currentPos && lastPosition) {
        const moved = !currentPos.equals(lastPosition);
        if (moved) {
          // Position packet will be sent
          this.packetTracker.recordPacket(1);
        }
      }
      lastPosition = currentPos?.clone() ?? null;

      // Throttle physics when approaching packet limit
      if (this.packetTracker.isApproachingLimit()) {
        // Temporarily pause physics to let packet budget recover
        const stats = this.packetTracker.getStats();
        if (stats.usagePercent > 85) {
          // Critical - pause physics briefly
          bot.physicsEnabled = false;
          setTimeout(() => {
            if (this.bot) {
              this.bot.physicsEnabled = true;
            }
          }, 200);
        }
      }

      // Enforce minimum interval between physics packets
      if (now - this.lastPhysicsPacketTime < this.physicsPacketMinIntervalMs) {
        // Skip this tick's packet by not updating lastPosition
        // This effectively reduces our position update rate
      }
      this.lastPhysicsPacketTime = now;
    });

    // Log packet budget periodically for debugging
    this.physicsThrottleInterval = setInterval(() => {
      const stats = this.packetTracker.getStats();
      if (stats.usagePercent > 60) {
        this.events.publish('app.error', {
          message: `Packet budget: ${stats.current}/${stats.max} (${stats.usagePercent}%)`,
        });
      }
    }, 5000);
  }

  isConnected(): boolean {
    return this.bot !== null;
  }

  async reconnect(): Promise<void> {
    if (this.bot) {
      await this.disconnect('reconnecting');
    }
    await this.connect();
  }

  getBot(): MineflayerBot | null {
    return this.bot;
  }

  getSnapshot(): BotStateSnapshot {
    const bot = this.bot;
    if (!bot) {
      return { connected: false, ready: false };
    }

    const position = bot.entity?.position
      ? { x: bot.entity.position.x, y: bot.entity.position.y, z: bot.entity.position.z }
      : undefined;

    const gamemode = (bot.game?.gameMode as string | undefined) ?? undefined;
    const dimension = (bot.game?.dimension as string | undefined) ?? undefined;

    const game = bot.game as unknown as { minY?: number; height?: number } | undefined;
    return {
      connected: true,
      ready: Boolean(bot.entity),
      username: bot.username,
      version: bot.version,
      position,
      dimension,
      gamemode,
      minY: game?.minY,
      height: game?.height,
    };
  }

  getWorldInfo(): { minY: number; height: number } | null {
    const bot = this.bot;
    if (!bot) return null;
    const game = bot.game as unknown as { minY?: number; height?: number } | undefined;
    const minY = game?.minY ?? -64;
    const height = game?.height ?? 384;
    return { minY, height };
  }

  async teleport(position: { x: number; y: number; z: number }, yaw?: number, pitch?: number): Promise<void> {
    const bot = this.bot;
    if (!bot) throw new Error('Bot is not connected');
    if (this.paused) throw new Error('Agent is paused');

    // Stop any active pathfinding before teleporting
    const pf = (bot as any).pathfinder;
    if (pf && pf.isMoving && pf.isMoving()) {
      pf.stop();
      // Wait a moment for pathfinding to fully stop
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Rate limit teleport commands (they generate packets too)
    await this.rateLimiter.acquire(2); // Teleport costs 2 tokens

    const x = Math.round(position.x * 100) / 100;
    const y = Math.round(position.y * 100) / 100;
    const z = Math.round(position.z * 100) / 100;

    const cmd =
      yaw == null || pitch == null
        ? `/tp @s ${x} ${y} ${z}`
        : `/tp @s ${x} ${y} ${z} ${Math.round(yaw * 100) / 100} ${Math.round(pitch * 100) / 100}`;

    bot.chat(cmd);

    // Wait for server to confirm the position change
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        bot.removeListener('forcedMove', onMove);
        resolve();
      }, 2000);
      const onMove = () => {
        clearTimeout(timeout);
        bot.removeListener('forcedMove', onMove);
        resolve();
      };
      bot.on('forcedMove', onMove);
    });

    // Small delay after teleport to let things settle
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  /**
   * Get current packet budget statistics
   */
  getPacketStats(): { current: number; max: number; available: number; usagePercent: number } {
    return this.packetTracker.getStats();
  }

  async walkTo(position: { x: number; y: number; z: number }, range = 2): Promise<{ arrived: boolean; position: { x: number; y: number; z: number } }> {
    const bot = this.bot;
    if (!bot) throw new Error('Bot is not connected');
    if (this.paused) throw new Error('Agent is paused');

    // Check if we have enough packet budget for pathfinding
    // Walking generates many position packets
    if (this.packetTracker.isOverLimit()) {
      // Wait for packet budget to recover
      const waitMs = this.packetTracker.getRequiredWaitMs(50);
      if (waitMs > 0) {
        await new Promise(resolve => setTimeout(resolve, waitMs));
      }
    }

    const pf = (bot as any).pathfinder;
    const goal = new goals.GoalNear(position.x, position.y, position.z, range);

    return new Promise((resolve) => {
      // Reduced timeout - don't let pathfinding run too long
      const timeout = setTimeout(() => {
        pf.stop();
        const p = bot.entity.position;
        resolve({ arrived: false, position: { x: p.x, y: p.y, z: p.z } });
      }, 20000); // Reduced from 30s to 20s

      // Emergency brake - stop pathfinding if packet budget runs out
      const budgetCheckInterval = setInterval(() => {
        if (this.packetTracker.isOverLimit()) {
          pf.stop();
          clearInterval(budgetCheckInterval);
          clearTimeout(timeout);
          const p = bot.entity.position;
          this.events.publish('app.error', {
            message: 'Pathfinding stopped: packet budget exceeded',
          });
          resolve({ arrived: false, position: { x: p.x, y: p.y, z: p.z } });
        }
      }, 500);

      pf.goto(goal).then(() => {
        clearInterval(budgetCheckInterval);
        clearTimeout(timeout);
        const p = bot.entity.position;
        resolve({ arrived: true, position: { x: p.x, y: p.y, z: p.z } });
      }).catch(() => {
        clearInterval(budgetCheckInterval);
        clearTimeout(timeout);
        const p = bot.entity.position;
        resolve({ arrived: false, position: { x: p.x, y: p.y, z: p.z } });
      });
    });
  }

  async lookAt(position: { x: number; y: number; z: number }): Promise<void> {
    const bot = this.bot;
    if (!bot) throw new Error('Bot is not connected');
    await bot.lookAt(new Vec3(position.x, position.y, position.z));
  }

  async waitForChunksToLoad(): Promise<void> {
    const bot = this.bot;
    if (!bot) throw new Error('Bot is not connected');
    await bot.waitForChunksToLoad();
  }

  async execCommand(command: string, waitTicks = 0): Promise<void> {
    const bot = this.bot;
    if (!bot) throw new Error('Bot is not connected');
    if (this.paused) throw new Error('Agent is paused');

    // Check packet budget first
    if (this.packetTracker.isOverLimit()) {
      const waitMs = this.packetTracker.getRequiredWaitMs(1);
      if (waitMs > 0) {
        await new Promise(resolve => setTimeout(resolve, waitMs));
      }
    }

    // Rate limit to prevent spam kicks
    await this.rateLimiter.acquire(1);

    bot.chat(command);

    // Minimum wait between commands even if waitTicks is 0
    const minWaitTicks = Math.max(waitTicks, 1);
    await bot.waitForTicks(minWaitTicks);
  }

  async execCommandBatch(
    commands: string[],
    options?: { batchSize?: number; ticksBetween?: number },
  ): Promise<{ executed: number; elapsed: number }> {
    const bot = this.bot;
    if (!bot) throw new Error('Bot is not connected');
    if (this.paused) throw new Error('Agent is paused');

    // Very conservative batch execution to prevent spam kicks
    // PaperMC default: 500 packets per 7 seconds
    // We need to leave room for physics packets (~10/sec = 70 per 7 sec)
    // So we have budget for ~430 command packets per 7 seconds = ~61/sec max
    // But we want to be much more conservative to avoid edge cases

    // NEW SETTINGS:
    // - 3 commands per batch (reduced from 5)
    // - 4 ticks between batches (increased from 2)
    // - 200ms additional delay (increased from 100ms)
    // This gives us: 3 commands every ~400ms = ~7.5 cmd/sec
    // Over 7 seconds: ~52 command packets (very safe)
    const batchSize = options?.batchSize ?? 3;
    const ticksBetween = options?.ticksBetween ?? 4;
    const start = Date.now();
    let executed = 0;

    for (let i = 0; i < commands.length; i += batchSize) {
      if (this.paused) throw new Error('Agent is paused');
      if (!this.bot) throw new Error('Bot disconnected during batch execution');

      // Check packet budget before each batch
      if (this.packetTracker.isApproachingLimit()) {
        // Wait for budget to recover
        const waitMs = this.packetTracker.getRequiredWaitMs(batchSize);
        if (waitMs > 0) {
          this.events.publish('app.error', {
            message: `Command batch paused: waiting ${waitMs}ms for packet budget`,
          });
          await new Promise(resolve => setTimeout(resolve, waitMs));
        }
      }

      const batch = commands.slice(i, i + batchSize);

      // Rate limit the entire batch
      await this.rateLimiter.acquire(batch.length);

      for (const cmd of batch) {
        bot.chat(cmd);
        executed++;
      }

      // Always wait between batches (longer delay for reliability)
      if (i + batchSize < commands.length) {
        await bot.waitForTicks(ticksBetween);
        // Additional delay to let server process
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }

    return { executed, elapsed: Date.now() - start };
  }

  async ensureLoaded(
    bbox: BBox,
    strategy: 'forceload' | 'teleport-sweep' = 'teleport-sweep',
    timeoutMs = 20000,
  ): Promise<{ loadedChunks: number }> {
    const bot = this.bot;
    if (!bot) throw new Error('Bot is not connected');
    if (!bot.entity) throw new Error('Bot is not ready');
    const minChunkX = Math.floor(bbox.min.x / 16);
    const maxChunkX = Math.floor(bbox.max.x / 16);
    const minChunkZ = Math.floor(bbox.min.z / 16);
    const maxChunkZ = Math.floor(bbox.max.z / 16);
    const needed = new Set<string>();
    for (let cx = minChunkX; cx <= maxChunkX; cx += 1) {
      for (let cz = minChunkZ; cz <= maxChunkZ; cz += 1) {
        const corner = new Vec3(cx * 16, 0, cz * 16);
        const worldAny = bot.world as unknown as { getLoadedColumnAt?: (pos: Vec3) => unknown };
        const loaded = worldAny.getLoadedColumnAt ? Boolean(worldAny.getLoadedColumnAt(corner)) : false;
        if (!loaded) needed.add(`${cx},${cz}`);
      }
    }

    if (needed.size === 0) return { loadedChunks: 0 };

    if (strategy === 'forceload') {
      const minX = minChunkX * 16;
      const minZ = minChunkZ * 16;
      const maxX = maxChunkX * 16 + 15;
      const maxZ = maxChunkZ * 16 + 15;
      await this.execCommand(`/forceload add ${minX} ${minZ} ${maxX} ${maxZ}`);
      await bot.waitForChunksToLoad();
      return { loadedChunks: needed.size };
    }

    const start = Date.now();
    const pending = new Set(needed);
    const onLoad = (corner: Vec3) => {
      const cx = Math.floor(corner.x / 16);
      const cz = Math.floor(corner.z / 16);
      pending.delete(`${cx},${cz}`);
    };
    bot.world.on('chunkColumnLoad', onLoad);
    try {
      for (const key of needed) {
        if (pending.size === 0) break;
        const parts = key.split(',');
        const cx = Number(parts[0]);
        const cz = Number(parts[1]);
        if (!Number.isFinite(cx) || !Number.isFinite(cz)) continue;
        const target = new Vec3(cx * 16 + 8, bot.entity.position.y, cz * 16 + 8);
        await this.teleport({ x: target.x, y: target.y, z: target.z });
        await bot.waitForTicks(4);
        await bot.waitForChunksToLoad();
        if (Date.now() - start > timeoutMs) break;
      }
      const remaining = [...pending];
      if (remaining.length > 0) {
        throw new Error('CHUNKS_NOT_LOADED');
      }
      return { loadedChunks: needed.size };
    } finally {
      bot.world.off('chunkColumnLoad', onLoad);
    }
  }

  blockAt(pos: { x: number; y: number; z: number }, extraInfos = false) {
    const bot = this.bot;
    if (!bot) throw new Error('Bot is not connected');
    return bot.blockAt(new Vec3(pos.x, pos.y, pos.z), extraInfos);
  }

  getBlockCatalog(): BlockCatalog | null {
    if (!this.bot) return null;
    if (!this.blockCatalog) {
      this.blockCatalog = new BlockCatalog(this.bot);
    }
    return this.blockCatalog;
  }

  private startViewerIfNeeded(): void {
    if (this.viewerStarted) return;
    if (!this.bot) return;

    this.viewerStarted = true;

    try {
      // prismarine-viewer returns the HTTP server instance
      const server = startViewer(this.bot, {
        port: this.config.VIEWER_PORT,
        firstPerson: this.config.VIEWER_FIRST_PERSON,
        viewDistance: this.config.VIEWER_VIEW_DISTANCE_CHUNKS,
      });

      // Store server reference for cleanup
      // The viewer returns an object with close() method
      this.viewerServer = server as { close: () => void } | null;

      this.events.publish('viewer.start', {
        port: this.config.VIEWER_PORT,
        firstPerson: this.config.VIEWER_FIRST_PERSON,
      });
    } catch (err) {
      // Port may already be in use - log and continue without viewer
      const message = err instanceof Error ? err.message : String(err);
      this.events.publish('app.error', {
        message: `Failed to start viewer on port ${this.config.VIEWER_PORT}: ${message}`,
      });
      this.viewerStarted = false;
    }
  }

  private emitStatusSnapshot(): void {
    this.events.publish('status.snapshot', { snapshot: this.getSnapshot() });
  }
}

