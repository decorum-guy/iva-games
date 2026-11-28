import * as THREE from 'three';

/** Repeatable close-range surface art; source remains editable with the renderer. */
export function createWorldMaterials(): Record<string, THREE.MeshStandardMaterial> {
  const loader = new THREE.TextureLoader();
  const surface = (kind: 'concrete' | 'metal' | 'archive' | 'floor', metalness: number) => {
    const load = (suffix: string, color = false) => {
      const texture=loader.load(`/knock-first/textures/${kind}-${suffix}`);
      texture.wrapS=texture.wrapT=THREE.RepeatWrapping; texture.anisotropy=4;
      if(color) texture.colorSpace=THREE.SRGBColorSpace;
      return texture;
    };
    return new THREE.MeshStandardMaterial({map:load('color.jpg',true), normalMap:load('normal.png'), normalScale:new THREE.Vector2(.6,.6), roughnessMap:load('roughness.png'), roughness:1,metalness});
  };
  return {
    concrete: surface('concrete', .02), metal: surface('metal', .45),
    archive: surface('archive', .03), floor: surface('floor', .1),
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

/** Enamel label with thickness, rolled rim and fasteners; not a floating HUD. */
export function makePhysicalSign(text: string, small = '', color = '#e9dcc3', width = 1.7): THREE.Group {
  const root=new THREE.Group(); const height=width*192/512;
  const face=makeSign(text,small,color); const map=face.material.map;
  face.material.dispose();
  const panelMaterial=new THREE.MeshStandardMaterial({color:'#25383d',metalness:.35,roughness:.66});
  const ink=new THREE.MeshStandardMaterial({map,roughness:.78,metalness:.1});
  const panel=new THREE.Mesh(new THREE.BoxGeometry(width+.025,height+.025,.035),panelMaterial);
  panel.castShadow=panel.receiveShadow=true;root.add(panel);
  const printed=new THREE.Mesh(new THREE.PlaneGeometry(width,height),ink);printed.position.z=.0185;root.add(printed);face.geometry.dispose();
  const screwMaterial=new THREE.MeshStandardMaterial({color:'#8f9994',metalness:.7,roughness:.55});
  for(const x of [-1,1]) for(const y of [-1,1]){
    const screw=new THREE.Mesh(new THREE.CylinderGeometry(.006,.006,.008,8),screwMaterial);
    screw.rotation.x=Math.PI/2;screw.position.set(x*(width/2-.018),y*(height/2-.017),.022);root.add(screw);
  }
  return root;
}
