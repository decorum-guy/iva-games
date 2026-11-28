import * as THREE from 'three';

/** Repeatable close-range surface art; source remains editable with the renderer. */
function surfaceTexture(kind: 'concrete' | 'metal' | 'archive' | 'floor'): THREE.CanvasTexture {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  const bases = { concrete: '#53646a', metal: '#3b5559', archive: '#425354', floor: '#465559' };
  ctx.fillStyle = bases[kind]; ctx.fillRect(0, 0, 256, 256);
  let seed = kind.length * 8121;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < 7000; i++) {
    const light = random() > 0.5;
    ctx.fillStyle = light ? `rgba(209,216,204,${random() * 0.11})` : `rgba(4,15,21,${random() * 0.16})`;
    ctx.fillRect(random() * 256, random() * 256, 0.5 + random() * 2, 0.6 + random() * 3);
  }
  if (kind === 'metal') {
    ctx.strokeStyle = 'rgba(13,27,30,.7)'; ctx.lineWidth = 3;
    for (let x = 32; x < 256; x += 64) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 256); ctx.stroke(); }
    ctx.fillStyle = '#1c3035';
    for (let x = 8; x < 256; x += 64) for (const y of [8, 248]) { ctx.beginPath(); ctx.arc(x, y, 2.5, 0, Math.PI * 2); ctx.fill(); }
  } else if (kind === 'archive') {
    ctx.fillStyle = 'rgba(26,38,39,.32)'; ctx.fillRect(0, 160, 256, 96);
    ctx.fillStyle = '#7c7659'; ctx.fillRect(0, 156, 256, 3);
    for (let i = 0; i < 45; i++) {
      ctx.fillStyle = `rgba(155,105,65,${random() * 0.3})`;
      ctx.fillRect(random() * 256, 150 + random() * 80, 1 + random() * 4, 5 + random() * 40);
    }
  } else if (kind === 'floor') {
    ctx.strokeStyle = '#253b40'; ctx.lineWidth = 3; ctx.strokeRect(1.5, 1.5, 253, 253);
    ctx.strokeStyle = 'rgba(166,165,135,.18)'; ctx.lineWidth = 1; ctx.strokeRect(7, 7, 242, 242);
    for (let i = 0; i < 14; i++) {
      ctx.strokeStyle = 'rgba(19,33,37,.28)'; ctx.beginPath();
      const x = random() * 256, y = random() * 256; ctx.moveTo(x, y); ctx.lineTo(x + random() * 70 - 35, y + random() * 20); ctx.stroke();
    }
  } else {
    ctx.strokeStyle = 'rgba(18,29,31,.28)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(44, 0); ctx.lineTo(53, 60); ctx.lineTo(47, 89); ctx.lineTo(62, 118); ctx.stroke();
    ctx.fillStyle = 'rgba(32,63,60,.16)'; ctx.fillRect(0, 200, 256, 56);
  }
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.anisotropy = 4;
  return texture;
}

export function createWorldMaterials(): Record<string, THREE.MeshStandardMaterial> {
  const concrete = surfaceTexture('concrete'), metal = surfaceTexture('metal'), archive = surfaceTexture('archive'), floor = surfaceTexture('floor');
  return {
    concrete: new THREE.MeshStandardMaterial({ color: '#61747b', map: concrete, roughness: 0.94, metalness: 0.03 }),
    metal: new THREE.MeshStandardMaterial({ color: '#536e70', map: metal, roughness: 0.71, metalness: 0.6 }),
    archive: new THREE.MeshStandardMaterial({ color: '#7c887c', map: archive, roughness: 0.96, metalness: 0.04 }),
    floor: new THREE.MeshStandardMaterial({ color: '#8c9a91', map: floor, roughness: 0.88, metalness: 0.06 }),
    water: new THREE.MeshStandardMaterial({ color: '#24464b', roughness: 0.28, metalness: 0.28, transparent: true, opacity: 0.75 }),
    bronze: new THREE.MeshStandardMaterial({ color: '#8c6f49', roughness: 0.64, metalness: 0.68 }),
    dark: new THREE.MeshStandardMaterial({ color: '#182c32', roughness: 0.73, metalness: 0.45 }),
    ivory: new THREE.MeshStandardMaterial({ color: '#c9c4ad', roughness: 0.82 }),
    lamp: new THREE.MeshStandardMaterial({ color: '#efd3a7', emissive: '#d9a46e', emissiveIntensity: 2.2, roughness: 0.35 }),
    cyan: new THREE.MeshStandardMaterial({ color: '#bce2dd', emissive: '#679b9b', emissiveIntensity: 0.7, roughness: 0.55 }),
  };
}

export function makeSign(text: string, small = '', color = '#e9dcc3'): THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> {
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 192;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#14252b'; ctx.fillRect(0, 0, 512, 192);
  ctx.strokeStyle = '#819590'; ctx.lineWidth = 3; ctx.strokeRect(8, 8, 496, 176);
  ctx.fillStyle = color; ctx.textAlign = 'center';
  ctx.font = '600 43px "IBM Plex Mono", monospace'; ctx.fillText(text, 256, small ? 86 : 111, 465);
  if (small) { ctx.font = '24px "PT Sans", sans-serif'; ctx.fillStyle = '#9fafaa'; ctx.fillText(small, 256, 143, 470); }
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false });
  return new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.64), material);
}

export function createEchoMaterial(): THREE.ShaderMaterial {
  const white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1); white.needsUpdate = true;
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: -100 }, uArrival: { value: 1000 }, uSource: { value: new THREE.Vector3() }, uCenter: { value: new THREE.Vector3() }, uStrength: { value: 0.8 }, uMask: { value: white } },
    vertexShader: `varying vec3 vWorld; void main(){vec4 world=modelMatrix*vec4(position,1.);vWorld=world.xyz;gl_Position=projectionMatrix*viewMatrix*world;}`,
    fragmentShader: `varying vec3 vWorld; uniform float uTime; uniform float uArrival; uniform float uStrength; uniform vec3 uSource; uniform vec3 uCenter; uniform sampler2D uMask;
      void main(){float offset=(length(vWorld-uSource)-length(uCenter-uSource))/18.;float age=uTime-uArrival-offset;
      float alpha=step(0.,age)*(1.-smoothstep(.08,1.15,age))*uStrength;
      alpha*=mix(.82,1.,texture2D(uMask,vec2(fract(length(vWorld-uSource)*.18),clamp(age,0.,1.))).r);
      if(alpha<.005)discard; vec3 tint=mix(vec3(.35,.69,.77),vec3(.76,.94,1.),exp(-age*12.));gl_FragColor=vec4(tint,alpha);}`,
    transparent: true, depthTest: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
}
