import { offsetDirection } from "./aim";
import { damageAt } from "./ballistics";
import type { ShotEvent } from "./loadout";
import { add, scale, type Vec3 } from "./vec3";

export interface RayHit {
  distance: number;
  point: Vec3;
  normal: Vec3;
  /** Identifier of a damageable thing, or null for level geometry. */
  targetId: string | null;
  /** Whether the ray landed on a head zone. */
  headshot: boolean;
}

/** The simulation's only way to query the level for shooting. */
export interface HitscanWorld {
  raycast(origin: Vec3, direction: Vec3, maxDistance: number): RayHit | null;
}

export interface PelletImpact {
  point: Vec3;
  normal: Vec3;
  distance: number;
  targetId: string | null;
  headshot: boolean;
  damage: number;
  /** False when the pellet reached its maximum range without hitting. */
  hit: boolean;
}

export interface TargetDamage {
  targetId: string;
  damage: number;
  /** True when at least one pellet landed on a head zone. */
  headshot: boolean;
  pellets: number;
}

export interface ShotResolution {
  impacts: PelletImpact[];
  damage: TargetDamage[];
  /** Whether anything damageable was hit, for the hit marker. */
  hitTarget: boolean;
}

/**
 * Trace every pellet of one shot and total the damage per target.
 *
 * Hitscan rather than projectiles: at the ranges this map plays at, travel
 * time is below one frame, and hitscan is far cheaper to reconcile when the
 * authoritative server arrives in Phase 3.
 */
export const resolveShot = (
  shot: ShotEvent,
  origin: Vec3,
  world: HitscanWorld,
): ShotResolution => {
  const impacts: PelletImpact[] = [];
  const totals = new Map<string, TargetDamage>();

  for (const pellet of shot.pellets) {
    const direction = offsetDirection(shot.aimYaw, shot.aimPitch, pellet.yaw, pellet.pitch);
    const hit = world.raycast(origin, direction, shot.weapon.maxRange);

    if (!hit) {
      impacts.push({
        point: add(origin, scale(direction, shot.weapon.maxRange)),
        normal: scale(direction, -1),
        distance: shot.weapon.maxRange,
        targetId: null,
        headshot: false,
        damage: 0,
        hit: false,
      });
      continue;
    }

    const damage = hit.targetId
      ? damageAt(shot.weapon, hit.distance, hit.headshot)
      : 0;

    impacts.push({
      point: hit.point,
      normal: hit.normal,
      distance: hit.distance,
      targetId: hit.targetId,
      headshot: hit.headshot,
      damage,
      hit: true,
    });

    if (!hit.targetId) continue;
    const existing = totals.get(hit.targetId);
    if (existing) {
      existing.damage += damage;
      existing.headshot = existing.headshot || hit.headshot;
      existing.pellets += 1;
    } else {
      totals.set(hit.targetId, {
        targetId: hit.targetId,
        damage,
        headshot: hit.headshot,
        pellets: 1,
      });
    }
  }

  const damage = [...totals.values()];
  return { impacts, damage, hitTarget: damage.length > 0 };
};
