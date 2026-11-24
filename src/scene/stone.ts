import { Color, MeshPhysicalMaterial, type MeshStandardMaterial } from 'three'
import type { Affliction, Side } from '../core/types'
import { stateColors } from './types'

export const conditionCode: Record<Affliction, number> = {
  neutral: 0,
  guilt: 1,
  devastated: 2,
  berserk: 3,
  bloodlust: 4,
}

export function setArmySurface(material: MeshPhysicalMaterial, source: MeshStandardMaterial, side: Side) {
  material.map = source.map
  material.normalMap = source.normalMap
  material.roughnessMap = source.roughnessMap
  material.aoMap = source.aoMap
  material.aoMapIntensity = 0.7
  material.color.set(side === 'white' ? '#ffebca' : '#bfcee3')
  material.roughness = side === 'white' ? 0.93 : 0.79
  material.clearcoat = side === 'white' ? 0.20 : 0.29
  material.clearcoatRoughness = 0.28
}

const quartzGLSL = /* glsl */ `
varying vec3 vStonePoint;
uniform float uWear;
uniform float uCondition;
uniform float uEmber;
uniform float uMend;
uniform float uFade;
uniform float uSeed;
uniform vec3 uTincture;
uniform vec3 uSweepTint;

float grain(vec3 p) {
  p = fract(p * 0.319 + vec3(0.1, 0.2, 0.3));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

vec2 crystalJitter(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  q += dot(q, q.yzx + 33.33);
  return fract((q.xx + q.yz) * q.zy);
}

float faultLine(vec3 p) {
  vec2 uv = vec2(p.x + p.z * .74, p.y + p.z * .17) * vec2(4.7, 4.0) + uSeed;
  uv += .12 * vec2(sin(13.3 * p.y + 7.0 * p.z), sin(12.8 * p.x + 8.0 * p.y));
  vec2 cell = floor(uv);
  vec2 local = fract(uv);
  float close = 8.0;
  float next = 8.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 offset = vec2(float(x), float(y));
      vec2 edge = offset + crystalJitter(cell + offset) - local;
      float distance2 = dot(edge, edge);
      next = min(next, max(close, distance2));
      close = min(close, distance2);
    }
  }
  return next - close;
}
`

export function stoneMaterial(source: MeshStandardMaterial, side: Side, seed: number) {
  const material = new MeshPhysicalMaterial({
    metalness: 0.035,
    roughness: 0.85,
    envMapIntensity: 1.28,
    specularIntensity: 0.85,
  })
  material.normalScale.set(.56, .56)
  setArmySurface(material, source, side)

  const values = {
    uWear: { value: 0 },
    uCondition: { value: 0 },
    uEmber: { value: 0 },
    uMend: { value: -1 },
    uFade: { value: 0 },
    uSeed: { value: seed },
    uTincture: { value: new Color(stateColors.neutral) },
    uSweepTint: { value: new Color('#b4dbca') },
  }

  material.customProgramCacheKey = () => 'remorse-marble-1'
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, values)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vStonePoint;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvStonePoint = position;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${quartzGLSL}`)
      .replace('#include <color_fragment>', /* glsl */ `
        #include <color_fragment>
        vec3 pStone = vStonePoint;
        float edgeFade = 0.0;
        if (uFade > 0.001) {
          float crystal = grain(floor(pStone * 21.0) + uSeed);
          float threshold = crystal * 0.66 + (pStone.y + .08) * .20;
          if (threshold < uFade) discard;
          edgeFade = 1.0 - smoothstep(.005, .105, threshold - uFade);
        }
        float wearMap = 0.0;
        float fault = 0.0;
        if (uWear > 0.001) {
          float veinWidth = uCondition > 3.5 ? .085 : .058;
          float spread = faultLine(pStone);
          float interrupted = .44 + .56 * smoothstep(-.4, .52,
            sin(8.3 * pStone.y + 13.0 * pStone.z) * cos(10.0 * pStone.x - 4.0 * pStone.y));
          wearMap = (1.0 - smoothstep(veinWidth * .25, veinWidth, spread)) * interrupted * uWear;
          fault = (1.0 - smoothstep(veinWidth * .035, veinWidth * .5, spread)) * uWear;
          if (uCondition > 1.5 && uCondition < 2.5) {
            float haze = clamp(.48 + .28 * sin(pStone.y * 4.0 + pStone.x * 8.0), .0, 1.0);
            diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(.66, .77, .94) + vec3(.012, .025, .04),
              haze * uWear * .56);
          }
          float stoneLightness = smoothstep(.06, .62, dot(diffuseColor.rgb, vec3(.2126, .7152, .0722)));
          diffuseColor.rgb *= 1.0 - fault * mix(.29, .66, stoneLightness);
          diffuseColor.rgb = mix(diffuseColor.rgb, uTincture * mix(.77, .46, stoneLightness), wearMap * .67);
        }
      `)
      .replace('#include <roughnessmap_fragment>', /* glsl */ `
        #include <roughnessmap_fragment>
        if (uCondition > 1.5 && uCondition < 2.5) roughnessFactor = mix(roughnessFactor, .82, uWear * .59);
        roughnessFactor = mix(roughnessFactor, .43, wearMap * .35);
      `)
      .replace('#include <emissivemap_fragment>', /* glsl */ `
        #include <emissivemap_fragment>
        float heat = uCondition > 2.5 ? .43 : .14;
        totalEmissiveRadiance += uTincture * wearMap * (heat + .74 * uEmber);
        if (uMend >= 0.0) {
          float sweep = 1.0 - smoothstep(.01, .17, abs(pStone.y - uMend * 1.9 + .105));
          totalEmissiveRadiance += uSweepTint * sweep * .68;
        }
        totalEmissiveRadiance += uTincture * edgeFade * .44;
      `)
  }
  return { material, values }
}
