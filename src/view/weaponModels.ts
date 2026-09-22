import "@babylonjs/core/Meshes/Builders/boxBuilder";
import "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import "@babylonjs/core/Meshes/Builders/torusBuilder";
import "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Matrix } from "@babylonjs/core/Maths/math.vector";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import type { WeaponId } from "../sim/weapons";
import { MODELS, type ModelSpec, type Part, type Tone } from "./weaponGeometry";
import { DEFAULT_FINISH, type Finish } from "../sim/cosmetics";

/**
 * The weapon viewmodels, built from primitives.
 *
 * The shapes live in weaponGeometry, which has no engine import, so the rule
 * that nothing but the sights may cover the crosshair is checked against the
 * same parts this builds. This file is only the translation: each part becomes
 * a box, a cylinder, a ring or a sphere, is baked into model space, and is
 * merged with everything sharing its colour.
 *
 * The merge is the reason the weapons can carry this much detail. Seventy-odd
 * parts — rail teeth, slots, chequering, serrations — come out as half a dozen
 * meshes, so the whole weapon costs a handful of draw calls on a phone however
 * finely it is modelled. The reciprocating parts are merged separately, onto
 * their own node, so the bolt can ride back without any of it being animated
 * one piece at a time.
 *
 * These are original blocked-out shapes, not replicas of any real weapon.
 */

const HALF_TURN = Math.PI / 2;

/** Painting order, which also decides the meshes' names. */
const TONE_KEYS: Tone[] = ["body", "metal", "accent", "shadow", "highlight", "optic"];

/** The colour a finish gives each surface. */
const toneColour = (tone: Tone, finish: Finish): Color3 => {
  switch (tone) {
    case "body":
      return Color3.FromHexString(finish.body);
    case "metal":
      return Color3.FromHexString(finish.metal);
    case "accent":
      return Color3.FromHexString(finish.accent);
    // Recesses read as depth only if they are darker than whatever is around
    // them, so they are derived from the finish rather than set to a colour
    // that would look painted on against a dark one.
    case "shadow":
      return Color3.FromHexString(finish.metal).scale(0.45);
    // Raised edges and small controls, lifted just enough to separate from
    // the body. Any more and it blows out where the light grazes it.
    case "highlight":
      return lift(Color3.FromHexString(finish.body), 0.12);
    case "optic":
      // The one colour a finish does not own: a sight dot that changed with
      // the paint would stop reading as a light.
      return new Color3(1.0, 0.78, 0.35);
  }
};

const lift = (colour: Color3, amount: number): Color3 =>
  new Color3(
    Math.min(1, colour.r + amount),
    Math.min(1, colour.g + amount),
    Math.min(1, colour.b + amount),
  );

/** Lets the equipped finish repaint every weapon in place. */
export interface FinishPainter {
  apply(finish: Finish): void;
}

export interface WeaponModel {
  root: TransformNode;
  /** The shapes this was built from, which is what decides where it sits. */
  spec: ModelSpec;
  /** Local position of the sight, used to line up the aimed pose. */
  sight: { x: number; y: number; z: number };
  /** Carries the bolt, slide or pump, which rides back as the weapon fires. */
  bolt: TransformNode;
  /** Where the muzzle flash sits. */
  muzzle: TransformNode;
}

/** Build one part as a mesh sitting at the origin, unrotated. */
const buildShape = (name: string, part: Part, scene: Scene): Mesh => {
  const axis = part.axis ?? "z";
  switch (part.shape) {
    case "box":
      return MeshBuilder.CreateBox(
        name,
        { width: part.width, height: part.height, depth: part.depth },
        scene,
      );
    case "cylinder": {
      // Described by the box it fits inside, so the length is whichever
      // dimension lies along its axis and the diameter is one of the others.
      const height = axis === "x" ? part.width : axis === "y" ? part.height : part.depth;
      const diameter = axis === "x" ? part.height : part.width;
      return MeshBuilder.CreateCylinder(
        name,
        {
          height,
          diameterTop: diameter * (part.taper ?? 1),
          diameterBottom: diameter,
          tessellation: part.facets ?? 20,
        },
        scene,
      );
    }
    case "ring":
      return MeshBuilder.CreateTorus(
        name,
        {
          diameter: part.width - (part.thickness ?? 0.004),
          thickness: part.thickness ?? 0.004,
          tessellation: part.facets ?? 20,
        },
        scene,
      );
    case "sphere":
      return MeshBuilder.CreateSphere(name, { diameter: part.width, segments: 8 }, scene);
  }
};

/**
 * Turn the part's own axis into a rotation.
 *
 * Babylon builds cylinders and rings standing up the Y axis, and most of the
 * weapon's are lying along Z, so this is where that is put right — once, here,
 * rather than in every part that happens to be round.
 */
const axisRotation = (part: Part): Matrix => {
  if (part.shape !== "cylinder" && part.shape !== "ring") return Matrix.Identity();
  switch (part.axis ?? "z") {
    case "x":
      return Matrix.RotationZ(HALF_TURN);
    case "y":
      return Matrix.Identity();
    case "z":
      return Matrix.RotationX(HALF_TURN);
  }
};

/**
 * Bake a part's orientation and place into its vertices.
 *
 * Baking rather than parenting is what lets the merge below be a plain
 * concatenation: every part already sits where it belongs in the weapon's own
 * space, so nothing is left for a transform to do.
 */
const placePart = (mesh: Mesh, part: Part): void => {
  const spin = part.rotation;
  const orientation = spin
    ? axisRotation(part).multiply(
        Matrix.RotationYawPitchRoll(spin.y ?? 0, spin.x ?? 0, spin.z ?? 0),
      )
    : axisRotation(part);
  mesh.bakeTransformIntoVertices(
    orientation.multiply(Matrix.Translation(part.x, part.y, part.z)),
  );
};

export const createWeaponModels = (
  scene: Scene,
  layerMask: number,
  /** No shine on anything: the retro look's weapon is matte like its world. */
  matte = false,
): { models: Record<WeaponId, WeaponModel>; painter: FinishPainter } => {
  const materials = new Map<Tone, StandardMaterial>();
  for (const tone of TONE_KEYS) {
    const material = new StandardMaterial(`mat_vm_${tone}`, scene);
    material.specularColor = matte ? Color3.Black() : new Color3(0.12, 0.12, 0.13);
    material.specularPower = 48;
    materials.set(tone, material);
  }

  const painter: FinishPainter = {
    apply(finish) {
      for (const tone of TONE_KEYS) {
        const material = materials.get(tone);
        if (!material) continue;
        const colour = toneColour(tone, finish);
        // Materials are frozen for speed, so a repaint has to lift that first.
        material.unfreeze();
        material.diffuseColor = colour;
        material.ambientColor = colour;
        // The viewmodel is lit by its own rig, so it must not go black in
        // shadow; the sight dot is lit by nothing at all and glows on its own.
        material.emissiveColor = tone === "optic" ? colour.scale(0.85) : colour.scale(0.1);
        material.freeze();
      }
    },
  };
  painter.apply(DEFAULT_FINISH);

  const models = {} as Record<WeaponId, WeaponModel>;
  for (const [id, spec] of Object.entries(MODELS) as [WeaponId, ModelSpec][]) {
    const root = new TransformNode(`vm_${id}`, scene);
    const bolt = new TransformNode(`vm_${id}_bolt`, scene);
    bolt.parent = root;

    // One merged mesh per colour per group: the whole weapon in a handful of
    // draw calls, however many parts went into it.
    const batches = new Map<string, Mesh[]>();
    for (const [index, part] of spec.parts.entries()) {
      const mesh = buildShape(`vm_${id}_part_${index}`, part, scene);
      placePart(mesh, part);
      const key = `${part.group ?? "body"}:${part.tone}`;
      const batch = batches.get(key);
      if (batch) batch.push(mesh);
      else batches.set(key, [mesh]);
    }

    let index = 0;
    for (const group of ["body", "bolt"]) {
      for (const tone of TONE_KEYS) {
        const batch = batches.get(`${group}:${tone}`);
        if (!batch || batch.length === 0) continue;
        const merged =
          batch.length === 1 ? batch[0] : (Mesh.MergeMeshes(batch, true, true) as Mesh);
        merged.name = `vm_${id}_${index}`;
        index += 1;
        merged.material = materials.get(tone)!;
        merged.isPickable = false;
        merged.layerMask = layerMask;
        merged.parent = group === "bolt" ? bolt : root;
        merged.position.setAll(0);
        merged.rotation.setAll(0);
      }
    }

    const muzzle = new TransformNode(`vm_${id}_muzzle`, scene);
    muzzle.position.set(0, spec.muzzle.y, spec.muzzle.z);
    muzzle.parent = root;

    root.setEnabled(false);
    models[id] = { root, spec, sight: spec.sight, bolt, muzzle };
  }
  return { models, painter };
};
