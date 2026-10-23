// NestQuest 3D viewer (Three.js from a CDN, no build step).
// Builds a house or a multi-family site from the model data the server sends.
// Units are feet. Plan coordinates: x along the street, y from the back of the
// lot (0) to the street (lot depth). In 3D: X = x, Z = y, Y is up.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const GLASS = 0x9fb8c4;
const GRASS = 0xb9c9a2;
const ASPHALT = 0x6f6b66;
const CONCRETE = 0xd8d3ca;

function mat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.02, ...opts });
}

function box(w, h, d, material, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

// ---------------------------------------------------------------- roofs
function geomFromTris(tris) {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(tris.flat(2), 3));
  g.computeVertexNormals();
  return g;
}

function gableRoof(w, d, rise, material) {
  // ridge runs along X (parallel to the street)
  const a = [-w / 2, 0, -d / 2], b = [w / 2, 0, -d / 2], c = [w / 2, 0, d / 2], e = [-w / 2, 0, d / 2];
  const r1 = [-w / 2, rise, 0], r2 = [w / 2, rise, 0];
  const g = geomFromTris([
    [e, c, r2], [e, r2, r1],      // front slope
    [b, a, r1], [b, r1, r2],      // back slope
    [a, e, r1], [c, b, r2],       // gable ends
  ]);
  const m = new THREE.Mesh(g, material);
  m.castShadow = true;
  return m;
}

function hipRoof(w, d, rise, material) {
  const inset = Math.min(d / 2, w / 2);
  const a = [-w / 2, 0, -d / 2], b = [w / 2, 0, -d / 2], c = [w / 2, 0, d / 2], e = [-w / 2, 0, d / 2];
  const r1 = [-w / 2 + inset, rise, 0], r2 = [w / 2 - inset, rise, 0];
  const g = geomFromTris([
    [e, c, r2], [e, r2, r1],
    [b, a, r1], [b, r1, r2],
    [a, e, r1], [c, b, r2],
  ]);
  const m = new THREE.Mesh(g, material);
  m.castShadow = true;
  return m;
}

function roofFor(type, w, d, material) {
  const o = 1.5; // overhang
  if (type === "flat") {
    const grp = new THREE.Group();
    grp.add(box(w + o, 1, d + o, material, 0, 0.5, 0));
    return grp;
  }
  if (type === "hip") return hipRoof(w + o * 2, d + o * 2, Math.min(w, d) * 0.28, material);
  if (type === "low_gable") return gableRoof(w + o * 2, d + o * 2, d * 0.22, material);
  return gableRoof(w + o * 2, d + o * 2, d * 0.42, material);
}

// ---------------------------------------------------------------- windows
function addWindows(group, x0, z0, w, d, levels, colors, opts = {}) {
  const glass = mat(GLASS, { roughness: 0.2, metalness: 0.3 });
  const trim = mat(colors.trim);
  const wide = opts.modern ? 6 : 3.5;
  for (let s = 0; s < levels.length; s++) {
    const y = levels[s].y0 + levels[s].h * 0.55;
    // front (street) and back faces
    const n = Math.max(Math.floor(w / 9), 2);
    for (let i = 0; i < n; i++) {
      const x = x0 + (i + 0.5) * (w / n);
      if (s === 0 && opts.door && Math.abs(x - (x0 + w / 2)) < w / n / 2) continue;
      for (const z of [z0 + d + 0.15, z0 - 0.15]) {
        group.add(box(wide, 4.5, 0.3, glass, x, y, z));
        group.add(box(wide + 0.6, 0.4, 0.5, trim, x, y - 2.4, z));
      }
    }
    // side faces
    const m = Math.max(Math.floor(d / 12), 1);
    for (let i = 0; i < m; i++) {
      const z = z0 + (i + 0.5) * (d / m);
      for (const x of [x0 - 0.15, x0 + w + 0.15]) group.add(box(0.3, 4.5, 3.5, glass, x, y, z));
    }
  }
}

// ---------------------------------------------------------------- text labels
function label(text, sub) {
  const c = document.createElement("canvas");
  c.width = 512; c.height = 160;
  const g = c.getContext("2d");
  g.fillStyle = "rgba(255,253,249,.92)";
  g.beginPath(); g.roundRect(6, 20, 500, 120, 28); g.fill();
  g.fillStyle = "#3B342C"; g.textAlign = "center";
  g.font = "600 54px Inter, sans-serif"; g.fillText(text.slice(0, 18), 256, 80);
  if (sub) { g.font = "400 40px Inter, sans-serif"; g.fillStyle = "#7A6F63"; g.fillText(sub, 256, 126); }
  // Constant on-screen size, so labels stay readable (and small) at any zoom
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, sizeAttenuation: false }));
  s.scale.set(0.15, 0.047, 1);
  s.renderOrder = 10;
  return s;
}

// ---------------------------------------------------------------- scenery
function addLot(scene, lot) {
  const grass = new THREE.Mesh(new THREE.PlaneGeometry(lot.w + 160, lot.d + 160), mat(0xcfd8bf));
  grass.rotation.x = -Math.PI / 2; grass.position.set(lot.w / 2, -0.05, lot.d / 2); grass.receiveShadow = true;
  scene.add(grass);
  const yard = new THREE.Mesh(new THREE.PlaneGeometry(lot.w, lot.d), mat(GRASS));
  yard.rotation.x = -Math.PI / 2; yard.position.set(lot.w / 2, 0, lot.d / 2); yard.receiveShadow = true;
  scene.add(yard);
  // street + sidewalk
  scene.add(box(lot.w + 160, 0.2, 26, mat(ASPHALT), lot.w / 2, 0, lot.d + 19));
  scene.add(box(lot.w + 160, 0.3, 5, mat(CONCRETE), lot.w / 2, 0.05, lot.d + 3.5));
  // lot line
  const pts = [[0, 0], [lot.w, 0], [lot.w, lot.d], [0, lot.d], [0, 0]].map(([x, z]) => new THREE.Vector3(x, 0.15, z));
  scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x7d8f69 })));
  // setbacks (dashed)
  if (lot.setbacks) {
    const sb = lot.setbacks;
    const q = [[sb.side, sb.rear], [lot.w - sb.side, sb.rear], [lot.w - sb.side, lot.d - sb.front], [sb.side, lot.d - sb.front], [sb.side, sb.rear]]
      .map(([x, z]) => new THREE.Vector3(x, 0.2, z));
    const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(q), new THREE.LineDashedMaterial({ color: 0xb08968, dashSize: 3, gapSize: 2 }));
    l.computeLineDistances();
    scene.add(l);
  }
}

function tree(x, z, s = 1) {
  const g = new THREE.Group();
  g.add(box(1.2 * s, 6 * s, 1.2 * s, mat(0x7a5c43), 0, 3 * s, 0));
  const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(6 * s, 0), mat(0x7d8f69, { flatShading: true }));
  crown.position.y = 11 * s; crown.castShadow = true;
  g.add(crown);
  g.position.set(x, 0, z);
  return g;
}

function addTrees(scene, lot, avoid) {
  const spots = [[0.12, 0.1], [0.88, 0.14], [0.08, 0.55], [0.92, 0.6], [0.15, 0.93], [0.85, 0.95], [0.5, 0.06]];
  spots.forEach(([fx, fz], i) => {
    const x = fx * lot.w, z = fz * lot.d;
    const blocked = avoid.some((r) => x > r.x - 8 && x < r.x + r.w + 8 && z > r.y - 8 && z < r.y + r.h + 8);
    if (!blocked) scene.add(tree(x, z, 0.8 + (i % 3) * 0.15));
  });
}

// ---------------------------------------------------------------- interiors
const FLOOR_COLOR = { hardwood: 0x9a6b43, engineered_wood: 0xb58d64, lvp: 0xc2b29c, tile: 0xd9d4cc, carpet_bedrooms: 0xb58d64 };
const WALL_COLOR = { warm_neutral: 0xf4ede3, cool_gray: 0xe3e6e9, bold_dark: 0x6a6f76, natural_earthy: 0xe6d9c2 };
const SOFT_COLOR = { warm_neutral: 0xd8c8b0, cool_gray: 0x98a2ad, bold_dark: 0x2f3a45, natural_earthy: 0x8c9a7e };
const ACCENT_COLOR = { warm_neutral: 0xc98b5e, cool_gray: 0x5f7a8c, bold_dark: 0xb5893c, natural_earthy: 0xa86f4c };
const CABINET = { white_shaker: [0xf4f2ed, 0xf4f2ed], modern_flat: [0x3e3a36, 0x3e3a36], two_tone: [0x34495e, 0xf4f2ed], natural_wood: [0xa47e5c, 0xa47e5c] };
const COUNTER = { quartz: 0xf1efea, granite: 0x6d6862, marble: 0xf8f7f5, butcher_block: 0xc19a6b };
const TILE_ROOMS = new Set(["bathroom", "laundry", "mudroom", "pantry"]);
const BED_ROOMS = new Set(["bedroom", "primary_bedroom"]);
const OPEN_ROOMS = new Set(["kitchen", "living", "family", "dining"]);

// Furniture for one room. (x, z) is the room's corner, w along X, d along Z, y the floor level.
function furnish(g, r, y, I) {
  const M = (c, o) => mat(c, o);
  const soft = M(SOFT_COLOR[I.palette] ?? 0xd8c8b0), accent = M(ACCENT_COLOR[I.palette] ?? 0xc98b5e);
  const wood = M(0x8a6a4f), white = M(0xf7f5f0), dark = M(0x3b3733), steel = M(0xb8bcc0, { metalness: 0.5, roughness: 0.35 });
  const x = r.x, z = r.y, w = r.w, d = r.h, cx = x + w / 2, cz = z + d / 2;
  const fit = (v, max) => Math.min(v, max);
  const add = (bw, bh, bd, m, px, py, pz) => g.add(box(bw, bh, bd, m, px, y + py, pz));
  const rug = (rw, rd, px, pz, m) => add(rw, 0.08, rd, m, px, 0.55, pz);
  switch (r.kind) {
    case "primary_bedroom":
    case "bedroom": {
      const bw = fit(r.kind === "primary_bedroom" ? 6.5 : 5, w - 2), bl = fit(6.8, d - 3);
      rug(bw + 3, bl * 0.8, cx, z + 1 + bl * 0.55, accent);
      add(bw, 1.7, bl, white, cx, 1.3, z + 0.6 + bl / 2);            // mattress
      add(bw, 1, bl, soft, cx, 0.8, z + 0.6 + bl / 2);                // base
      add(bw + 0.4, 3.6, 0.4, wood, cx, 2.3, z + 0.5);                // headboard
      add(bw * 0.9, 0.5, bl * 0.35, soft, cx, 2.25, z + 0.6 + bl * 0.75); // throw
      if (w > bw + 4) for (const s of [-1, 1]) add(1.5, 2, 1.5, wood, cx + s * (bw / 2 + 1.2), 1.5, z + 1.3);
      break;
    }
    case "living":
    case "family":
    case "flex":
    case "bonus": {
      const sw = fit(8, w - 2), sd = 3;
      rug(fit(w - 3, 11), fit(d - 4, 8), cx, cz, accent);
      add(sw, 1.4, sd, soft, cx, 1.2, z + 0.8 + sd / 2);                // seat
      add(sw, 2, 0.8, soft, cx, 2, z + 0.9);                             // back
      for (const s of [-1, 1]) add(0.8, 2, sd, soft, cx + s * (sw / 2 - 0.4), 1.5, z + 0.8 + sd / 2);
      add(4, 1.3, 2.2, wood, cx, 1.1, cz + 0.5);                         // coffee table
      if (d > 12) add(fit(6, w - 2), 1.8, 1.4, dark, cx, 1.4, z + d - 1.2); // media console
      break;
    }
    case "dining": {
      const tw = fit(7, w - 4), td = fit(3.5, d - 4);
      add(tw, 0.25, td, wood, cx, 2.9, cz);
      for (const s of [-1, 1]) for (const t of [-1, 1]) add(0.3, 2.8, 0.3, wood, cx + s * (tw / 2 - 0.4), 1.9, cz + t * (td / 2 - 0.4));
      const n = Math.max(Math.floor(tw / 2.4), 1);
      for (let i = 0; i < n; i++) for (const t of [-1, 1]) {
        const px = cx - tw / 2 + (i + 0.5) * (tw / n);
        add(1.5, 1.6, 1.5, soft, px, 1.3, cz + t * (td / 2 + 1));
      }
      add(3, 0.3, 3, accent, cx, 7.5, cz); // pendant
      break;
    }
    case "kitchen":
    case "spice_kitchen":
    case "kitchenette": {
      const [base, upper] = CABINET[I.kitchen_style] ?? CABINET.white_shaker;
      const top = M(COUNTER[I.countertops] ?? COUNTER.quartz, { roughness: 0.4 });
      const run = w - 1;
      add(run, 3, 2.1, M(base), cx, 2, z + 1.55);                       // base cabinets on the back wall
      add(run, 0.15, 2.3, top, cx, 3.6, z + 1.55);                        // counter
      add(run, 2.6, 1.2, M(upper), cx, 6.3, z + 1.1);                     // uppers
      if (r.kind === "kitchen") {
        const pro = I.appliances === "professional";
        add(pro ? 3.6 : 3, 6.8, 2.3, pro ? steel : M(0xe8e8e8), x + 2.3, 3.9, z + 1.65);   // fridge
        add(pro ? 3 : 2.5, 0.2, 2, dark, cx + run * 0.18, 3.75, z + 1.55);                 // cooktop
        if (d > 3) add(2, 3, 1.6, M(base), x + 1.5, 2, z + 4.5);                           // side run
        if (w > 11 && d > 11) {                                                             // island
          const iw = fit(8, w - 7), idp = fit(3.5, d - 8);
          add(iw, 3, idp, M(base), cx, 2, cz + 1.5);
          add(iw + 0.6, 0.15, idp + 0.6, top, cx, 3.6, cz + 1.5);
          for (let i = -1; i <= 1; i++) add(1.2, 2.4, 1.2, soft, cx + i * (iw / 3), 1.7, cz + 1.5 + idp / 2 + 1.1);
        }
      }
      break;
    }
    case "bathroom": {
      add(fit(5, w - 1), 2.8, 1.8, M((CABINET[I.kitchen_style] ?? CABINET.white_shaker)[0]), cx, 1.9, z + 1.3);
      add(fit(5.2, w - 0.8), 0.15, 2, M(COUNTER[I.countertops] ?? COUNTER.quartz), cx, 3.35, z + 1.3);
      add(fit(4, w - 2), 2.6, 0.15, M(0xdfe8ec, { roughness: 0.1, metalness: 0.6 }), cx, 5.2, z + 0.45); // mirror
      if (r.area >= 60 && d > 6) add(fit(5.2, w - 1), 1.8, 2.6, white, cx, 1.4, z + d - 1.8);            // tub
      else if (r.area >= 40) add(3, 6.5, 0.1, M(0xcfe0e6, { transparent: true, opacity: 0.5 }), x + w - 1.8, 3.8, z + d - 3);
      add(1.4, 1.6, 2.2, white, x + 1.2, 1.3, z + d - 1.6);                                              // toilet
      break;
    }
    case "office": {
      add(fit(5, w - 2), 0.2, 2.4, wood, cx, 2.9, z + 1.7);
      for (const s of [-1, 1]) add(0.3, 2.6, 2.2, wood, cx + s * (fit(5, w - 2) / 2 - 0.3), 1.8, z + 1.7);
      add(1.8, 1.4, 1.8, dark, cx, 1.5, z + 3.8);
      add(1.4, 6.5, fit(5, d - 1), wood, x + w - 1, 3.75, cz);          // bookshelf
      add(2.4, 1.6, 0.2, dark, cx, 4.2, z + 1.1);                        // monitor
      break;
    }
    case "gym":
      rug(fit(w - 2, 10), fit(d - 2, 8), cx, cz, M(0x3b3f45));
      add(2, 4.5, 4, dark, x + 2, 2.75, cz); add(5, 0.4, 0.4, steel, cx, 3, z + 1.5);
      break;
    case "theater": {
      add(fit(w - 2, 12), 5, 0.2, M(0x111111), cx, 4.5, z + 0.4);
      for (let row = 0; row < 2; row++) {
        const n = Math.max(Math.floor((w - 2) / 3), 1);
        for (let i = 0; i < n; i++) add(2.6, 2.6, 2.8, M(0x5a2d2d), x + 1 + (i + 0.5) * ((w - 2) / n), 1.8 + row * 0.8, z + d - 3 - row * 4);
      }
      break;
    }
    case "game":
      add(fit(8, w - 3), 0.5, fit(4.5, d - 3), M(0x2f6b45), cx, 2.8, cz);
      add(fit(8, w - 3) - 1, 2.5, fit(4.5, d - 3) - 1, wood, cx, 1.5, cz);
      break;
    case "prayer":
      rug(fit(w - 2, 7), fit(d - 2, 5), cx, cz, accent);
      add(fit(3, w - 1), 2.6, 1.2, wood, cx, 1.8, z + 0.9);
      add(0.5, 0.8, 0.5, M(0xd9a441, { emissive: 0x5a3a00 }), cx, 3.5, z + 0.9);
      break;
    case "laundry":
      for (const s of [-1, 1]) add(2.3, 3.2, 2.3, white, cx + s * 1.3, 2.1, z + 1.6);
      break;
    case "pantry":
      add(w - 1, 6.5, 1.3, wood, cx, 3.75, z + 1); if (d > 4) add(1.3, 6.5, d - 3, wood, x + 1, 3.75, cz + 0.5);
      break;
    case "mudroom":
      add(fit(4, w - 1), 1.6, 1.5, wood, cx, 1.3, z + 1.2); add(fit(4, w - 1), 0.3, 0.3, dark, cx, 5.5, z + 0.5);
      break;
  }
}

// ---------------------------------------------------------------- house
function storyLevels(model) {
  const first = model.first_story_height || model.story_height, H = model.story_height, out = [];
  let y = 1;
  for (let s = 0; s < model.stories; s++) { const h = s === 0 ? first : H; out.push({ y0: y, h }); y += h; }
  return out;
}

function buildHouse(model, mode, floorSel) {
  const root = new THREE.Group();
  const C = model.colors, h = model.house, I = model.interior || {};
  const levels = storyLevels(model), top = levels[levels.length - 1].y0 + levels[levels.length - 1].h;
  const wallM = mat(C.wall), trimM = mat(C.trim), roofM = mat(C.trim, { roughness: 0.7 });
  const lot = model.lot;
  const bldg = new THREE.Group();
  bldg.position.set(lot.place_x, 0, lot.place_y);
  root.add(bldg);

  bldg.add(box(h.w + 0.6, 1, h.h + 0.6, mat(0xb9b1a4), h.x + h.w / 2, 0.5, h.y + h.h / 2));  // foundation

  const shown = mode === "dollhouse" ? floorSel : model.stories;
  levels.forEach(({ y0, h: sh }, s) => {
    if (s + 1 > shown) return;
    const isCut = mode === "dollhouse" && s + 1 === floorSel;
    if (!isCut) {
      bldg.add(box(h.w, sh, h.h, wallM, h.x + h.w / 2, y0 + sh / 2, h.y + h.h / 2));
      bldg.add(box(h.w + 0.4, 0.5, h.h + 0.4, trimM, h.x + h.w / 2, y0 + sh, h.y + h.h / 2));
      return;
    }
    // Open-top floor: finished floors, walls in the chosen palette, furniture, labels
    const rooms = model.floors[String(s + 1)] || [];
    const wallC = WALL_COLOR[I.palette] ?? WALL_COLOR.warm_neutral;
    const inner = mat(wallC);
    const floorWood = FLOOR_COLOR[I.flooring] ?? FLOOR_COLOR.engineered_wood;
    bldg.add(box(h.w, 0.4, h.h, mat(0xe9e2d6), h.x + h.w / 2, y0 + 0.2, h.y + h.h / 2));
    const wallH = Math.min(sh - 1.5, 8);
    for (const r of rooms) {
      let fc = TILE_ROOMS.has(r.kind) ? FLOOR_COLOR.tile : floorWood;
      if (I.flooring === "carpet_bedrooms" && BED_ROOMS.has(r.kind)) fc = 0xcbbfae;
      if (r.kind === "theater") fc = 0x4a3a3a;
      const fl = box(r.w - 0.35, 0.15, r.h - 0.35, mat(fc, { roughness: 0.6 }), r.x + r.w / 2, y0 + 0.47, r.y + r.h / 2);
      fl.castShadow = false;
      bldg.add(fl);
      // Partition walls: open layouts drop the walls between kitchen, dining and living spaces
      const openRoom = OPEN_ROOMS.has(r.kind);
      const ph = openRoom && I.layout === "open" ? 0.6 : openRoom && I.layout === "semi_open" ? 3.5 : wallH;
      const t = 0.35;
      bldg.add(box(r.w, ph, t, inner, r.x + r.w / 2, y0 + ph / 2, r.y));
      bldg.add(box(r.w, ph, t, inner, r.x + r.w / 2, y0 + ph / 2, r.y + r.h));
      bldg.add(box(t, ph, r.h, inner, r.x, y0 + ph / 2, r.y + r.h / 2));
      bldg.add(box(t, ph, r.h, inner, r.x + r.w, y0 + ph / 2, r.y + r.h / 2));
      furnish(bldg, r, y0, I);
      if (r.w * r.h > 45) {
        const l = label(r.name, `${r.area} sq ft`);
        l.position.set(r.x + r.w / 2, y0 + wallH + 3, r.y + r.h / 2);
        bldg.add(l);
      }
    }
    const t = 0.8;
    for (const [bw, bd, px, pz] of [[h.w, t, h.x + h.w / 2, h.y], [h.w, t, h.x + h.w / 2, h.y + h.h], [t, h.h, h.x, h.y + h.h / 2], [t, h.h, h.x + h.w, h.y + h.h / 2]])
      bldg.add(box(bw, wallH, bd, wallM, px, y0 + wallH / 2, pz));
  });

  if (mode !== "dollhouse") {
    addWindows(bldg, h.x, h.y, h.w, h.h, levels, C, { door: true, modern: model.style === "modern" });
    bldg.add(box(3.6, 7.2, 0.4, mat(C.accent), h.x + h.w / 2, 1 + 3.6, h.y + h.h + 0.2));   // front door
    const roof = roofFor(model.roof, h.w, h.h, roofM);
    roof.position.set(h.x + h.w / 2, top, h.y + h.h / 2);
    bldg.add(roof);
    if (model.features.includes("solar_panels")) {
      const pm = mat(0x2f3e4e, { roughness: 0.3, metalness: 0.4 });
      const rise = model.roof === "flat" ? 0 : model.roof === "low_gable" ? h.h * 0.22 : model.roof === "hip" ? Math.min(h.w, h.h) * 0.28 : h.h * 0.42;
      const ang = Math.atan2(rise, h.h / 2 + 1.5);
      const p = box(h.w * 0.45, 0.25, (h.h / 2) * 0.6 / Math.cos(ang || 0.0001), pm, 0, 0, 0);
      p.rotation.x = ang;
      p.position.set(h.x + h.w * 0.62, top + rise * 0.45 + 0.6, h.y + h.h * 0.72);
      bldg.add(p);
    }
    if (model.features.includes("elevator")) bldg.add(box(6, top + 3 - 1, 6, mat(C.wall), h.x + h.w - 3, (top + 2) / 2, h.y + 3));
  }

  // porches, decks, patio, pool, outdoor kitchen
  const F = new Set(model.features);
  if (F.has("covered_porch")) {
    const pw = h.w * 0.6, pd = 7, px = h.x + h.w / 2, pz = h.y + h.h + pd / 2;
    bldg.add(box(pw, 0.8, pd, mat(0xc9b79c), px, 0.4, pz));
    if (mode !== "dollhouse" || floorSel > 1) {
      bldg.add(box(pw + 1, 0.6, pd + 1, trimM, px, 9.5, pz));
      for (const fx of [-0.47, 0.47]) bldg.add(box(0.6, 9, 0.6, mat(0xfaf7f2), px + fx * pw, 4.8, h.y + h.h + pd - 0.5));
    }
  }
  if (F.has("deck")) bldg.add(box(Math.min(h.w * 0.6, 24), 2, 12, mat(0xa47e5c), h.x + h.w * 0.35, 1, h.y - 6));
  if (F.has("screened_porch")) {
    const sx = h.x + h.w * 0.78, sz = h.y - 7;
    bldg.add(box(14, 0.8, 14, mat(0xa47e5c), sx, 0.4, sz));
    if (mode !== "dollhouse") {
      bldg.add(box(14, 8, 14, mat(0xcfd8dc, { transparent: true, opacity: 0.35 }), sx, 4.8, sz));
      bldg.add(box(15, 0.6, 15, roofM, sx, 9, sz));
    }
  }
  if (F.has("patio")) bldg.add(box(18, 0.3, 14, mat(0xc7bfb2), h.x + h.w * 0.3, 0.15, h.y - 20));
  if (F.has("pool")) {
    bldg.add(box(34, 0.4, 20, mat(0xe7e1d6), h.x + h.w / 2, 0.2, h.y - 34));
    bldg.add(box(30, 0.5, 15, mat(0x6fb3c9, { roughness: 0.15, metalness: 0.1 }), h.x + h.w / 2, 0.3, h.y - 34));
  }
  if (F.has("outdoor_kitchen")) bldg.add(box(9, 3, 2.5, mat(0x8e8478), h.x + h.w * 0.15, 1.5, h.y - 14));
  if (F.has("fenced_yard")) {
    const fz0 = -lot.place_y + (lot.setbacks?.rear ?? 0) * 0.3, fm = mat(0xf1ece3);
    bldg.add(box(lot.w * 0.9, 4, 0.3, fm, lot.w / 2 - lot.place_x, 2, fz0));
  }

  // garage + driveway
  const g = model.garage;
  if (g) {
    const gh = 11;
    bldg.add(box(g.w, gh, g.h, wallM, g.x + g.w / 2, gh / 2, g.y + g.h / 2));
    bldg.add(box(g.w * 0.8, gh * 0.72, 0.3, mat(0xe3ded5), g.x + g.w / 2, gh * 0.36, g.y + g.h + 0.15));
    if (mode !== "dollhouse") {
      const gr = model.roof === "flat" ? roofFor("flat", g.w, g.h, roofM) : hipRoof(g.w + 2, g.h + 2, Math.min(g.w, g.h) * 0.22, roofM);
      gr.position.set(g.x + g.w / 2, gh, g.y + g.h / 2);
      bldg.add(gr);
    }
    const drive = lot.d - (lot.place_y + g.y + g.h);
    if (drive > 0) bldg.add(box(g.w * 0.85, 0.2, drive, mat(CONCRETE), g.x + g.w / 2, 0.1, g.y + g.h + drive / 2));
  } else {
    const walk = lot.d - (lot.place_y + h.y + h.h);
    if (walk > 0) bldg.add(box(4, 0.2, walk, mat(CONCRETE), h.x + h.w / 2, 0.1, h.y + h.h + walk / 2));
  }

  const footprint = [{ x: lot.place_x + Math.min(h.x, g ? g.x : h.x), y: lot.place_y - (F.has("pool") ? 45 : 0), w: h.w + (g ? g.w : 0), h: h.h + (g ? g.h : 0) + (F.has("pool") ? 45 : 0) }];
  if (lot.existing) footprint.push(lot.existing);
  return { root, footprint, height: top + 12, center: [lot.place_x + (h.x + h.w / 2), lot.place_y + h.y + h.h / 2] };
}

// An existing building that stays on the lot, drawn in muted tones
function addExisting(scene, ex) {
  if (!ex) return;
  const m = mat(0xd3ccc1), r = mat(0x8e857a);
  const grp = new THREE.Group();
  grp.add(box(ex.w, 11, ex.h, m, ex.x + ex.w / 2, 5.5, ex.y + ex.h / 2));
  const roof = gableRoof(ex.w + 2, ex.h + 2, ex.h * 0.3, r);
  roof.position.set(ex.x + ex.w / 2, 11, ex.y + ex.h / 2);
  grp.add(roof);
  const l = label("Existing building", "stays");
  l.position.set(ex.x + ex.w / 2, 11 + ex.h * 0.3 + 5, ex.y + ex.h / 2);
  grp.add(l);
  grp.userData.scenery = true;
  scene.add(grp);
}

// ---------------------------------------------------------------- multi-family site
function buildSite(model) {
  const root = new THREE.Group();
  const C = model.colors, H = model.story_height;
  const wallM = mat(C.wall), trimM = mat(C.trim), roofM = mat(C.trim, { roughness: 0.7 });
  const avoid = [];
  for (const b of model.buildings) {
    root.add(box(b.w, 1, b.h, mat(0xb9b1a4), b.x + b.w / 2, 0.5, b.y + b.h / 2));
    for (let s = 0; s < b.stories; s++) {
      const y0 = 1 + s * H;
      root.add(box(b.w, H, b.h, wallM, b.x + b.w / 2, y0 + H / 2, b.y + b.h / 2));
      root.add(box(b.w + 0.4, 0.5, b.h + 0.4, trimM, b.x + b.w / 2, y0 + H, b.y + b.h / 2));
    }
    addWindows(root, b.x, b.y, b.w, b.h, Array.from({ length: b.stories }, (_, i) => ({ y0: 1 + i * H, h: H })), C, { modern: model.style === "modern" });
    // entries along the street face, one per entry; townhome rows get party-wall lines
    const n = Math.max(b.entries || 1, 1);
    for (let i = 1; i < n; i++) {
      const x = b.x + i * (b.w / n);
      root.add(box(0.5, b.stories * H + 1, 0.6, trimM, x, 1 + (b.stories * H) / 2, b.y + b.h + 0.2));
      root.add(box(0.5, b.stories * H + 1, 0.6, trimM, x, 1 + (b.stories * H) / 2, b.y - 0.2));
    }
    for (let i = 0; i < n; i++) root.add(box(3.6, 7.2, 0.4, mat(C.accent), b.x + (i + 0.5) * (b.w / n), 4.6, b.y + b.h + 0.2));
    const roof = roofFor(model.roof, b.w, b.h, roofM);
    roof.position.set(b.x + b.w / 2, 1 + b.stories * H, b.y + b.h / 2);
    root.add(roof);
    if (b.label) {
      const l = label(b.label, b.sub || "");
      l.scale.set(0.2, 0.0625, 1);
      l.position.set(b.x + b.w / 2, 1 + b.stories * H + 16, b.y + b.h / 2);
      root.add(l);
    }
    avoid.push(b);
  }
  const p = model.parking;
  if (p && p.w > 0 && p.h > 0) {
    root.add(box(p.w, 0.2, p.h, mat(ASPHALT), p.x + p.w / 2, 0.1, p.y + p.h / 2));
    // stall stripes: rows of 18 ft stalls on both sides of 24 ft aisles (a 60 ft bay)
    const stripe = mat(0xf2efe8);
    const cols = Math.max(Math.floor(p.w / 9), 1);
    for (let bay = 0; bay * 60 + 18 <= p.h; bay++) {
      for (const off of [9, 51]) {
        if (bay * 60 + off + 9 > p.h) continue;
        for (let c = 0; c <= cols; c++) root.add(box(0.3, 0.25, 17, stripe, p.x + c * 9, 0.25, p.y + bay * 60 + off));
      }
    }
    avoid.push(p);
    const drive = model.lot.d - (p.y + p.h);
    if (drive > 0) root.add(box(22, 0.2, drive, mat(ASPHALT), p.x + 12, 0.1, p.y + p.h + drive / 2));
  }
  const maxH = Math.max(...model.buildings.map((b) => b.stories)) * H + 12;
  return { root, footprint: avoid, height: maxH, center: [model.lot.w / 2, model.lot.d / 2] };
}

// ---------------------------------------------------------------- viewer
export function mount(container, model, opts = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.innerHTML = "";
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(opts.background ?? 0xeef2ea);
  scene.fog = new THREE.Fog(scene.background, 400, 900);
  scene.add(new THREE.HemisphereLight(0xfffaf0, 0xb9c4a8, 1.1));
  const sun = new THREE.DirectionalLight(0xfff3e0, 2.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  scene.add(sun);
  scene.add(sun.target);

  const camera = new THREE.PerspectiveCamera(40, 1, 1, 3000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.47;
  controls.autoRotate = !!opts.autoRotate;
  controls.autoRotateSpeed = 0.8;

  let content = null, mode = "exterior", floor = 1, first = true;
  function build() {
    if (content) { scene.remove(content.root); content.root.traverse((o) => { o.geometry?.dispose(); o.material?.map?.dispose?.(); }); }
    scene.children.filter((o) => o.userData.scenery).forEach((o) => scene.remove(o));
    const sceneryStart = scene.children.length;
    addLot(scene, model.lot);
    content = model.kind === "site" ? buildSite(model) : buildHouse(model, mode, floor);
    addExisting(scene, model.lot.existing);
    addTrees(scene, model.lot, content.footprint);
    scene.children.slice(sceneryStart).forEach((o) => (o.userData.scenery = true));
    scene.add(content.root);

    const [cx, cz] = content.center;
    const span = Math.max(model.lot.w, model.lot.d, 60);
    sun.position.set(cx - span * 0.6, span * 1.1, cz + span * 0.9);
    sun.target.position.set(cx, 0, cz);
    const sc = sun.shadow.camera;
    sc.left = sc.bottom = -span; sc.right = sc.top = span; sc.far = span * 4; sc.updateProjectionMatrix();
    if (first) {
      const dist = model.kind === "site" ? span * 1.05 : Math.max(span * 0.75, 70);
      if (model.kind === "site") camera.position.set(cx - dist * 0.3, dist * 0.75, cz + dist * 0.85);
      else camera.position.set(cx - dist * 0.55, dist * 0.55, cz + dist * 0.85);
      controls.target.set(cx, content.height * 0.3, cz);
      first = false;
    }
    if (mode === "dollhouse") {
      controls.target.set(cx, (floor - 1) * model.story_height, cz);
    }
  }
  build();

  function resize() {
    const w = container.clientWidth || 600, h = container.clientHeight || 400;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();

  let raf = 0, alive = true;
  (function loop() {
    if (!alive) return;
    controls.update();
    renderer.render(scene, camera);
    raf = requestAnimationFrame(loop);
  })();
  renderer.domElement.addEventListener("pointerdown", () => (controls.autoRotate = false));

  return {
    setMode(m, f) {
      mode = m; floor = f || 1;
      if (m === "dollhouse") {
        // look down into the open floor
        const [cx, cz] = content.center;
        const span = Math.max(model.house?.w || 40, model.house?.h || 40);
        camera.position.set(cx - span * 0.4, (floor - 1) * model.story_height + span * 1.5, cz + span * 1.1);
      }
      build();
    },
    update(newModel) { model = newModel; build(); },
    snapshot() { renderer.render(scene, camera); return renderer.domElement.toDataURL("image/png"); },
    dispose() { alive = false; cancelAnimationFrame(raf); ro.disconnect(); controls.dispose(); renderer.dispose(); container.innerHTML = ""; },
  };
}

window.NQ3D = { mount };
window.dispatchEvent(new Event("nq3d-ready"));
