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
  material.color.set(side === 'white' ? '#fff0da' : '#bdcde2')
  // A shaped porcelain highlight separates white silhouettes from the matte board.
  // The dark army keeps a cool reflection instead of lifting its whole albedo.
  material.roughness = side === 'white' ? 0.66 : 0.72
  material.clearcoat = side === 'white' ? 0.24 : 0.34
  material.clearcoatRoughness = 0.30
}

const quartzGLSL = /* glsl */ `
varying vec3 vStonePoint;
uniform float uWear;
uniform float uCondition;
uniform float uEmber;
uniform float uFocus;
uniform float uMend;
uniform float uFade;
uniform float uSeed;
uniform vec3 uTincture;
uniform vec3 uSweepTint;
uniform vec4 uRoyal;
uniform vec4 uBirth;

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
  vec2 uv = vec2(p.x + p.z * .74, p.y + p.z * .17) * vec2(2.8, 2.6) + uSeed;
  uv += .10 * vec2(sin(9.3 * p.y + 5.0 * p.z), sin(8.8 * p.x + 6.0 * p.y));
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
    envMapIntensity: 1.12,
    specularIntensity: 0.90,
  })
  material.normalScale.set(.56, .56)
  setArmySurface(material, source, side)

  const values = {
    uWear: { value: 0 },
    uCondition: { value: 0 },
    uEmber: { value: 0 },
    uFocus: { value: 0 },
    uMend: { value: -1 },
    uFade: { value: 0 },
    uSeed: { value: seed },
    uTincture: { value: new Color(stateColors.neutral) },
    uSweepTint: { value: new Color('#b4dbca') },
    // Resting threat, live strength, travel up the model, and the discharge.
    uRoyal: { value: { x: 0, y: 0, z: 0, w: 0 } },
    uBirth: { value: { x: 0, y: 0, z: 0, w: 0 } },
  }

  material.customProgramCacheKey = () => 'remorse-marble-6'
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
        float forgeLight = 0.0;
        if (uBirth.z > 0.5) {
          float cut = uBirth.x * 1.88 - pStone.y;
          float chip = (grain(floor(pStone * 26.0) + uSeed) - .5) * .13;
          if (cut + chip < -.045) discard;
          forgeLight = (1.0 - smoothstep(.015, .21, abs(cut + chip))) * uBirth.y;
        }
        float wearMap = 0.0;
        float fault = 0.0;
        vec3 royalGlow = vec3(0.0);
        if (uWear > 0.001) {
          // Broad dark fissures frame a narrower colored inlay. The old hairline
          // treatment vanished when an entire figure occupied only a few pixels.
          float veinWidth = (uCondition > 3.5 ? .18 : .145) * (1.0 + .22 * uFocus);
          float spread = faultLine(pStone);
          float pixelEdge = max(fwidth(spread) * .65, .012);
          float interrupted = .66 + .34 * smoothstep(-.4, .52,
            sin(6.3 * pStone.y + 9.0 * pStone.z) * cos(7.0 * pStone.x - 3.0 * pStone.y));
          fault = (1.0 - smoothstep(veinWidth * .92, veinWidth * 1.22 + pixelEdge, spread)) * uWear;
          wearMap = (1.0 - smoothstep(veinWidth * .16, veinWidth * .53 + pixelEdge * .45, spread)) * interrupted * uWear;
          if (uCondition > 1.5 && uCondition < 2.5) {
            float haze = .62 + .20 * sin(pStone.y * 4.0 + pStone.x * 5.0);
            vec3 coldStone = diffuseColor.rgb * vec3(.39, .62, .86) + vec3(.009, .025, .045);
            diffuseColor.rgb = mix(diffuseColor.rgb, coldStone, haze * uWear);
          }
          float stoneLightness = smoothstep(.06, .62, dot(diffuseColor.rgb, vec3(.2126, .7152, .0722)));
          diffuseColor.rgb *= 1.0 - fault * mix(.35, .78, stoneLightness);
          diffuseColor.rgb = mix(diffuseColor.rgb, uTincture * mix(.88, .58, stoneLightness), wearMap * .86);
        }
        if (uRoyal.x + uRoyal.y > .002) {
          float height = clamp(pStone.y / 1.64, 0.0, 1.0);
          float crown = smoothstep(.62, .99, height);
          float front = uRoyal.z * 1.24 - .12;
          float reach = 1.0 - smoothstep(front - .025, front + .15, height);
          float pulse = 1.0 - smoothstep(.025, .24, abs(height - front));
          float lightStone = smoothstep(.15, .66, dot(diffuseColor.rgb, vec3(.21, .72, .07)));
          float power = uRoyal.x * mix(.36, .68, lightStone) + uRoyal.y * (.18 + .82 * reach);
          vec3 veinPoint = vec3(pStone.x * 1.15 + .07 * sin(pStone.y * 7.3), pStone.y * .79, pStone.z * 1.28);
          float seam = faultLine(veinPoint);
          float aa = clamp(fwidth(seam), .018, .095);
          float recess = 1.0 - smoothstep(.12, .26 + aa, seam);
          float thread = 1.0 - smoothstep(.029, .081 + aa * .56 + uRoyal.w * .065, seam);
          float facets = .61 + .39 * smoothstep(-.55, .75, sin(16.0 * pStone.x + 13.0 * pStone.y - 9.0 * pStone.z));
          diffuseColor.rgb *= 1.0 - recess * min(.64, power * .48);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.21, .018, .031), recess * min(.39, power * .30));
          vec3 mineral = mix(vec3(.83, .049, .023), vec3(1.49, .61, .132),
            clamp(.12 + .50 * crown + .32 * pulse + .33 * uRoyal.w, 0.0, 1.0));
          royalGlow = mineral * thread * power * facets;
        }
      `)
      .replace('#include <roughnessmap_fragment>', /* glsl */ `
        #include <roughnessmap_fragment>
        if (uCondition > 1.5 && uCondition < 2.5) roughnessFactor = mix(roughnessFactor, .94, uWear * .82);
        roughnessFactor = mix(roughnessFactor, .38, wearMap * .52);
        roughnessFactor = mix(roughnessFactor, .43, min(.34, uRoyal.y * .24));
      `)
      .replace('#include <emissivemap_fragment>', /* glsl */ `
        #include <emissivemap_fragment>
        float heat = uCondition > 3.5 ? .56 : uCondition > 2.5 ? .44 : .27;
        totalEmissiveRadiance += uTincture * wearMap * (heat + .60 * uEmber + .95 * uFocus);
        if (uFocus > .001) {
          float teachingEdge = pow(1.0 - abs(dot(normal, normalize(vViewPosition))), 2.6);
          // A neutral/reborn figure gets an ivory edge, not an invented affliction.
          vec3 teachingTint = uCondition < .5 ? vec3(.80, .75, .62) : uTincture;
          totalEmissiveRadiance += teachingTint * teachingEdge * uFocus * .32;
        }
        if (uMend >= 0.0) {
          float sweep = 1.0 - smoothstep(.01, .17, abs(pStone.y - uMend * 1.9 + .105));
          totalEmissiveRadiance += uSweepTint * sweep * .68;
        }
        totalEmissiveRadiance += uTincture * edgeFade * .44;
        totalEmissiveRadiance += vec3(1.09, .63, .31) * forgeLight;
        if (uBirth.y > .001) {
          float edge = pow(1.0 - abs(dot(normal, normalize(vViewPosition))), 3.0);
          totalEmissiveRadiance += vec3(.71, .45, .28) * edge * uBirth.y * .34;
        }
        if (uBirth.w > .001) {
          float silver = pow(1.0 - abs(dot(normal, normalize(vViewPosition))), 2.2);
          totalEmissiveRadiance += vec3(.47, .61, .79) * (.066 + silver * .55) * uBirth.w;
        }
        if (uRoyal.x + uRoyal.y > .002) {
          float rim = pow(1.0 - abs(dot(normal, normalize(vViewPosition))), 3.7);
          float crown = smoothstep(.99, 1.57, pStone.y);
          totalEmissiveRadiance += royalGlow;
          totalEmissiveRadiance += vec3(.25, .42, .66) * rim * (uRoyal.x * .055 + uRoyal.y * .29);
          totalEmissiveRadiance += vec3(.91, .252, .061) * crown * rim * uRoyal.w * .43;
        }
      `)
  }
  return { material, values }
}
