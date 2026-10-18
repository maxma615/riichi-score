import { createScopedThreejs } from "./vendor/native-three.cjs";
import { table3dLayout, TABLE } from "./table3d-layout";
import rounded from "./native-tile-geometry.json";

export function pointInPolygon(p, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i],
      b = polygon[j];
    if (
      a.y > p.y !== b.y > p.y &&
      p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x
    )
      inside = !inside;
  }
  return inside;
}
export function nativeQuality(width, height, dpr) {
  return {
    dpr: Math.min(
      1.25,
      Math.max(1, dpr || 1),
      Math.sqrt(900000 / Math.max(1, width * height)),
    ),
    shadowSize: 512,
  };
}
export function nativePieceNode(p) {
  if (p.kind === "river") return `river-${p.seat}-${p.index}`;
  if (p.kind === "nuki") return `north-${p.seat}-${p.index}`;
  return null;
}
const names = {
  z1: "Ton",
  z2: "Nan",
  z3: "Shaa",
  z4: "Pei",
  z5: "Haku",
  z6: "Hatsu",
  z7: "Chun",
};
const file = (value) =>
  names[value.slice(0, 2)] ||
  { m: "Man", p: "Pin", s: "Sou" }[value[0]] +
    (value[1] === "0" ? "5-Dora" : value[1]);
function convex(points) {
  const a = points.slice().sort((p, q) => p.x - q.x || p.y - q.y),
    cross = (o, p, q) => (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x),
    lo = [],
    hi = [];
  for (const p of a) {
    while (lo.length > 1 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0)
      lo.pop();
    lo.push(p);
  }
  for (const p of a.reverse()) {
    while (hi.length > 1 && cross(hi[hi.length - 2], hi[hi.length - 1], p) <= 0)
      hi.pop();
    hi.push(p);
  }
  return lo.slice(0, -1).concat(hi.slice(0, -1));
}
export function scopedThree(canvas, factory = createScopedThreejs) {
  const eventNames = [
    "addEventListener",
    "removeEventListener",
    "dispatchEvent",
    "dispatchTouchEvent",
  ];
  const nativeEvents = new Map(
    eventNames
      .filter((name) => typeof canvas[name] === "function")
      .map((name) => [name, canvas[name]]),
  );
  const targets = [
    ...new Set([Object.prototype, canvas.constructor.prototype]),
  ];
  const snapshots = targets.map((target) => [
    target,
    Object.getOwnPropertyDescriptors(target),
  ]);
  try {
    const result = factory(canvas);
    for (const name of [
      "addEventListener",
      "removeEventListener",
      "dispatchEvent",
      "dispatchTouchEvent",
    ])
      if (typeof canvas[name] === "function")
        Object.defineProperty(canvas, name, {
          value: (nativeEvents.get(name) || canvas[name]).bind(canvas),
          configurable: true,
          writable: true,
        });
    return result;
  } finally {
    for (const [target, descriptors] of snapshots) {
      for (const name of Object.getOwnPropertyNames(target))
        if (!Object.prototype.hasOwnProperty.call(descriptors, name))
          delete target[name];
      Object.defineProperties(target, descriptors);
    }
  }
}
/** WebGL1-compatible native backend. The camera/layout/rounded body are shared
 * with the browser; all repeated solids are merged by material, not DOM tiles. */
export class NativeScene {
  constructor(canvas, width, height, dpr = 1, onFailure = () => {}) {
    this.canvas = canvas;
    this.THREE = scopedThree(canvas);
    const T = this.THREE;
    this.scene = new T.Scene();
    this.scene.background = new T.Color(0x101920);
    this.camera = new T.PerspectiveCamera(35, 1, 0.1, 200);
    this.renderer = new T.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: "low-power",
    });
    this.renderer.outputEncoding = T.sRGBEncoding;
    this.renderer.gammaOutput = true;
    this.renderer.gammaFactor = 2.2;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = T.PCFSoftShadowMap;
    // Geometry and the key light are static between table changes. Outline,
    // face-texture and presentation updates must not redraw the depth map.
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.needsUpdate = true;
    this.materials = new Map();
    this.textures = [];
    this.batches = [];
    this.batchByMaterial = new Map();
    this.records = new Map();
    this.projectionCache = new Map();
    this.metrics = {
      geometryAllocations: 0,
      allocatedBytes: 0,
      pieceTransforms: 0,
      batchUpdates: 0,
      projectionBuilds: 0,
      visibilityUpdates: 0,
      shadowUpdates: 0,
      buildMs: 0,
      presentMs: 0,
      presentations: 0,
    };
    this.owned = [];
    this.pieces = [];
    this.projected = [];
    this.frame = 0;
    this.frames = 0;
    this.active = true;
    this.disposed = false;
    this.failed = false;
    this.onFailure = onFailure;
    this.scene.add(new T.HemisphereLight(0xdcecff, 0x6e5540, 0.85));
    const sun = new T.DirectionalLight(0xfff0d0, 1.05);
    sun.position.set(-12, 27, 16);
    sun.castShadow = true;
    sun.shadow.mapSize.set(512, 512);
    Object.assign(sun.shadow.camera, {
      left: -23,
      right: 23,
      top: 21,
      bottom: -21,
      near: 1,
      far: 65,
    });
    sun.shadow.bias = -0.0006;
    this.scene.add(sun);
    this.sun = sun;
    const fill = new T.DirectionalLight(0xc7ddff, 0.35);
    fill.position.set(12, 13, -18);
    this.scene.add(fill);
    this.ivory = new T.MeshStandardMaterial({
      color: 0xfffae9,
      roughness: 0.32,
    });
    this.back = new T.MeshStandardMaterial({
      color: 0xc47d35,
      roughness: 0.34,
      metalness: 0.04,
    });
    this.ivory.color.convertSRGBToLinear();
    this.back.color.convertSRGBToLinear();
    this.owned.push(this.ivory, this.back);
    const rim = new T.MeshStandardMaterial({
      color: 0x48515b,
      roughness: 0.4,
      metalness: 0.28,
    });
    rim.color.convertSRGBToLinear();
    this.owned.push(rim);
    this.box(TABLE.width + 1, 0.7, TABLE.depth + 1, 0, -0.4, 0, rim);
    const felt = new T.MeshStandardMaterial({
      color: 0x17394a,
      roughness: 0.95,
    });
    felt.color.convertSRGBToLinear();
    this.owned.push(felt);
    const weave = new Uint8Array(32 * 32 * 4);
    for (let i = 0; i < 32 * 32; i++) {
      const c = (Math.floor(i / 32) + i) % 2 ? 184 : 208;
      weave.set([c, c, c, 255], i * 4);
    }
    const fabric = new T.DataTexture(weave, 32, 32, T.RGBAFormat);
    fabric.wrapS = fabric.wrapT = T.RepeatWrapping;
    fabric.repeat.set(25, 20);
    fabric.needsUpdate = true;
    this.textures.push(fabric);
    felt.map = fabric;
    felt.bumpMap = fabric;
    felt.bumpScale = 0.035;
    const floor = new T.Mesh(
      new T.PlaneBufferGeometry(TABLE.width, TABLE.depth),
      felt,
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0.005;
    floor.receiveShadow = true;
    this.scene.add(floor);
    this.owned.push(floor.geometry);
    this.box(TABLE.width + 1, 0.3, 0.5, 0, 0.02, -(TABLE.depth + 0.5) / 2, rim);
    this.box(TABLE.width + 1, 0.3, 0.5, 0, 0.02, (TABLE.depth + 0.5) / 2, rim);
    this.box(0.5, 0.3, TABLE.depth, -(TABLE.width + 0.5) / 2, 0.02, 0, rim);
    this.box(0.5, 0.3, TABLE.depth, (TABLE.width + 0.5) / 2, 0.02, 0, rim);
    const consoleMat = new T.MeshStandardMaterial({
      color: 0x213f49,
      roughness: 0.4,
      metalness: 0.12,
    });
    consoleMat.color.convertSRGBToLinear();
    this.owned.push(consoleMat);
    this.box(5, 0.36, 4.9, 0, 0.18, 0, consoleMat);
    const g = new T.BufferGeometry().setFromPoints(
      [
        [-16.9, 0.028, -12.9],
        [16.9, 0.028, -12.9],
        [16.9, 0.028, 12.9],
        [-16.9, 0.028, 12.9],
      ].map((p) => new T.Vector3(...p)),
    );
    const m = new T.LineBasicMaterial({ color: 0xffd489 });
    this.outline = new T.LineLoop(g, m);
    this.outline.visible = false;
    this.scene.add(this.outline);
    this.owned.push(g, m);
    this.loss = (e) => {
      e?.preventDefault?.();
      this.failed = true;
      if (this.frame) this.canvas.cancelAnimationFrame(this.frame);
      this.frame = 0;
      this.onFailure();
    };
    this.restore = () => {
      if (this.disposed) return;
      this.failed = false;
      this.renderer.shadowMap.needsUpdate = true;
      this.requestRender();
    };
    canvas.addEventListener?.("webglcontextlost", this.loss);
    canvas.addEventListener?.("webglcontextrestored", this.restore);
    this.resize(width, height, dpr);
  }
  geometry(source) {
    const T = this.THREE,
      g = new T.BufferGeometry();
    this.metrics.geometryAllocations++;
    for (const key of ["position", "normal", "uv"])
      g.addAttribute(
        key,
        new T.BufferAttribute(
          source[key] instanceof Float32Array
            ? source[key]
            : new Float32Array(source[key]),
          key === "uv" ? 2 : 3,
        ),
      );
    this.metrics.allocatedBytes += Object.values(g.attributes).reduce(
      (sum, a) => sum + a.array.byteLength,
      0,
    );
    return g;
  }
  box(w, h, d, x, y, z, material) {
    const T = this.THREE,
      g = new T.BoxBufferGeometry(w, h, d),
      m = new T.Mesh(g, material);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    this.scene.add(m);
    this.owned.push(g);
    return m;
  }
  face(value) {
    const key = value.slice(0, 2);
    if (this.materials.has(key)) return this.materials.get(key);
    const T = this.THREE;
    const material = new T.MeshStandardMaterial({
      color: 0xffffff,
      transparent: true,
      alphaTest: 0.03,
      roughness: 0.44,
    });
    this.materials.set(key, material);
    const image = this.canvas.createImage(),
      texture = new T.Texture(image);
    texture.encoding = T.sRGBEncoding;
    texture.minFilter = T.LinearFilter;
    texture.generateMipmaps = false;
    material.map = texture;
    this.textures.push(texture);
    image.onload = () => {
      if (this.disposed) return;
      texture.needsUpdate = true;
      this.requestRender();
    };
    image.onerror = () => {};
    image.src = "/assets/tiles/" + file(key) + ".png";
    return material;
  }
  batch(material, source) {
    let batch = this.batchByMaterial.get(material);
    if (batch) return batch;
    const mesh = new this.THREE.Mesh(new this.THREE.BufferGeometry(), material);
    mesh.castShadow = material === this.ivory || material === this.back;
    mesh.receiveShadow = true;
    // The camera already frames the whole table; a stale bounding sphere after
    // incremental writes must never cull newly appended or moved pieces.
    mesh.frustumCulled = false;
    batch = { mesh, source, slots: [], capacity: 0 };
    this.batchByMaterial.set(material, batch);
    this.batches.push(mesh);
    this.scene.add(mesh);
    return batch;
  }
  growBatch(batch) {
    const capacity = Math.max(8, batch.capacity * 2),
      attrs = {};
    for (const key of ["position", "normal", "uv"]) {
      attrs[key] = new Float32Array(batch.source[key].length * capacity);
      if (batch.capacity)
        attrs[key].set(batch.mesh.geometry.attributes[key].array);
    }
    const geometry = this.geometry(attrs);
    for (const attribute of Object.values(geometry.attributes))
      attribute.setDynamic(true);
    batch.mesh.geometry.dispose();
    batch.mesh.geometry = geometry;
    batch.capacity = capacity;
  }
  dirtySlot(batch, slot) {
    for (const key of ["position", "normal", "uv"]) {
      const a = batch.mesh.geometry.attributes[key],
        size = batch.source[key].length;
      const start = slot * size,
        end = start + size,
        range = a.updateRange;
      if (range.count < 0) {
        range.offset = start;
        range.count = size;
      } else {
        const last = Math.max(range.offset + range.count, end);
        range.offset = Math.min(range.offset, start);
        range.count = last - range.offset;
      }
      a.needsUpdate = true;
    }
    this.metrics.batchUpdates++;
  }
  swapSlots(batch, a, b) {
    if (a === b) return;
    for (const key of ["position", "normal", "uv"]) {
      const array = batch.mesh.geometry.attributes[key].array,
        size = batch.source[key].length;
      // Swaps are only needed for one removed/hidden tile, without allocating
      // or retransforming the rest of the merged geometry.
      for (let i = 0; i < size; i++) {
        const x = a * size + i,
          y = b * size + i,
          value = array[x];
        array[x] = array[y];
        array[y] = value;
      }
    }
    const entry = batch.slots[a];
    batch.slots[a] = batch.slots[b];
    batch.slots[b] = entry;
    batch.slots[a].slot = a;
    batch.slots[b].slot = b;
    this.dirtySlot(batch, a);
    this.dirtySlot(batch, b);
  }
  removeEntry(entry) {
    const batch = entry.batch;
    this.swapSlots(batch, entry.slot, batch.slots.length - 1);
    batch.slots.pop();
    batch.mesh.geometry.setDrawRange(
      0,
      (batch.slots.length * batch.source.position.length) / 3,
    );
  }
  writeEntry(entry, matrix, normalMatrix) {
    const batch = entry.batch,
      source = batch.source,
      slot = entry.slot;
    const attrs = batch.mesh.geometry.attributes,
      v = new this.THREE.Vector3();
    for (let i = 0; i < source.position.length; i += 3) {
      v.fromArray(source.position, i).applyMatrix4(matrix);
      const offset = slot * source.position.length + i;
      attrs.position.array[offset] = v.x;
      attrs.position.array[offset + 1] = v.y;
      attrs.position.array[offset + 2] = v.z;
      v.fromArray(source.normal, i).applyMatrix3(normalMatrix).normalize();
      const normalOffset = slot * source.normal.length + i;
      attrs.normal.array[normalOffset] = v.x;
      attrs.normal.array[normalOffset + 1] = v.y;
      attrs.normal.array[normalOffset + 2] = v.z;
    }
    attrs.uv.array.set(source.uv, slot * source.uv.length);
    this.dirtySlot(batch, slot);
  }
  setPieces(pieces) {
    const start = Date.now(),
      T = this.THREE,
      remaining = new Set(this.records.keys());
    let changed = false,
      geometryChanged = false;
    for (const p of pieces) {
      remaining.delete(p.id);
      // Only geometry-affecting values control vertex work. Node/seat metadata
      // can change without rebuilding or uploading the physical table.
      const shape = [p.value || "", ...p.position, ...p.rotation].join(",");
      const projection = [shape, p.kind, p.faceDown, p.nodeId, p.seat].join(
        "|",
      );
      let record = this.records.get(p.id);
      if (record?.shape === shape) {
        if (record.projection !== projection) changed = true;
        record.piece = p;
        record.projection = projection;
        continue;
      }
      changed = geometryChanged = true;
      if (record) for (const entry of record.entries) this.removeEntry(entry);
      record = { piece: p, shape, projection, entries: [] };
      this.records.set(p.id, record);
      const matrix = new T.Matrix4().compose(
        new T.Vector3(...p.position),
        new T.Quaternion().setFromEuler(new T.Euler(...p.rotation)),
        new T.Vector3(1, 1, 1),
      );
      const normalMatrix = new T.Matrix3().getNormalMatrix(matrix);
      const parts = [
        [this.ivory, rounded.body],
        [this.back, rounded.back],
      ];
      if (p.value) parts.push([this.face(p.value), rounded.face]);
      for (const [material, source] of parts) {
        const batch = this.batch(material, source);
        if (batch.slots.length === batch.capacity) this.growBatch(batch);
        const entry = { batch, slot: batch.slots.length, id: p.id };
        batch.slots.push(entry);
        record.entries.push(entry);
        this.writeEntry(entry, matrix, normalMatrix);
      }
      this.metrics.pieceTransforms++;
    }
    for (const id of remaining) {
      for (const entry of this.records.get(id).entries) this.removeEntry(entry);
      this.records.delete(id);
      this.projectionCache.delete(id);
      changed = geometryChanged = true;
    }
    this.pieces = pieces;
    if (!changed) return false;
    if (geometryChanged || this.hidden) {
      this.applyVisibility();
      this.renderer.shadowMap.needsUpdate = true;
    }
    this.projected = this.projections();
    this.metrics.buildMs += Date.now() - start;
    this.requestRender();
    return true;
  }
  applyVisibility() {
    for (const batch of this.batchByMaterial.values()) {
      const hidden = this.hidden
        ? batch.slots.findIndex(
            (e) => this.records.get(e.id)?.piece.nodeId === this.hidden,
          )
        : -1;
      const count = batch.slots.length;
      if (hidden >= 0) this.swapSlots(batch, hidden, count - 1);
      batch.mesh.geometry.setDrawRange(
        0,
        ((count - (hidden >= 0 ? 1 : 0)) * batch.source.position.length) / 3,
      );
    }
  }
  hideTarget(nodeId) {
    const id = nodeId || null;
    if ((this.hidden || null) === id) return;
    this.hidden = id;
    this.applyVisibility();
    this.metrics.visibilityUpdates++;
    this.renderer.shadowMap.needsUpdate = true;
    this.requestRender();
  }
  resize(width, height, dpr = 1) {
    if (!(width > 0 && height > 0)) return;
    const T = this.THREE,
      q = nativeQuality(width, height, dpr);
    const dimensionsChanged = this.width !== width || this.height !== height;
    const same = !dimensionsChanged && this.dpr === q.dpr;
    if (same) return;
    this.width = width;
    this.height = height;
    this.dpr = q.dpr;
    this.renderer.setPixelRatio(q.dpr);
    this.renderer.setSize(width, height, false);
    if (!dimensionsChanged) {
      this.requestRender();
      return;
    }
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    const direction = new T.Vector3(0, 0.68, 0.734).normalize();
    let distance = 40;
    for (let i = 0; i < 30; i++) {
      this.camera.position.copy(direction).multiplyScalar(distance);
      this.camera.lookAt(new T.Vector3());
      this.camera.updateMatrixWorld();
      if (
        ![
          [-17.7, 0, -13.7],
          [17.7, 0, -13.7],
          [-17.7, 0, 13.7],
          [17.7, 0, 13.7],
          [-14, 1.6, -11],
          [14, 1.6, -11],
        ].some((v) => {
          const p = new T.Vector3(...v).project(this.camera);
          return Math.abs(p.x) > 0.97 || Math.abs(p.y) > 0.91;
        })
      )
        break;
      distance *= 1.055;
    }
    this.projectionCache.clear();
    this.felt = null;
    this.projected = this.projections();
    this.requestRender();
  }
  project(p) {
    const v = new this.THREE.Vector3(...p).project(this.camera);
    return {
      x: ((v.x + 1) * this.width) / 2,
      y: ((1 - v.y) * this.height) / 2,
    };
  }
  projections() {
    const T = this.THREE;
    return this.pieces.map((piece) => {
      const signature = this.records.get(piece.id)?.projection;
      const cached = this.projectionCache.get(piece.id);
      if (cached && cached.signature === signature) {
        cached.value.piece = piece;
        return cached.value;
      }
      this.metrics.projectionBuilds++;
      const matrix = new T.Matrix4().compose(
        new T.Vector3(...piece.position),
        new T.Quaternion().setFromEuler(new T.Euler(...piece.rotation)),
        new T.Vector3(1, 1, 1),
      );
      const map = (v) =>
          this.project(new T.Vector3(...v).applyMatrix4(matrix).toArray()),
        back = piece.kind === "concealed" || piece.faceDown,
        z = (back ? -1 : 1) * (0.3 + 0.004);
      const points = [
          [-0.475, 0.675, z],
          [0.475, 0.675, z],
          [0.475, -0.675, z],
          [-0.475, -0.675, z],
        ].map(map),
        xs = points.map((p) => p.x),
        ys = points.map((p) => p.y),
        left = Math.min(...xs),
        top = Math.min(...ys);
      const hull = convex(
        [-1, 1].flatMap((x) =>
          [-1, 1].flatMap((y) =>
            [-1, 1].map((z) => map([x * 0.475, y * 0.675, z * 0.3])),
          ),
        ),
      );
      const value = {
        piece,
        points,
        hull,
        bounds: {
          left,
          top,
          width: Math.max(...xs) - left,
          height: Math.max(...ys) - top,
        },
        angle:
          (Math.atan2(points[1].y - points[0].y, points[1].x - points[0].x) *
            180) /
          Math.PI,
      };
      this.projectionCache.set(piece.id, { signature, value });
      return value;
    });
  }
  feltPolygon() {
    return (
      this.felt ||
      (this.felt = [
        [-17, 0, -13],
        [17, 0, -13],
        [17, 0, 13],
        [-17, 0, 13],
      ].map((p) => this.project(p)))
    );
  }
  setDropTarget(value) {
    if (this.outline.visible === !!value) return;
    this.outline.visible = !!value;
    this.requestRender();
  }
  renderNow() {
    if (this.disposed || !this.active || this.failed) return false;
    if (this.canRender && !this.canRender()) {
      this.suspend();
      return false;
    }
    if (this.renderer.getContext().isContextLost()) {
      this.loss();
      return false;
    }
    if (!this.dirty) return true;
    if (this.frame) this.canvas.cancelAnimationFrame(this.frame);
    this.frame = 0;
    try {
      if (this.renderer.getContext().isContextLost()) {
        this.loss();
        return false;
      }
      const start = Date.now();
      if (this.renderer.shadowMap.needsUpdate) this.metrics.shadowUpdates++;
      this.renderer.render(this.scene, this.camera);
      if (this.renderer.getContext().isContextLost()) {
        this.loss();
        return false;
      }
      this.dirty = false;
      this.frames++;
      this.stats = {
        ...this.metrics,
        frames: this.frames,
        drawCalls: this.renderer.info.render.calls,
        triangles: this.renderer.info.render.triangles,
        drawMs: Date.now() - start,
        dpr: this.dpr,
        effectiveDpr: this.dpr,
        qualityReason: this.qualityReason || null,
        width: this.canvas.width,
        height: this.canvas.height,
      };
      this.onRendered?.();
      return true;
    } catch (e) {
      this.error = String(e?.message || e);
      this.loss();
      return false;
    }
  }
  requestRender() {
    this.dirty = true;
    if (this.disposed || !this.active || this.failed || this.frame) return;
    this.frame = this.canvas.requestAnimationFrame(() => {
      this.frame = 0;
      this.renderNow();
    });
  }
  suspend() {
    this.active = false;
    if (this.frame) this.canvas.cancelAnimationFrame(this.frame);
    this.frame = 0;
  }
  resume() {
    if (this.disposed || this.failed || this.active) return;
    this.active = true;
    this.requestRender();
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.suspend();
    this.canvas.removeEventListener?.("webglcontextlost", this.loss);
    this.canvas.removeEventListener?.("webglcontextrestored", this.restore);
    for (const m of this.batches) m.geometry.dispose();
    for (const m of this.materials.values()) m.dispose();
    this.textures.forEach((t) => {
      t.image.onload = null;
      t.image.onerror = null;
      t.dispose();
    });
    this.owned.forEach((v) => v.dispose());
    this.sun.shadow.map?.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.pieces = [];
    this.projected = [];
    this.records.clear();
    this.projectionCache.clear();
    this.batchByMaterial.clear();
  }
}

export class NativeTable3D {
  constructor(host, api) {
    this.host = host;
    this.api = api;
    this.platform = api.getDeviceInfo?.().platform;
    this.bitmap = this.platform === "devtools";
    if (this.bitmap) host.setData({ table3dBitmap: true });
    this.serial = 0;
    this.rect = null;
    this.scene = null;
    this.dead = false;
    this.metrics = {
      syncs: 0,
      selectorQueries: 0,
      layoutBuilds: 0,
      presentationSamples: 0,
      effectiveDpr: null,
      qualityReason: null,
    };
  }
  requestedDpr() {
    return Math.min(
      this.api.getWindowInfo?.().pixelRatio || 1,
      this.maxDpr || Infinity,
    );
  }
  presented(presentMs) {
    const scene = this.scene;
    this.metrics.presentationSamples++;
    this.metrics.effectiveDpr = scene?.dpr ?? null;
    if (
      this.platform !== "android" ||
      this.maxDpr ||
      !scene ||
      scene.dpr <= 1 ||
      this.metrics.presentationSamples <= 2
    )
      return;
    this.slowCopies = presentMs > 8 ? (this.slowCopies || 0) + 1 : 0;
    if (this.slowCopies < 3) return;
    // Retain full geometry and the CSS camera. Reduce only framebuffer pixels
    // after repeated measured copy cost, once per controller lifetime.
    this.maxDpr = 1;
    this.metrics.qualityReason = scene.qualityReason =
      "slow-android-canvas-copy";
    scene.resize(scene.width, scene.height, 1);
    this.metrics.effectiveDpr = scene.dpr;
    if (scene.stats)
      Object.assign(scene.stats, {
        effectiveDpr: scene.dpr,
        qualityReason: scene.qualityReason,
      });
  }
  covered() {
    return !!(
      this.host.data.settlement?.visible || this.host.data.game?.ranking
    );
  }
  ready(value) {
    if (this.host.data.table3dReady !== value)
      this.host.setData({ table3dReady: value });
  }
  async sync() {
    const h = this.host,
      room = h.data.room;
    this.metrics.syncs++;
    if (this.dead || !h.active || !room?.game || this.covered()) {
      // Keep the mounted 3D view while the result panel covers it. Switching
      // readiness off would reveal the old flat measurement proxies behind it.
      this.suspend(!this.dead && h.active && !!room?.game && this.covered());
      if (!room?.game) {
        this.scene?.dispose();
        this.scene = null;
        this.canvas = null;
      }
      return false;
    }
    const serial = ++this.serial;
    try {
      return await new Promise((resolve) => {
        const apply = (results) => {
          if (
            this.dead ||
            serial !== this.serial ||
            !h.active ||
            this.covered() ||
            h.data.room !== room
          ) {
            resolve(false);
            return;
          }
          const node = results?.[0]?.node,
            rect = results?.[1];
          if (!node || !(rect?.width > 0 && rect?.height > 0)) {
            this.rect = null;
            this.scene?.suspend();
            this.ready(false);
            resolve(false);
            return;
          }
          try {
            if (this.canvas !== node || !this.scene) {
              this.scene?.dispose();
              this.scene = null;
              this.canvas = null;
              this.layoutRoom = null;
              // WebGL native layers can cover WXML controls. Draw real depth-buffered
              // geometry offscreen, then one GPU canvas blit into same-layer Canvas2D.
              const glCanvas = this.api.createOffscreenCanvas({
                type: "webgl",
                width: 1,
                height: 1,
              });
              const scene = new NativeScene(
                glCanvas,
                rect.width,
                rect.height,
                this.requestedDpr(),
                () => {
                  this.rect = null;
                  this.ready(false);
                },
              );
              const context = node.getContext("2d");
              if (!context) {
                scene.dispose();
                throw Error("Canvas2D unavailable");
              }
              scene.canRender = () => h.active && !this.dead && !this.covered();
              scene.onRendered = () => {
                if (
                  !h.active ||
                  this.covered() ||
                  this.dead ||
                  this.scene !== scene ||
                  !this.rect ||
                  this.canvas !== node
                )
                  return;
                if (node.width !== glCanvas.width) node.width = glCanvas.width;
                if (node.height !== glCanvas.height)
                  node.height = glCanvas.height;
                const presentStart = Date.now();
                if (this.bitmap) {
                  // The desktop simulator composites native Canvas above WXML. Its
                  // presentation workaround is never used by Android/iOS device builds.
                  const frame = glCanvas.toDataURL("image/png");
                  h.setData({ table3dFrame: frame, table3dReady: true });
                } else {
                  // The WebGL canvas has an opaque background and covers the
                  // entire destination; clearing it first doubles Canvas2D work.
                  context.drawImage(glCanvas, 0, 0, node.width, node.height);
                  this.ready(true);
                }
                const presentMs = Date.now() - presentStart;
                scene.metrics.presentMs += presentMs;
                scene.metrics.presentations++;
                Object.assign(scene.stats, {
                  presentMs,
                  totalPresentMs: scene.metrics.presentMs,
                  presentations: scene.metrics.presentations,
                });
                this.presented(presentMs);
              };
              this.canvas = node;
              this.scene = scene;
            }
            const scene = this.scene;
            this.rect = rect;
            scene.resume();
            scene.resize(rect.width, rect.height, this.requestedDpr());
            this.metrics.effectiveDpr = scene.dpr;
            const reveals =
              room.game.settlement?.drawInfo?.revealedHands?.filter(
                (p) => h.data.settlement?.tableReveals?.[p.seat],
              ) || [];
            const age = h.openingRun
              ? Math.max(h.openingRun.age, Date.now() - h.openingRun.time)
              : null;
            const revealKey = reveals
              .map((p) => p.seat + ":" + p.hand)
              .join("|");
            if (
              this.layoutRoom !== room ||
              this.layoutAge !== age ||
              this.layoutReveals !== revealKey ||
              this.layoutSeats !== h.data.seats
            ) {
              const pieces = table3dLayout(room, room.mySeat, {
                openingAge: age,
                revealedHands: reveals,
              });
              for (const p of pieces)
                p.nodeId =
                  p.kind === "meld" ? this.meldNode(p) : nativePieceNode(p);
              scene.setPieces(pieces);
              this.layoutRoom = room;
              this.layoutAge = age;
              this.layoutReveals = revealKey;
              this.layoutSeats = h.data.seats;
              this.metrics.layoutBuilds++;
            }
            scene.setDropTarget(h.data.dropTarget);
            const corners = [
                [-2.5, 0.37, -2.45],
                [2.5, 0.37, -2.45],
                [2.5, 0.37, 2.45],
                [-2.5, 0.37, 2.45],
              ].map((p) => scene.project(p)),
              xs = corners.map((p) => p.x),
              ys = corners.map((p) => p.y);
            const style = `left:${Math.min(...xs)}px;top:${Math.min(...ys)}px;width:${Math.max(...xs) - Math.min(...xs)}px;height:${Math.max(...ys) - Math.min(...ys)}px;`;
            if (h.data.table3dCenterStyle !== style)
              h.setData({ table3dCenterStyle: style });
            const ok = scene.renderNow();
            this.ready(ok);
            resolve(ok);
          } catch (e) {
            this.error = String(e?.message || e);
            this.rect = null;
            this.ready(false);
            resolve(false);
          }
        };
        if (this.canvas && this.scene && this.rect) {
          apply([{ node: this.canvas }, this.rect]);
        } else {
          const q = this.api.createSelectorQuery().in(h);
          q.select("#table-webgl").fields({ node: true, size: true });
          q.select(".table").boundingClientRect();
          this.metrics.selectorQueries++;
          q.exec(apply);
        }
      });
    } catch (e) {
      this.error = String(e?.message || e);
      this.ready(false);
      return false;
    }
  }
  meldNode(p) {
    const group = this.host.data.seats.find((s) => s.seat === p.seat)?.melds?.[
      p.meldIndex
    ];
    if (!group) return null;
    const tiles = Array.isArray(group) ? group : group.tiles || [];
    const target =
      p.layer === "added"
        ? tiles.find((t) => t.added)
        : tiles.filter((t) => !t.added)[p.slotIndex];
    return target?.nodeId || null;
  }
  resize() {
    this.rect = null;
    return this.sync();
  }
  suspend(keepReady = false) {
    ++this.serial;
    this.rect = null;
    this.scene?.suspend();
    if (!keepReady) this.ready(false);
  }
  dispose() {
    if (this.dead) return;
    this.suspend();
    this.dead = true;
    this.scene?.dispose();
    this.scene = null;
    this.canvas = null;
  }
  rectForNode(id) {
    if (!this.host.data.table3dReady || !this.rect) return null;
    const p = this.scene?.projected.find((p) => p.piece.nodeId === id);
    return p ? this.viewport(p) : null;
  }
  viewport(p) {
    return {
      ...p.bounds,
      left: p.bounds.left + this.rect.left,
      top: p.bounds.top + this.rect.top,
      angle: p.angle,
    };
  }
  opponentRect(seat) {
    if (!this.host.data.table3dReady || !this.rect) return null;
    const p = this.scene?.projected
      .filter((p) => p.piece.seat === seat && p.piece.kind === "concealed")
      .pop();
    return p ? this.viewport(p) : null;
  }
  hideTarget(id) {
    this.scene?.hideTarget(id);
  }
  setDropTarget(value) {
    this.scene?.setDropTarget(value);
  }
  dropOnTable(point) {
    if (
      !this.host.data.table3dReady ||
      !this.rect ||
      !this.scene ||
      !this.scene.active ||
      this.scene.failed
    )
      return null;
    const p = { x: point.x - this.rect.left, y: point.y - this.rect.top };
    return (
      pointInPolygon(p, this.scene.feltPolygon()) &&
      !this.scene.projected.some(
        (t) =>
          ["concealed", "meld", "nuki"].includes(t.piece.kind) &&
          pointInPolygon(p, t.hull),
      )
    );
  }
}
