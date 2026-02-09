# Server Configuration for Bot-Friendly Minecraft

These configuration files relax PaperMC/Spigot spam protection to allow mineflayer bots to operate without getting kicked.

## The Problem

PaperMC has aggressive spam protection that kicks clients sending too many packets:
- Default limit: 500 packets per 7 seconds (~71 packets/sec)
- Mineflayer bots send: ~20 physics packets/sec + pathfinding + commands
- Multiple bots or heavy pathfinding easily exceeds this limit

## Solution

### Server-Side Configuration

Copy these files to your PaperMC server:

```bash
# Copy paper-global.yml to your server's config/ directory
cp paper-global.yml /path/to/server/config/paper-global.yml

# Copy spigot.yml to your server root
cp spigot.yml /path/to/server/spigot.yml

# Restart the server
```

### Key Changes in paper-global.yml

1. **packet-limiter.all-packets.max-packet-rate**: Increased from 500 to 2000
2. **Movement packet overrides**: Set to DROP instead of KICK
3. **incoming-packet-threshold**: Increased from 300 to 5000

### Key Changes in spigot.yml

1. **moved-wrongly-threshold**: Increased to allow bot movement
2. **moved-too-quickly-multiplier**: Increased to prevent false positives
3. **spam-exclusions**: Added common bot commands (/tp, /fill, /setblock, etc.)

## Client-Side Optimizations

The bot code (agent-runtime.ts) also includes:

1. **Packet Budget Tracker**: Monitors packets sent in 7-second window
2. **Physics Throttling**: Reduces position update rate when approaching limits
3. **Command Rate Limiting**: 5 commands/sec max with 100ms minimum delay
4. **Pathfinding Limits**: Stops pathfinding if packet budget exceeded
5. **Batch Command Delays**: 3 commands per batch, 200ms between batches

## Security Warning

These settings reduce spam protection. Only use on:
- Private development/testing servers
- Servers where you control all connected clients
- Servers without untrusted players

Do NOT use these settings on public servers as they could allow malicious clients to cause issues.

## Tuning

If you still get kicked:

1. Increase `max-packet-rate` in paper-global.yml
2. Reduce `batchSize` in agent-runtime.ts (default: 3)
3. Increase delays between commands
4. Disable physics during heavy command execution

If bots are too slow:

1. Decrease delays (but watch for kicks)
2. Enable sprinting in pathfinder movements
3. Increase batch size (carefully)

## Debugging

Check packet budget in logs:
```
Packet budget: 280/350 (80%)
```

If you see high percentages (>70%), the bot is approaching limits.
