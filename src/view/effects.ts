import "@babylonjs/core/Meshes/Builders/boxBuilder";
import "@babylonjs/core/Meshes/Builders/planeBuilder";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { Scene } from "@babylonjs/core/scene";
import type { PelletImpact } from "../sim/combat";
import type { Vec3 } from "../sim/vec3";
import { alignToDirection } from "./orient";

const TRACER_POOL = 24;
const IMPACT_POOL = 32;
const IMPACT_LIFE = 2.4;
/**
 * How fast a tracer travels, in metres a second, and the least of the path
 * it covers at once.
 *
 * A line drawn from the muzzle to the impact in one go converges on the aim
 * point at once, and reads as fired from the crosshair. A streak that leaves
 * the muzzle and crosses the ground in a few frames reads as fired from the
 * gun, which is where the player is looking for it.
 *
 * The streak is never shorter than the ground the round covered since the
 * last frame. A fixed-length streak leaves gaps at any frame rate where the
 * round outruns it, and gaps are what turn one straight line into a scatter
 * of short dashes lying at whatever angle the path happened to be crossing
 * the screen at — which is to say, sideways.
 */
const TRACER_SPEED = 260;
const TRACER_STREAK = 2.4;

interface Pooled {
  mesh: Mesh;
  life: number;
}

interface Tracer {
  mesh: Mesh;
  from: Vector3;
  direction: Vector3;
  length: number;
  /** How far the head of the streak has travelled; negative when idle. */
  head: number;
  /** Where the streak starts, which is where its head was last frame. */
  tail: number;
}

/**
 * Shot feedback: tracers, marks in the walls, blood off a body, dust off
 * everything else.
 *
 * Everything is pooled and allocated once. Creating meshes per shot would
 * stall on a phone at nine hundred rounds a minute, and the garbage it left
 * behind would show up as a hitch in the middle of a fight.
 */
export class ShotEffects {
  private readonly tracers: Tracer[] = [];
  private readonly impacts: Pooled[] = [];
  private tracerCursor = 0;
  private impactCursor = 0;

  private readonly tracerMaterial: StandardMaterial;
  private readonly impactMaterial: StandardMaterial;
  private readonly blood: Spray;
  private readonly dust: Spray;

  private readonly from = new Vector3();
  private readonly to = new Vector3();

  constructor(scene: Scene) {
    this.tracerMaterial = emissive(scene, "mat_tracer", "#ffd9a0", 0.9);

    // A bullet hole, rather than a dark square: a chipped centre with the
    // dust it threw up around it, and nothing at all outside the circle.
    this.impactMaterial = new StandardMaterial("mat_impact", scene);
    const hole = holeTexture(scene);
    this.impactMaterial.diffuseTexture = hole;
    this.impactMaterial.opacityTexture = hole;
    this.impactMaterial.diffuseColor = new Color3(1, 1, 1);
    this.impactMaterial.specularColor = Color3.Black();
    this.impactMaterial.emissiveColor = new Color3(0.06, 0.06, 0.07);
    // Marks are quads laid on a surface, and which way round they end up
    // depends on the surface they hit. Culled to one side, half of them face
    // into the wall and are never seen, which is what made them look as
    // though rounds left no mark at all.
    this.impactMaterial.backFaceCulling = false;
    this.impactMaterial.freeze();

    /*
     * Both sprays are picked against the level rather than for their own
     * sake, because both exist to be noticed.
     *
     * The mist is darker than blood is usually drawn. It has to read as a
     * hit while it is on a figure, and one of the two sides wears a strong
     * red: a bright crimson sat fifteen units of CIE distance from that
     * team's own body, which is a hit marker that disappears against the
     * thing it is marking. Dark, it clears twenty-six from anything in the
     * level and it reads on a rust jacket, on brick, and on concrete.
     *
     * The dust goes the other way. It comes off concrete and used to be
     * almost exactly the colour of concrete -- twelve units -- so a round
     * into a wall put up a puff nobody could see. Near-white, against a
     * surface that is not, it is a round striking a wall.
     */
    this.blood = new Spray(scene, "blood", "#6b0d14", 48, {
      gravity: -9.5,
      drag: 2.6,
      startSize: 0.05,
      endSize: 0.3,
      life: 0.55,
      glow: 0.16,
    });
    this.dust = new Spray(scene, "dust", "#e8e3d6", 36, {
      gravity: -2.2,
      drag: 4.5,
      startSize: 0.05,
      endSize: 0.42,
      life: 0.42,
      glow: 0.3,
    });

    for (let i = 0; i < TRACER_POOL; i += 1) {
      const mesh = MeshBuilder.CreateBox(`tracer_${i}`, { size: 1 }, scene);
      mesh.material = this.tracerMaterial;
      mesh.isPickable = false;
      mesh.setEnabled(false);
      mesh.rotationQuaternion = Quaternion.Identity();
      this.tracers.push({
        mesh,
        from: new Vector3(),
        direction: new Vector3(),
        length: 0,
        head: -1,
        tail: 0,
      });
    }

    for (let i = 0; i < IMPACT_POOL; i += 1) {
      const mesh = MeshBuilder.CreatePlane(`impact_${i}`, { size: 0.16 }, scene);
      mesh.material = this.impactMaterial;
      mesh.isPickable = false;
      mesh.setEnabled(false);
      mesh.rotationQuaternion = Quaternion.Identity();
      this.impacts.push({ mesh, life: 0 });
    }
  }

  /**
   * Draw one pellet: its path, and whatever it did at the far end.
   *
   * A body and a wall answer a round differently, and the difference is how
   * a player knows they hit someone without reading the crosshair: a body
   * throws a red mist and takes no mark, a wall chips and throws dust.
   */
  addPellet(origin: Vec3, impact: PelletImpact): void {
    this.addTracer(origin, impact.point);
    if (!impact.hit) return;
    if (impact.targetId) {
      this.blood.burst(impact.point, impact.normal, impact.headshot ? 11 : 7, 3.2);
      return;
    }
    this.addImpact(impact.point, impact.normal);
    this.dust.burst(impact.point, impact.normal, 4, 2.1);
  }

  private addTracer(origin: Vec3, end: Vec3): void {
    const entry = this.tracers[this.tracerCursor];
    this.tracerCursor = (this.tracerCursor + 1) % this.tracers.length;

    this.from.set(origin.x, origin.y, origin.z);
    this.to.set(end.x, end.y, end.z);
    const delta = this.to.subtract(this.from);
    const length = delta.length();
    if (length < 1e-4) return;

    entry.from.copyFrom(this.from);
    entry.direction.copyFrom(delta.scale(1 / length));
    entry.length = length;
    entry.head = 0;
    entry.tail = 0;
    // Point the stretched box down the path of the round.
    alignToDirection(entry.direction, entry.mesh.rotationQuaternion as Quaternion);
    this.placeTracer(entry);
  }

  /** Lay the streak along the stretch of path the round is crossing. */
  private placeTracer(entry: Tracer): void {
    const tip = Math.min(entry.length, entry.head);
    const tail = Math.max(0, Math.min(entry.tail, entry.head - TRACER_STREAK));
    const span = tip - tail;
    // Nothing to show yet on the frame it is fired; it is there next frame.
    entry.mesh.setEnabled(span > 1e-4);
    if (span <= 1e-4) return;
    const middle = tail + span / 2;
    entry.mesh.position.set(
      entry.from.x + entry.direction.x * middle,
      entry.from.y + entry.direction.y * middle,
      entry.from.z + entry.direction.z * middle,
    );
    entry.mesh.scaling.set(0.014, 0.014, span);
  }

  private addImpact(point: Vec3, normal: Vec3): void {
    const entry = this.impacts[this.impactCursor];
    this.impactCursor = (this.impactCursor + 1) % this.impacts.length;

    const surfaceNormal = new Vector3(normal.x, normal.y, normal.z);
    if (surfaceNormal.lengthSquared() < 1e-6) surfaceNormal.set(0, 1, 0);
    surfaceNormal.normalize();
    // Lift the mark clear of the surface, or it fights the wall for depth.
    entry.mesh.position.set(
      point.x + surfaceNormal.x * 0.006,
      point.y + surfaceNormal.y * 0.006,
      point.z + surfaceNormal.z * 0.006,
    );
    // Laid flat into the surface, whichever way that surface faces: a mark
    // on a floor or a ceiling has to sit in it, not stand up out of it.
    alignToDirection(surfaceNormal, entry.mesh.rotationQuaternion as Quaternion);
    // Rolled and sized at random, so a burst into one wall is a scatter of
    // holes rather than the same stamp printed eight times.
    entry.mesh.rotate(Vector3.Forward(), Math.random() * Math.PI * 2);
    entry.mesh.scaling.setAll(0.75 + Math.random() * 0.6);
    entry.mesh.setEnabled(true);
    entry.life = IMPACT_LIFE;
  }

  update(deltaSeconds: number): void {
    for (const entry of this.tracers) {
      if (entry.head < 0) continue;
      // The streak runs from where its head was to where it is now, so one
      // frame's streak picks up exactly where the last one left off.
      entry.tail = entry.head;
      entry.head += TRACER_SPEED * deltaSeconds;
      if (entry.tail >= entry.length) {
        entry.head = -1;
        entry.mesh.setEnabled(false);
        continue;
      }
      this.placeTracer(entry);
    }
    for (const entry of this.impacts) {
      if (entry.life <= 0) continue;
      entry.life -= deltaSeconds;
      if (entry.life <= 0) entry.mesh.setEnabled(false);
    }
    this.blood.update(deltaSeconds);
    this.dust.update(deltaSeconds);
  }
}

interface SprayStyle {
  /** Metres per second squared, downward. */
  gravity: number;
  /** How quickly the air takes the speed out, per second. */
  drag: number;
  startSize: number;
  endSize: number;
  life: number;
  /** How much the specks light themselves, so they read in shade. */
  glow: number;
}

interface Speck {
  mesh: Mesh;
  velocity: Vector3;
  life: number;
}

/**
 * A puff of specks thrown off an impact.
 *
 * Billboarded quads that spread, slow, swell and fade. Two of these make
 * every impact in the game: red off a body, pale off everything else.
 */
class Spray {
  private readonly specks: Speck[] = [];
  private cursor = 0;

  constructor(
    scene: Scene,
    name: string,
    hex: string,
    count: number,
    private readonly style: SprayStyle,
  ) {
    const material = new StandardMaterial(`mat_${name}`, scene);
    const blob = blobTexture(scene, name);
    material.diffuseTexture = blob;
    material.opacityTexture = blob;
    const colour = Color3.FromHexString(hex);
    material.diffuseColor = colour;
    material.emissiveColor = colour.scale(style.glow);
    material.specularColor = Color3.Black();
    material.backFaceCulling = false;
    material.freeze();

    for (let i = 0; i < count; i += 1) {
      const mesh = MeshBuilder.CreatePlane(`${name}_${i}`, { size: 1 }, scene);
      mesh.material = material;
      mesh.isPickable = false;
      mesh.billboardMode = Mesh.BILLBOARDMODE_ALL;
      mesh.setEnabled(false);
      this.specks.push({ mesh, velocity: new Vector3(), life: 0 });
    }
  }

  /**
   * Throw `count` specks off a surface.
   *
   * They come back out along the surface normal, spread into a wide cone, so
   * the puff stands off the wall rather than smeared flat against it.
   */
  burst(point: Vec3, normal: Vec3, count: number, speed: number): void {
    const away = new Vector3(normal.x, normal.y, normal.z);
    if (away.lengthSquared() < 1e-6) away.set(0, 1, 0);
    away.normalize();
    for (let i = 0; i < count; i += 1) {
      const speck = this.specks[this.cursor];
      this.cursor = (this.cursor + 1) % this.specks.length;
      speck.mesh.position.set(point.x, point.y, point.z);
      speck.mesh.scaling.setAll(this.style.startSize);
      speck.mesh.visibility = 1;
      speck.mesh.setEnabled(true);
      const scatter = speed * (0.35 + Math.random() * 0.9);
      speck.velocity.set(
        away.x * scatter + (Math.random() * 2 - 1) * speed * 0.55,
        away.y * scatter + (Math.random() * 2 - 1) * speed * 0.55 + speed * 0.25,
        away.z * scatter + (Math.random() * 2 - 1) * speed * 0.55,
      );
      speck.life = this.style.life * (0.7 + Math.random() * 0.6);
    }
  }

  update(deltaSeconds: number): void {
    const { gravity, drag, startSize, endSize } = this.style;
    for (const speck of this.specks) {
      if (speck.life <= 0) continue;
      speck.life -= deltaSeconds;
      if (speck.life <= 0) {
        speck.mesh.setEnabled(false);
        continue;
      }
      speck.velocity.y += gravity * deltaSeconds;
      const slowed = Math.max(0, 1 - drag * deltaSeconds);
      speck.velocity.scaleInPlace(slowed);
      speck.mesh.position.addInPlace(speck.velocity.scale(deltaSeconds));
      // Age runs from nothing to one over the speck's own lifetime.
      const age = 1 - speck.life / this.style.life;
      speck.mesh.scaling.setAll(startSize + (endSize - startSize) * Math.min(1, age));
      speck.mesh.visibility = Math.max(0, 1 - age * age);
    }
  }
}

/** A soft round blob, for the specks: opaque at the centre, gone at the rim. */
const blobTexture = (scene: Scene, name: string): DynamicTexture => {
  const size = 64;
  const texture = new DynamicTexture(`tex_${name}`, { width: size, height: size }, scene, false);
  texture.hasAlpha = true;
  const context = texture.getContext() as unknown as CanvasRenderingContext2D;
  const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, "rgba(255, 255, 255, 1)");
  gradient.addColorStop(0.45, "rgba(255, 255, 255, 0.85)");
  gradient.addColorStop(1, "rgba(255, 255, 255, 0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  texture.update();
  return texture;
};

/** A bullet hole: a dark chip, a bright rim of raw material, dust around it. */
const holeTexture = (scene: Scene): DynamicTexture => {
  const size = 64;
  const texture = new DynamicTexture("tex_hole", { width: size, height: size }, scene, true);
  texture.hasAlpha = true;
  const context = texture.getContext() as unknown as CanvasRenderingContext2D;
  const middle = size / 2;

  // The scuff around the hole, thrown outward and uneven.
  const halo = context.createRadialGradient(middle, middle, size * 0.1, middle, middle, middle);
  halo.addColorStop(0, "rgba(78, 74, 70, 0.75)");
  halo.addColorStop(0.55, "rgba(92, 88, 82, 0.32)");
  halo.addColorStop(1, "rgba(92, 88, 82, 0)");
  context.fillStyle = halo;
  context.fillRect(0, 0, size, size);

  // The crater, with a lighter lip on one side so it reads as a pit rather
  // than a sticker.
  const pit = context.createRadialGradient(
    middle - 1.5,
    middle - 1.5,
    0,
    middle,
    middle,
    size * 0.18,
  );
  pit.addColorStop(0, "rgba(12, 11, 12, 0.96)");
  pit.addColorStop(0.7, "rgba(26, 24, 24, 0.9)");
  pit.addColorStop(1, "rgba(120, 114, 104, 0.55)");
  context.fillStyle = pit;
  context.beginPath();
  context.arc(middle, middle, size * 0.18, 0, Math.PI * 2);
  context.fill();

  // A few chips flung off the rim, which is what stops every hole looking
  // like a drilled circle.
  context.fillStyle = "rgba(40, 38, 36, 0.5)";
  for (let i = 0; i < 9; i += 1) {
    const angle = Math.random() * Math.PI * 2;
    const radius = size * (0.2 + Math.random() * 0.22);
    context.beginPath();
    context.arc(
      middle + Math.cos(angle) * radius,
      middle + Math.sin(angle) * radius,
      1 + Math.random() * 1.8,
      0,
      Math.PI * 2,
    );
    context.fill();
  }
  texture.update();
  return texture;
};

const emissive = (
  scene: Scene,
  name: string,
  hex: string,
  glow: number,
): StandardMaterial => {
  const material = new StandardMaterial(name, scene);
  const colour = Color3.FromHexString(hex);
  material.diffuseColor = colour;
  material.emissiveColor = colour.scale(glow);
  material.specularColor = Color3.Black();
  material.disableLighting = glow > 0.5;
  material.freeze();
  return material;
};
