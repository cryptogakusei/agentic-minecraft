/**
 * RegionManager - Prevents build conflicts between agents
 *
 * Agents claim regions before building. If another agent has already
 * claimed an overlapping region, the claim fails.
 */

import { EventBus } from '../events/event-bus.js';
import { AppEvents } from '../events/event-types.js';
import { RegionClaim } from '../types/agent-config.js';
import { BBox } from '../types/geometry.js';

export class RegionManager {
  private claims: Map<string, RegionClaim> = new Map();

  constructor(private events: EventBus<AppEvents>) {
    // Periodically clean up expired claims
    setInterval(() => this.cleanupExpired(), 30_000);
  }

  /**
   * Attempt to claim a region for an agent
   * Returns true if successful, false if region overlaps with existing claim
   */
  claim(agentId: string, bbox: BBox, ttlMs = 60_000, purpose?: string): boolean {
    // Clean up expired claims first
    this.cleanupExpired();

    // Check for overlaps with existing claims
    for (const [id, claim] of this.claims) {
      if (id !== agentId && this.overlaps(bbox, claim.bbox)) {
        // Region already claimed by another agent
        return false;
      }
    }

    const now = Date.now();
    const claim: RegionClaim = {
      agentId,
      bbox,
      claimedAt: now,
      expiresAt: now + ttlMs,
      purpose,
    };

    this.claims.set(agentId, claim);
    this.events.publish('region.claimed', { agentId, bbox, ttlMs });
    return true;
  }

  /**
   * Release an agent's claimed region
   */
  release(agentId: string): void {
    if (this.claims.has(agentId)) {
      this.claims.delete(agentId);
      this.events.publish('region.released', { agentId });
    }
  }

  /**
   * Extend the TTL of an existing claim
   */
  extendClaim(agentId: string, additionalMs: number): boolean {
    const claim = this.claims.get(agentId);
    if (!claim) return false;

    claim.expiresAt = Math.max(claim.expiresAt, Date.now()) + additionalMs;
    return true;
  }

  /**
   * Get the region claimed by an agent
   */
  getClaimedRegion(agentId: string): BBox | null {
    const claim = this.claims.get(agentId);
    if (!claim || claim.expiresAt < Date.now()) return null;
    return claim.bbox;
  }

  /**
   * Get all active claims
   */
  getAllClaims(): RegionClaim[] {
    this.cleanupExpired();
    return Array.from(this.claims.values());
  }

  /**
   * Check if a point is within any claimed region
   */
  isPointClaimed(point: { x: number; y: number; z: number }, excludeAgentId?: string): string | null {
    this.cleanupExpired();

    for (const [agentId, claim] of this.claims) {
      if (excludeAgentId && agentId === excludeAgentId) continue;

      if (
        point.x >= claim.bbox.min.x && point.x <= claim.bbox.max.x &&
        point.y >= claim.bbox.min.y && point.y <= claim.bbox.max.y &&
        point.z >= claim.bbox.min.z && point.z <= claim.bbox.max.z
      ) {
        return agentId;
      }
    }
    return null;
  }

  /**
   * Check if two bounding boxes overlap
   */
  private overlaps(a: BBox, b: BBox): boolean {
    return (
      a.min.x <= b.max.x && a.max.x >= b.min.x &&
      a.min.y <= b.max.y && a.max.y >= b.min.y &&
      a.min.z <= b.max.z && a.max.z >= b.min.z
    );
  }

  /**
   * Remove expired claims
   */
  private cleanupExpired(): void {
    const now = Date.now();
    for (const [agentId, claim] of this.claims) {
      if (claim.expiresAt < now) {
        this.claims.delete(agentId);
        this.events.publish('region.released', { agentId });
      }
    }
  }
}
