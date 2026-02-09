import { mkdir, appendFile, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { EventEnvelope } from './event-types.js';

export class JsonlEventStore<TEvent extends EventEnvelope> {
  constructor(private readonly path: string) {}

  async init(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
  }

  async append(event: TEvent): Promise<void> {
    const line = JSON.stringify(event) + '\n';
    await appendFile(this.path, line, { encoding: 'utf8' });
  }

  async readSince(seq: number, limit = 500, types?: string[]): Promise<TEvent[]> {
    try {
      const raw = await readFile(this.path, 'utf8');
      const lines = raw.trim().split('\n');
      const events: TEvent[] = [];
      const typeSet = types ? new Set(types) : null;
      for (const line of lines) {
        if (!line) continue;
        const event = JSON.parse(line) as TEvent;
        if (event.seq > seq) {
          // Apply type filter if specified
          if (typeSet && !typeSet.has(event.type)) continue;
          events.push(event);
          if (events.length >= limit) break;
        }
      }
      return events;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('ENOENT')) return [];
      throw err;
    }
  }

  /**
   * Read recent events, optionally filtered by type.
   * Returns events in reverse chronological order (most recent first).
   */
  async readRecent(limit = 100, types?: string[]): Promise<TEvent[]> {
    try {
      const raw = await readFile(this.path, 'utf8');
      const lines = raw.trim().split('\n');
      const events: TEvent[] = [];
      const typeSet = types ? new Set(types) : null;
      // Read from end of file for most recent events
      for (let i = lines.length - 1; i >= 0 && events.length < limit; i--) {
        const line = lines[i];
        if (!line) continue;
        const event = JSON.parse(line) as TEvent;
        // Apply type filter if specified
        if (typeSet && !typeSet.has(event.type)) continue;
        events.push(event);
      }
      // Return in chronological order (oldest first)
      return events.reverse();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('ENOENT')) return [];
      throw err;
    }
  }
}

