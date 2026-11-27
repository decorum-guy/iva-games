/** Original COLOSSUS reliquary geometry. No external meshes, textures or recordings. */
import * as T from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

globalThis.FileReader = class {
  readAsArrayBuffer(blob) { blob.arrayBuffer().then(value => { this.result = value; this.onloadend?.(); }); }
  readAsDataURL(blob) { blob.arrayBuffer().then(value => { this.result = `data:${blob.type};base64,${Buffer.from(value).toString('base64')}`; this.onloadend?.(); }); }
};
const out = new URL('../public/assets/colossus/models/', import.meta.url);
await mkdir(out, { recursive: true });
const material = (name, color, roughness, metalness, extras = {}) => new T.MeshStandardMaterial({ name, color, roughness, metalness, ...extras });
const stone = material('ivory_stone', '#e3dabf', .74, .07);
const bronze = material('bronze_inlay', '#b29a61', .39, .68);
const dark = material('recess', '#2b4149', .84, .12);
const plate = material('boss_armour', '#53666b', .57, .44);
const heart = material('boss_heart', '#e2aa6b', .32, .3, { emissive: '#bc7339', emissiveIntensity: .65 });
const mint = material('ward', '#b6d6bd', .32, .32, { emissive: '#668f7d', emissiveIntensity: .45 });
const crack = material('armour_fracture', '#2b4149', .88, .1);
const wood = material('training_wood', '#b1a580', .85, .03);
const grain = material('training_wood_dark', '#766f53', .92, .02);
function add(group, geometry, mat, x = 0, y = 0, z = 0, name = 'carving') {
  const mesh = new T.Mesh(geometry, mat); mesh.position.set(x, y, z); mesh.name = name; group.add(mesh); return mesh;
}
function cylinder(group, top, bottom, height, y, mat = stone, sides = 12, x = 0, z = 0, name = 'stone') {
  return add(group, new T.CylinderGeometry(top, bottom, height, sides), mat, x, y, z, name);
}
function box(group, width, height, depth, x, y, z, mat = stone, name = 'stone') {
  return add(group, new T.BoxGeometry(width, height, depth), mat, x, y, z, name);
}
function ring(group, radius, thickness, y, mat = bronze) {
  const mesh = add(group, new T.TorusGeometry(radius, thickness, 5, 28), mat, 0, y, 0, 'inlay'); mesh.rotation.x = Math.PI / 2; return mesh;
}
function line(group, start, end, radius, mat = bronze, name = 'engraving') {
  const direction = new T.Vector3(...end).sub(new T.Vector3(...start));
  const mesh = add(group, new T.CylinderGeometry(radius, radius, direction.length(), 5), mat, (start[0] + end[0]) / 2, (start[1] + end[1]) / 2, (start[2] + end[2]) / 2, name);
  mesh.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), direction.normalize()); return mesh;
}
function relief(group, points, depth, mat, name) {
  const shape = new T.Shape(); shape.moveTo(...points[0]); points.slice(1).forEach(point => shape.lineTo(...point)); shape.closePath();
  const geometry = new T.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: .012, bevelSize: .012, bevelSegments: 1, steps: 1 });
  geometry.translate(0, 0, -depth / 2); return add(group, geometry, mat, 0, 0, 0, name);
}
function base() {
  const group = new T.Group();
  cylinder(group, .30, .34, .08, .04, dark, 12);
  cylinder(group, .30, .31, .055, .108, bronze, 12);
  cylinder(group, .24, .29, .10, .185, stone, 12);
  cylinder(group, .13, .23, .29, .38, stone, 12);
  cylinder(group, .17, .13, .065, .56, bronze, 12);
  ring(group, .27, .008, .235, bronze);
  for (let i = 0; i < 8; i++) {
    const angle = i * Math.PI / 4;
    line(group, [Math.sin(angle) * .21, .27, Math.cos(angle) * .21], [Math.sin(angle) * .127, .50, Math.cos(angle) * .127], .008, bronze);
  }
  return group;
}

const army = {
  pawn(group) {
    cylinder(group, .165, .13, .09, .64);
    add(group, new T.IcosahedronGeometry(.18, 1), stone, 0, .80, 0, 'pawn_head');
    box(group, .15, .21, .04, 0, .45, .175, bronze, 'shield');
    add(group, new T.OctahedronGeometry(.052), mint, 0, .46, .207, 'ward_seal');
  },
  rook(group) {
    cylinder(group, .23, .17, .25, .72, stone, 12);
    cylinder(group, .27, .22, .08, .88, bronze, 12);
    cylinder(group, .21, .21, .05, .925, dark, 12);
    for (let i = 0; i < 4; i++) {
      const angle = i * Math.PI / 2;
      const merlon = box(group, .15, .18, .13, Math.sin(angle) * .20, 1.005, Math.cos(angle) * .20, stone, 'merlon'); merlon.rotation.y = angle;
      const arch = box(group, .07, .15, .025, Math.sin(angle) * .211, .74, Math.cos(angle) * .211, dark, 'recessed_arch'); arch.rotation.y = angle;
      line(group, [Math.sin(angle) * .217, .65, Math.cos(angle) * .217], [Math.sin(angle) * .217, .72, Math.cos(angle) * .217], .012, bronze, 'arch_seal');
    }
  },
  bishop(group) {
    cylinder(group, .18, .13, .14, .67);
    for (const sign of [-1, 1]) {
      const shape = new T.Shape(); shape.moveTo(sign * .03, .72); shape.lineTo(sign * .19, .79); shape.quadraticCurveTo(sign * .19, .94, sign * .025, 1.15); shape.lineTo(sign * .03, .72);
      const geometry = new T.ExtrudeGeometry(shape, { depth: .16, bevelEnabled: true, bevelThickness: .012, bevelSize: .012, bevelSegments: 1, steps: 1 }); geometry.translate(0, 0, -.08); add(group, geometry, stone, 0, 0, 0, 'split_mitre');
    }
    box(group, .018, .26, .10, 0, .90, 0, mint, 'mitre_light'); ring(group, .18, .02, .74);
    add(group, new T.OctahedronGeometry(.052), mint, 0, .66, .165, 'mitre_seal');
  },
  knight(group) {
    relief(group, [[-.15, .58], [-.23, .86], [-.15, 1.14], [-.04, 1.04], [.07, 1.12], [.16, .96], [.27, .86], [.21, .73], [.06, .79], [.015, .57]], .21, stone, 'horse');
    for (const sign of [-1, 1]) {
      add(group, new T.SphereGeometry(.024, 8, 6), mint, .12, .94, sign * .12, 'eye');
      line(group, [-.18, .75, sign * .12], [-.13, 1.04, sign * .12], .025, bronze, 'mane');
      line(group, [-.08, .72, sign * .12], [.19, .84, sign * .12], .012, bronze, 'bridle');
      for (let i = 0; i < 4; i++) line(group, [-.18 + i * .012, .79 + i * .05, sign * .126], [-.12 + i * .012, .77 + i * .05, sign * .126], .007, dark, 'mane_cut');
    }
  },
  queen(group) {
    cylinder(group, .20, .13, .18, .70); ring(group, .20, .025, .81);
    cylinder(group, .19, .16, .14, .90, stone, 10);
    for (let i = 0; i < 5; i++) {
      const angle = i * Math.PI * 2 / 5;
      line(group, [Math.sin(angle) * .17, .92, Math.cos(angle) * .17], [Math.sin(angle) * .23, 1.14, Math.cos(angle) * .23], .033, bronze, 'crown_prong');
      add(group, new T.OctahedronGeometry(.052), mint, Math.sin(angle) * .23, 1.14, Math.cos(angle) * .23, 'crown_gem');
    }
    add(group, new T.OctahedronGeometry(.12), stone, 0, 1.01, 0, 'crown_heart');
  },
  king(group) {
    cylinder(group, .20, .13, .25, .725); cylinder(group, .225, .19, .09, .895, bronze); cylinder(group, .17, .19, .13, 1.005, stone);
    box(group, .095, .31, .095, 0, 1.205, 0, stone, 'cross'); box(group, .30, .09, .095, 0, 1.245, 0, stone, 'cross');
    box(group, .038, .22, .012, 0, 1.205, .056, mint, 'cross_ward');
    box(group, .17, .23, .035, 0, .66, .177, bronze, 'royal_seal');
    add(group, new T.OctahedronGeometry(.06), mint, 0, .68, .209, 'seal_gem');
    for (const sign of [-1, 1]) line(group, [sign * .10, .62, .19], [sign * .09, .79, .19], .009, bronze, 'royal_engraving');
  },
};

/** A new boss needs one builder here; filenames follow the core boss ID. */
const bosses = {
  regent() {
    const group = new T.Group();
    for (const x of [-.57, .57]) for (const z of [-.57, .57]) {
      box(group, .42, .17, .46, x, .085, z, dark, 'foot'); box(group, .32, .35, .33, x, .33, z, plate, 'armour_leg'); cylinder(group, .19, .16, .12, .54, bronze, 10, x, z, 'joint');
    }
    cylinder(group, .70, .62, .25, .69, dark, 10); cylinder(group, .69, .80, .39, 1.00, plate, 10); cylinder(group, .53, .68, .22, 1.30, plate, 10);
    ring(group, .65, .035, 1.21); cylinder(group, .25, .39, .21, 1.51, bronze, 10);
    add(group, new T.IcosahedronGeometry(.23, 1), heart, 0, 1.06, .704, 'exposed_heart');
    for (const sign of [-1, 1]) {
      line(group, [sign * .24, .80, .67], [sign * .32, 1.26, .62], .035, bronze, 'heart_surround');
      box(group, .27, .55, .45, sign * .79, 1.05, 0, plate, 'armour_shoulder'); box(group, .24, .13, .65, sign * .79, .79, .20, bronze, 'ram');
      line(group, [sign * .47, .87, .64], [sign * .38, 1.05, .69], .017, crack, 'front_fracture');
      line(group, [sign * .38, 1.05, .69], [sign * .48, 1.17, .64], .017, crack, 'front_fracture');
    }
    box(group, .48, .17, .35, 0, 1.69, -.06, plate, 'head'); box(group, .33, .035, .02, 0, 1.69, .126, heart, 'eyes');
    for (const x of [-.20, 0, .20]) { const crown = add(group, new T.ConeGeometry(.065, x === 0 ? .24 : .18, 4), bronze, x, x === 0 ? 1.89 : 1.86, -.05, 'regal_crown'); crown.rotation.y = Math.PI / 4; }
    for (let i = 0; i < 8; i++) { const angle = i * Math.PI / 4; const seam = box(group, .07, .5, .045, Math.sin(angle) * .73, 1.03, Math.cos(angle) * .73, bronze, 'armour_seam'); seam.rotation.y = angle; }
    return group;
  },
  spire() {
    const group = new T.Group();
    cylinder(group, .22, .33, .14, .07, dark, 8); cylinder(group, .12, .22, .37, .325, plate, 8);
    add(group, new T.OctahedronGeometry(.20), heart, 0, .63, .015, 'heart');
    for (const sign of [-1, 1]) {
      line(group, [sign * .23, .17, .06], [sign * .12, 1.12, 0], .055, plate, 'armour_frame');
      relief(group, [[sign * .06, .82], [sign * .34, 1.08], [sign * .08, 1.70], [sign * .13, 1.01]], .07, bronze, 'blade');
      line(group, [sign * .16, .83, .045], [sign * .13, .98, .045], .013, crack, 'frame_fracture');
    }
    box(group, .13, .25, .12, 0, 1.12, 0, plate, 'visor'); box(group, .11, .025, .015, 0, 1.17, .071, heart, 'eye');
    line(group, [0, .18, .19], [0, .40, .12], .011, bronze, 'front_inlay'); return group;
  },
  archivist() {
    const group = new T.Group();
    for (const z of [-.46, .46]) { cylinder(group, .23, .33, .12, .06, dark, 10, 0, z, 'foot'); cylinder(group, .18, .22, .30, .27, bronze, 10, 0, z, 'support'); }
    box(group, .27, .72, 1.04, 0, .73, 0, dark, 'spine');
    add(group, new T.IcosahedronGeometry(.24, 1), heart, 0, 1.08, 0, 'heart');
    for (const sign of [-1, 1]) for (let i = 0; i < 4; i++) {
      const page = box(group, .055, .74, 1.18, sign * (.15 + i * .07), .83 + .035 * i, 0, i === 3 ? plate : stone, i === 3 ? 'armour_cover' : 'page'); page.rotation.z = sign * (.12 + i * .06);
      for (let j = 0; j < 3; j++) line(group, [sign * (.19 + i * .07), .62 + j * .16, -.42], [sign * (.19 + i * .07), .62 + j * .16, .42], .008, bronze, 'script');
    }
    for (const sign of [-1, 1]) {
      line(group, [sign * .45, .69, .60], [sign * .38, .90, .60], .012, crack, 'cover_fracture');
      line(group, [sign * .38, .90, .60], [sign * .45, 1.08, .60], .012, crack, 'cover_fracture');
    }
    cylinder(group, .13, .20, .18, 1.33, bronze, 8); add(group, new T.OctahedronGeometry(.16), heart, 0, 1.52, 0, 'flame');
    ring(group, .17, .014, 1.42, bronze); return group;
  },
  sentinel() {
    const group = new T.Group();
    for (const x of [-.48, .48]) for (const z of [-.44, .44]) {
      box(group, .35, .14, .36, x, .07, z, dark, 'training_foot'); cylinder(group, .13, .16, .29, .285, bronze, 10, x, z, 'articulated_leg');
    }
    cylinder(group, .48, .59, .70, .84, wood, 12); cylinder(group, .60, .61, .09, .51, bronze, 12); cylinder(group, .49, .51, .08, 1.19, bronze, 12);
    for (let i = 0; i < 12; i++) {
      const angle = i * Math.PI / 6;
      line(group, [Math.sin(angle) * .565, .58, Math.cos(angle) * .565], [Math.sin(angle) * .49, 1.12, Math.cos(angle) * .49], .007, grain, 'ashwood_grain');
    }
    cylinder(group, .22, .29, .12, 1.29, dark, 12);
    add(group, new T.IcosahedronGeometry(.31, 1), wood, 0, 1.56, 0, 'wooden_mask');
    const socket = cylinder(group, .15, .15, .07, 1.57, bronze, 16, 0, .27, 'lens_socket'); socket.rotation.x = Math.PI / 2;
    add(group, new T.IcosahedronGeometry(.105, 1), mint, 0, 1.57, .318, 'teaching_eye');
    box(group, .28, .29, .045, 0, .83, .56, bronze, 'chest_frame'); add(group, new T.OctahedronGeometry(.10), mint, 0, .85, .60, 'teaching_seal');
    for (const sign of [-1, 1]) {
      cylinder(group, .12, .12, .12, 1.12, bronze, 12, sign * .65, 0, 'shoulder_joint');
      box(group, .17, .47, .23, sign * .71, .9, .02, wood, 'training_arm');
      const shield = cylinder(group, .27, .27, .075, .91, plate, 6, sign * .72, .22, 'training_shield'); shield.rotation.x = Math.PI / 2;
      const shieldRing = add(group, new T.TorusGeometry(.205, .016, 5, 6), bronze, sign * .72, .91, .27, 'shield_rim'); shieldRing.rotation.z = Math.PI / 6;
      line(group, [sign * .72, .80, .275], [sign * .72, 1.02, .275], .014, mint, 'shield_mark');
      line(group, [sign * .20, 1.76, 0], [sign * .29, 1.91, 0], .024, bronze, 'tuning_prong');
    }
    return group;
  },
};

const models = {};
for (const [id, carve] of Object.entries(army)) { const group = base(); carve(group); await save(id, group); }
for (const [id, build] of Object.entries(bosses)) await save(id, build());

async function save(id, source) {
  source.updateMatrixWorld(true);
  const batches = new Map(); let sourceMeshes = 0;
  source.traverse(object => {
    if (!(object instanceof T.Mesh)) return;
    sourceMeshes++;
    let geometry = object.geometry.clone().applyMatrix4(object.matrixWorld);
    if (geometry.index) geometry = geometry.toNonIndexed();
    geometry.deleteAttribute('uv');
    const key = object.material.name;
    if (!batches.has(key)) batches.set(key, { material: object.material, geometries: [] });
    batches.get(key).geometries.push(geometry);
  });
  const group = new T.Group(); group.name = id;
  let triangles = 0;
  for (const [name, batch] of batches) {
    const merged = mergeVertices(mergeGeometries(batch.geometries), 1e-6);
    const mesh = new T.Mesh(merged, batch.material); mesh.name = name; group.add(mesh);
    triangles += (merged.index?.count ?? merged.attributes.position.count) / 3;
    batch.geometries.forEach(geometry => geometry.dispose());
  }
  group.updateMatrixWorld(true);
  const bounds = new T.Box3().setFromObject(group);
  const bytes = Buffer.from(await new GLTFExporter().parseAsync(group, { binary: true, onlyVisible: true }));
  await writeFile(new URL(`${id}.glb`, out), bytes);
  models[id] = { file: `${id}.glb`, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), triangles, meshes: batches.size, sourceMeshes, bounds: { min: bounds.min.toArray(), max: bounds.max.toArray() } };
}
await writeFile(new URL('manifest.json', out), `${JSON.stringify({ source: 'Original COLOSSUS procedural geometry; no third-party asset data', generator: 'scripts/generate-colossus-models.mjs', units: 'one cell = one unit', models }, null, 2)}\n`);
console.log(JSON.stringify(Object.fromEntries(Object.entries(models).map(([id, item]) => [id, { bytes: item.bytes, triangles: item.triangles, meshes: item.meshes }]))));
