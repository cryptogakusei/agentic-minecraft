/**
 * AgentMessenger - Inter-agent communication system
 *
 * Allows agents to send messages to each other and broadcast to all agents.
 */

import { EventBus } from '../events/event-bus.js';
import { AppEvents } from '../events/event-types.js';
import { AgentMessage } from '../types/agent-config.js';
import { makeId } from '../lib/ids.js';

export class AgentMessenger {
  private inbox: AgentMessage[] = [];
  private maxInboxSize = 100;

  constructor(
    private agentId: string,
    private events: EventBus<AppEvents>,
  ) {
    // Listen for messages addressed to this agent
    this.events.onType('agent.message', (event) => {
      if (event.data.to === this.agentId || event.data.to === '*') {
        this.receiveMessage({
          id: makeId('msg'),
          from: event.data.from,
          to: event.data.to,
          content: event.data.content,
          timestamp: event.data.ts,
          read: false,
        });
      }
    });

    // Listen for broadcasts
    this.events.onType('agent.broadcast', (event) => {
      if (event.data.from !== this.agentId) {
        this.receiveMessage({
          id: makeId('msg'),
          from: event.data.from,
          to: '*',
          content: event.data.content,
          timestamp: event.data.ts,
          read: false,
        });
      }
    });
  }

  /**
   * Send a message to a specific agent
   */
  send(to: string, content: string): void {
    this.events.publish('agent.message', {
      from: this.agentId,
      to,
      content,
      ts: new Date().toISOString(),
    });
  }

  /**
   * Broadcast a message to all agents
   */
  broadcast(content: string): void {
    this.events.publish('agent.broadcast', {
      from: this.agentId,
      content,
      ts: new Date().toISOString(),
    });
  }

  /**
   * Get all unread messages
   */
  getUnreadMessages(): AgentMessage[] {
    return this.inbox.filter(m => !m.read);
  }

  /**
   * Get all messages (read and unread)
   */
  getAllMessages(): AgentMessage[] {
    return [...this.inbox];
  }

  /**
   * Get recent messages (last N)
   */
  getRecentMessages(count: number = 10): AgentMessage[] {
    return this.inbox.slice(-count);
  }

  /**
   * Mark all messages as read
   */
  markAllRead(): void {
    for (const msg of this.inbox) {
      msg.read = true;
    }
  }

  /**
   * Mark a specific message as read
   */
  markRead(messageId: string): boolean {
    const msg = this.inbox.find(m => m.id === messageId);
    if (msg) {
      msg.read = true;
      return true;
    }
    return false;
  }

  /**
   * Clear all messages
   */
  clearInbox(): void {
    this.inbox = [];
  }

  /**
   * Get count of unread messages
   */
  getUnreadCount(): number {
    return this.inbox.filter(m => !m.read).length;
  }

  /**
   * Internal: receive a message into inbox
   */
  private receiveMessage(message: AgentMessage): void {
    this.inbox.push(message);

    // Trim inbox if too large
    if (this.inbox.length > this.maxInboxSize) {
      this.inbox = this.inbox.slice(-this.maxInboxSize);
    }
  }
}
