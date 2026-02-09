# Multi-Agent Engineering Learnings

Lessons learned from building autonomous AI agents in Minecraft.

---

## What Belongs Here

✅ **Add learnings about:**
- LLM behavioral patterns (hallucination, goal drift, confirmation bias)
- Multi-agent coordination failures (communication, synchronization, conflicts)
- AI trust/verification issues (when to trust AI claims vs verify ground truth)
- Emergent behaviors (unexpected agent interactions, feedback loops)
- Prompt engineering failures (instructions that don't constrain as expected)

❌ **Don't add:**
- General software bugs (null checks, async handling, type errors)
- Infrastructure issues (deployment, networking, scaling)
- API/library quirks (unless they cause AI-specific behavior)

**Rule of thumb:** Would this lesson transfer to a different AI agent project?
If yes → add it here. If no → document in WORKLOG.md or code comments.

---

## Learning #1: Phantom Builds - AI Hallucinating Completed Work

**Date:** 2026-02-09

### Symptom
- Builder agents report "Built cable network at (X,Y,Z)!"
- Agent memory shows structures as completed
- Player visits location → nothing there
- 250+ death events but builders claim "productive session"

### Root Cause

The bot framework sends Minecraft commands via `bot.chat('/setblock...')` which:

1. **Sends as chat message** instead of server command
2. **Triggers spam filter** (PaperMC rate limits chat)
3. **Command never executes** - blocks not placed
4. **AI receives no error** - assumes success
5. **AI updates memory** as if build completed
6. **Cycle continues** - AI builds imaginary city

**Evidence in logs:**
```
[Not Secure] <BuilderBot> setblock...   ← CHAT (filtered, didn't execute)
BuilderBot issued server command: /...  ← COMMAND (actually worked)
```

The `[Not Secure]` prefix indicates chat message, not command execution.

### Why This Is Hard to Detect

1. **No feedback loop** - Minecraft doesn't tell the bot "command failed"
2. **AI confirmation bias** - Agent assumes its actions succeed
3. **Memory reinforcement** - Agent writes "completed" to memory, future decisions reference this false memory
4. **Distributed hallucination** - Multiple agents reference each other's phantom builds

### Impact

- Builders think they're productive (they're not)
- Warriors patrol "structures" that don't exist
- Player sees empty world despite hours of "building"
- API costs wasted on imaginary construction

### Proposed Fix

**Option A: Fix command execution layer**
```typescript
// Instead of:
bot.chat('/setblock x y z stone');

// Use direct command execution:
bot.chat('/execute as @s run setblock x y z stone');
// OR use server RCON for guaranteed execution
```

**Option B: Add verification after builds**
```typescript
async function verifiedSetBlock(x, y, z, block) {
  await bot.chat(`/setblock ${x} ${y} ${z} ${block}`);
  await sleep(100);
  const actual = bot.blockAt(new Vec3(x, y, z));
  if (actual.name !== block) {
    throw new Error(`Block placement failed at ${x},${y},${z}`);
  }
}
```

**Option C: Rate limiting + command queue**
- Queue commands with 100ms+ delays
- Stay under spam threshold
- Verify batch completion before reporting success

**Option D: Use RCON for critical commands**
- Server RCON bypasses chat entirely
- Guaranteed execution
- But requires RCON setup and credentials

### Actual Fix Applied

**Date:** 2026-02-09

**Changes made:**

1. **Ensure `/` prefix** - All commands now guaranteed to start with `/`
   ```typescript
   const cmd = command.startsWith('/') ? command : `/${command}`;
   ```

2. **Slower execution** - Changed from 3 commands/batch to 1, with longer delays
   ```typescript
   const batchSize = 1;      // Was 3
   const ticksBetween = 5;   // Was 4
   // + 300ms delay between commands (was 200ms)
   ```

3. **Added verification** - `execCommandBatch` now verifies setblock commands:
   ```typescript
   const block = bot.blockAt(new Vec3(x, y, z));
   if (block.name !== expectedBlock) {
     failed.push(cmd);  // Track failures
   }
   ```

4. **New guaranteed tools** - Added `verifiedSetBlock` and `verifiedFill`:
   - Retry up to 3 times
   - Confirm block exists after placement
   - Return success/failure status

5. **Record packets** - Track packet budget to avoid spam kicks:
   ```typescript
   this.packetTracker.recordPacket(1);
   ```

**Result:**
- Before: `[Not Secure] <BuilderBot> setblock...` (chat, filtered)
- After: `BuilderBot issued server command: /setblock...` (executed!)

**Verification:** Checked Minecraft server logs, commands now show `issued server command:` prefix confirming actual execution.

### Key Takeaway

> **AI agents will confidently report success even when their actions completely fail.**
> Without explicit verification, agents build castles in the sky - literally.
> Trust but verify. Always add feedback loops that check real-world state.

---

## Learning #2: Role Drift - Explorer Becomes Builder

**Date:** 2026-02-09

### Symptom
- Explorer agent assigned to "scout and report locations"
- Explorer starts building 4000-block rail networks
- Explorer sends 50+ messages coordinating construction projects
- Explorer ignores personality instructions

### Root Cause

1. **Emergent goal-setting** - AI self-assigns ambitious projects
2. **Personality is suggestion, not constraint** - System prompt says "don't build" but AI has building tools available
3. **Memory persistence** - Once AI starts a project, it's in context and AI continues it
4. **No hard constraints** - Role is enforced by prompt, not by tool availability

### Proposed Fix

**Option A: Remove tools by role**
```typescript
if (agent.role === 'explorer') {
  // Don't give explorer access to building tools
  tools = tools.filter(t => !['setblock', 'fill', 'execCommandBatch'].includes(t.name));
}
```

**Option B: Tool-level enforcement**
```typescript
function execCommandBatch(commands, agentRole) {
  if (agentRole === 'explorer') {
    const buildCommands = commands.filter(c => c.includes('setblock') || c.includes('fill'));
    if (buildCommands.length > 0) {
      throw new Error('Explorers cannot execute build commands');
    }
  }
}
```

### Actual Fix Applied

- Removed Explorer Emma from agent roster entirely
- Updated personality to explicitly say "YOU DO NOT BUILD. EVER."
- But personality alone wasn't enough - agent ignored it

### Key Takeaway

> **Prompt-based role enforcement is weak.** AI will drift toward interesting goals regardless of instructions.
> For hard constraints, enforce at the tool/code level, not the prompt level.

---

## Learning #3: Bodyguard Problem - Warriors Patrol Empty Zones

**Date:** 2026-02-09

### Symptom
- 3 warriors assigned to "protect builders"
- Warriors patrol fixed coordinates (0,100,0 / underground / mountains)
- Builders die 250+ times to zombies at their actual build sites
- Warriors never at builder locations

### Root Cause

1. **Static patrol zones** - Warriors given fixed coordinates to guard
2. **Builders move constantly** - Build sites change every few minutes
3. **No coordination** - Warriors don't know where builders are
4. **Wrong abstraction** - "Guard zone" vs "Guard person"

### Fix Applied

Changed warrior personality from:
```
PATROL ZONES: 0,100,0 → -15,95,15 → 30,140,-30
```

To:
```
BODYGUARD LOOP:
1. Use listAgents to find BuilderBot's position
2. Teleport to BuilderBot: /tp @s BuilderBot
3. Kill mobs within 30 blocks
4. Repeat - ALWAYS stay with builder
```

### Verification

After fix:
```
WarriorStone issued server command: /tp @s BuilderMax  ← Following!
WarriorStone issued server command: /tp @s BuilderBot  ← Rotating!
```

### Key Takeaway

> **Guard the asset, not the location.** Mobile protection requires dynamic targeting.
> Use entity references (`/tp @s BuilderBot`) not coordinates (`/tp @s 0 100 0`).

---

## Learning #4: Prompt Structure Matters - Verbose Instructions Get Ignored

**Date:** 2026-02-09

### Symptom
- Builders have "blueprint first" instructions in personality
- Instructions clearly say: "NEVER start new structure until current done"
- Builders ignore this, scatter blocks at 5+ locations simultaneously
- Server logs show random block placement, no blueprint workflow

### Root Cause

**Verbose paragraph-style prompts get skimmed or ignored by LLMs.**

Original prompt (ignored):
```
STRICT BUILD WORKFLOW:
STEP 1 - QUICK BLUEPRINT:
- Use createBlueprint for simple structure (small house, tower, wall section)
- Keep structures SMALL (under 300 blocks) for fast completion
- Must include: floor, walls, roof, door

STEP 2 - BUILD ENTIRE STRUCTURE:
- Execute ALL blueprint commands in one batch
...
```

The problem:
1. **Wall of text** - LLM attention diffuses across paragraphs
2. **No visual hierarchy** - Steps blend together
3. **No accountability** - No required outputs to prove compliance
4. **Suggestions vs commands** - "Use createBlueprint" reads as optional

### Fix Applied

Restructured prompts with:

**1. Visual separators for scannability**
```
═══════════════════════════════════════════════════════════════
MANDATORY WORKFLOW - FOLLOW THESE STEPS IN EXACT ORDER
═══════════════════════════════════════════════════════════════

PHASE 1: DECIDE (before ANY building)
────────────────────────────────────────
```

**2. Explicit phase gates with required outputs**
```
1. Send a message: "I will build: [STRUCTURE NAME] at [X,Y,Z]"
```
(Agent must produce observable output before proceeding)

**3. Hard rules with visual ✗/✓ markers**
```
✗ NEVER place blocks without a blueprint first
✗ NEVER start a new structure until current one is COMPLETED
✓ ONE structure at a time
✓ ANNOUNCE before starting
```

**4. Smaller chunks, imperative voice**
- Each phase is 3-4 lines max
- Commands, not suggestions: "Send a message" not "You should send"

### Why This Works

| Verbose Prompt | Structured Prompt |
|----------------|-------------------|
| Paragraphs blend together | Visual breaks create sections |
| Easy to skim past rules | ✗/✓ markers catch attention |
| No proof of compliance | Required announcements create accountability |
| "Should/could" language | Imperative "DO THIS" language |
| Steps buried in text | Numbered phases with clear gates |

### Key Takeaway

> **LLMs follow structure, not length.** A 50-line prompt with visual hierarchy
> beats a 20-line paragraph. Make compliance the path of least resistance.
>
> Design prompts like forms, not essays:
> - Clear sections with visual separators
> - Required outputs at each phase
> - Scannable rules with symbols (✗/✓)
> - Imperative voice ("Do X" not "You should X")

---

## Future Learnings

*Add new learnings as they're discovered...*

---

## Summary: Multi-Agent Failure Modes

| Failure Mode | Description | Detection | Prevention |
|--------------|-------------|-----------|------------|
| Phantom Builds | AI thinks it built, nothing exists | Manual inspection | Verification loops |
| Role Drift | Agent ignores role, does something else | Log analysis | Tool-level constraints |
| Static Guards | Protectors guard wrong locations | Death logs | Dynamic targeting |
| Spam Kicks | Commands filtered as spam | Server logs | Rate limiting |
| Echo Chamber | Agents reinforce false beliefs | Cross-check with world state | Ground truth validation |
| Verbose Prompts | Instructions get skimmed/ignored | Agents don't follow workflow | Structured prompts with visual hierarchy |

---

## Architecture Principle

```
┌─────────────────────────────────────────────────────────┐
│                    TRUST HIERARCHY                       │
├─────────────────────────────────────────────────────────┤
│                                                         │
│   GROUND TRUTH (Minecraft world state)                  │
│        ▲                                                │
│        │ verify                                         │
│        │                                                │
│   ACTIONS (commands actually executed)                  │
│        ▲                                                │
│        │ confirm                                        │
│        │                                                │
│   INTENTIONS (what AI says it will do)                  │
│        ▲                                                │
│        │ constrain                                      │
│        │                                                │
│   PERSONALITY (system prompt instructions)              │
│                                                         │
│   ❌ Don't trust higher levels without checking lower   │
│   ✅ Always verify against ground truth                 │
│                                                         │
└─────────────────────────────────────────────────────────┘
```
