import { AgentRuntime } from '../runtime/agent-runtime.js';
import { EventBus } from '../events/event-bus.js';
import { AppEvents } from '../events/event-types.js';
import { ControlState } from '../state/control-state.js';
import { ConstructionScript } from '../types/blueprint.js';
import { bboxContainsBox, bboxUnion } from '../types/geometry.js';
import { computeCountsAndHash } from '../perception/region-analysis.js';
import { throwIfAborted } from '../lib/async.js';

export type RecordDiffsConfig = {
  mode: 'per-step' | 'per-bbox';
  encoding: 'counts+hash' | 'hash';
};

export type ExecutionReport = {
  commandsExecuted: number;
  elapsedSeconds: number;
  estimatedChangedBlocksUpperBound: number;
  diffs?: Array<{
    bbox: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } };
    before: { counts?: Record<string, number>; hash: string };
    after: { counts?: Record<string, number>; hash: string };
  }>;
};

export async function executeScript({
  script,
  agent,
  control,
  events,
  budgets,
  recordDiffs,
  signal,
}: {
  script: ConstructionScript;
  agent: AgentRuntime;
  control: ControlState;
  events: EventBus<AppEvents>;
  budgets: { maxSeconds: number; maxCommands: number; maxChangedBlocksUpperBound: number };
  recordDiffs?: RecordDiffsConfig;
  signal: AbortSignal;
}): Promise<ExecutionReport> {
  if (!agent.getBot()) throw new Error('Bot is not connected');
  if (agent.isPaused()) throw new Error('Agent is paused');

  const buildZone = control.getBuildZone();
  if (buildZone) {
    for (const step of script.steps) {
      if (!bboxContainsBox(buildZone, step.bbox)) {
        throw new Error('OUTSIDE_BUILD_ZONE');
      }
    }
  }
  const allowlist = new Set(control.getAllowlist());
  if (allowlist.size > 0) {
    for (const step of script.steps) {
      for (const blockName of step.blocksUsed) {
        if (!allowlist.has(blockName)) {
          throw new Error(`BLOCK_NOT_ALLOWED:${blockName}`);
        }
      }
    }
  }

  // Enforce minimum budget values - AI sometimes passes overly conservative values
  const effectiveBudgets = {
    maxSeconds: Math.max(budgets.maxSeconds, 300), // At least 5 minutes
    maxCommands: Math.max(budgets.maxCommands, 10000), // At least 10k commands
    maxChangedBlocksUpperBound: Math.max(budgets.maxChangedBlocksUpperBound, 100000), // At least 100k blocks
  };

  // Debug: log budget check values
  console.log(`[BUDGET CHECK] Script: ${script.estimated.changedBlocksUpperBound} blocks, ${script.estimated.commands} commands`);
  console.log(`[BUDGET CHECK] Limits: ${effectiveBudgets.maxChangedBlocksUpperBound} blocks, ${effectiveBudgets.maxCommands} commands`);

  if (script.estimated.changedBlocksUpperBound > effectiveBudgets.maxChangedBlocksUpperBound) {
    console.log(`[BUDGET CHECK] FAILED: blocks exceeded (${script.estimated.changedBlocksUpperBound} > ${effectiveBudgets.maxChangedBlocksUpperBound})`);
    throw new Error(`BUDGET_EXCEEDED: ${script.estimated.changedBlocksUpperBound} blocks > ${effectiveBudgets.maxChangedBlocksUpperBound} limit`);
  }
  if (script.estimated.commands > effectiveBudgets.maxCommands) {
    console.log(`[BUDGET CHECK] FAILED: commands exceeded (${script.estimated.commands} > ${effectiveBudgets.maxCommands})`);
    throw new Error(`BUDGET_EXCEEDED: ${script.estimated.commands} commands > ${effectiveBudgets.maxCommands} limit`);
  }

  const start = Date.now();
  const diffs: ExecutionReport['diffs'] = recordDiffs ? [] : undefined;
  let commandsExecuted = 0;
  let changedUpperBound = 0;

  const scriptBox = script.steps.length > 0 ? script.steps.map(step => step.bbox).reduce(bboxUnion) : null;
  if (recordDiffs?.mode === 'per-bbox' && scriptBox) {
    const before = await computeCountsAndHash(agent, scriptBox);
    diffs?.push({ bbox: scriptBox, before, after: before });
  }

  // Per-step diff recording requires sequential execution
  if (recordDiffs?.mode === 'per-step') {
    for (const step of script.steps) {
      throwIfAborted(signal);
      const elapsedSeconds = (Date.now() - start) / 1000;
      if (elapsedSeconds > budgets.maxSeconds) {
        throw new Error('BUDGET_EXCEEDED');
      }
      const before = await computeCountsAndHash(agent, step.bbox);
      await agent.execCommand(step.command, 1);
      commandsExecuted += 1;
      changedUpperBound += step.estimatedChangedBlocksUpperBound;
      events.publish('build.command', { command: step.command });
      const after = await computeCountsAndHash(agent, step.bbox);
      diffs!.push({ bbox: step.bbox, before, after });
    }
  } else {
    // Fast batch path: fire commands in bursts of 20 per tick
    throwIfAborted(signal);
    const commands = script.steps.map(step => step.command);
    if (commands.length > 0) {
      const result = await agent.execCommandBatch(commands);
      commandsExecuted = result.executed;
    }
    changedUpperBound = script.steps.reduce(
      (sum, s) => sum + s.estimatedChangedBlocksUpperBound,
      0,
    );
    for (const step of script.steps) {
      events.publish('build.command', { command: step.command });
    }
  }

  if (recordDiffs?.mode === 'per-bbox' && scriptBox && diffs && diffs.length > 0) {
    const latest = diffs[0];
    if (latest) {
      latest.after = await computeCountsAndHash(agent, scriptBox);
    }
  }

  return {
    commandsExecuted,
    elapsedSeconds: (Date.now() - start) / 1000,
    estimatedChangedBlocksUpperBound: changedUpperBound,
    diffs,
  };
}

