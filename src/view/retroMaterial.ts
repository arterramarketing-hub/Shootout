import { ShaderStore } from "@babylonjs/core/Engines/shaderStore";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import type { Texture } from "@babylonjs/core/Materials/Textures/texture";
import type { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Scene } from "@babylonjs/core/scene";
import "@babylonjs/core/Shaders/ShadersInclude/fogFragment";
import "@babylonjs/core/Shaders/ShadersInclude/fogFragmentDeclaration";
import "@babylonjs/core/Shaders/ShadersInclude/fogVertex";
import "@babylonjs/core/Shaders/ShadersInclude/fogVertexDeclaration";

/**
 * The retro look's material for the level: a texture, times the vertex
 * colour, and fog. Nothing else.
 *
 * The light is already in the vertices (see `retroBake.ts`), so there is no
 * normal, no light loop, no specular, no shadow lookup and no grade. This
 * is about as little as a fragment can do and still be textured, and on a
 * phone it is the difference between the level being the frame's cost and
 * the level being a rounding error in it.
 *
 * The fog is the engine's own, pulled in by the same includes its standard
 * material uses, so the level and the figures standing in it fade into the
 * same colour at the same distance.
 */

const VERTEX = `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
attribute vec4 color;
uniform mat4 world;
uniform mat4 view;
uniform mat4 worldViewProjection;
varying vec2 vUV;
varying vec3 vColor;
#include<fogVertexDeclaration>
void main() {
  vec4 worldPos = world * vec4(position, 1.0);
  gl_Position = worldViewProjection * vec4(position, 1.0);
  vUV = uv;
  vColor = color.rgb;
#include<fogVertex>
}
`;

const FRAGMENT = `
precision highp float;
varying vec2 vUV;
varying vec3 vColor;
uniform sampler2D diffuseSampler;
uniform vec3 tint;
#include<fogFragmentDeclaration>
void main() {
  vec4 color = vec4(texture2D(diffuseSampler, vUV).rgb * vColor * tint, 1.0);
#include<fogFragment>
  gl_FragColor = color;
}
`;

const SHADER = "shootoutRetro";

const register = (): void => {
  if (ShaderStore.ShadersStore[`${SHADER}VertexShader`]) return;
  ShaderStore.ShadersStore[`${SHADER}VertexShader`] = VERTEX;
  ShaderStore.ShadersStore[`${SHADER}FragmentShader`] = FRAGMENT;
};

/** One level material: this texture, this tint, the vertices' own light. */
export const createRetroMaterial = (
  scene: Scene,
  name: string,
  texture: Texture,
  tint: Color3,
): ShaderMaterial => {
  register();
  const material = new ShaderMaterial(name, scene, SHADER, {
    attributes: ["position", "uv", "color"],
    uniforms: ["world", "view", "worldViewProjection", "tint"],
    samplers: ["diffuseSampler"],
  });
  material.setTexture("diffuseSampler", texture);
  material.setColor3("tint", tint);
  material.backFaceCulling = true;
  return material;
};
