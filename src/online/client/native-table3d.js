import { createScopedThreejs } from "./vendor/native-three.cjs";
import { table3dLayout, TILE, TABLE } from "./table3d-layout";
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
    this.materials = new Map();
    this.textures = [];
    this.batches = [];
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
      this.requestRender();
    };
    canvas.addEventListener?.("webglcontextlost", this.loss);
    canvas.addEventListener?.("webglcontextrestored", this.restore);
    this.resize(width, height, dpr);
  }
  geometry(source) {
    const T = this.THREE,
      g = new T.BufferGeometry();
    for (const key of ["position", "normal", "uv"])
      g.addAttribute(
        key,
        new T.BufferAttribute(
          new Float32Array(source[key]),
          key === "uv" ? 2 : 3,
        ),
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
  setPieces(pieces) {
    const key = JSON.stringify(pieces);
    if (this.key === key) return false;
    this.key = key;
    this.pieces = pieces;
    this.rebuild();
    return true;
  }
  rebuild() {
    const T = this.THREE;
    for (const m of this.batches) {
      this.scene.remove(m);
      m.geometry.dispose();
    }
    this.batches = [];
    const groups = new Map(),
      add = (source, matrix, material) => {
        let a = groups.get(material);
        if (!a) {
          a = { position: [], normal: [], uv: [] };
          groups.set(material, a);
        }
        const nm = new T.Matrix3().getNormalMatrix(matrix),
          v = new T.Vector3();
        for (let i = 0; i < source.position.length; i += 3) {
          v.fromArray(source.position, i).applyMatrix4(matrix);
          a.position.push(v.x, v.y, v.z);
          v.fromArray(source.normal, i).applyMatrix3(nm).normalize();
          a.normal.push(v.x, v.y, v.z);
        }
        a.uv.push(...source.uv);
      };
    for (const p of this.pieces) {
      if (this.hidden && this.hidden === p.nodeId) continue;
      const q = new T.Quaternion().setFromEuler(new T.Euler(...p.rotation)),
        matrix = new T.Matrix4().compose(
          new T.Vector3(...p.position),
          q,
          new T.Vector3(1, 1, 1),
        );
      add(rounded.body, matrix, this.ivory);
      add(rounded.back, matrix, this.back);
      if (p.value) add(rounded.face, matrix, this.face(p.value));
    }
    for (const [material, attrs] of groups) {
      const mesh = new T.Mesh(this.geometry(attrs), material);
      mesh.castShadow = material === this.ivory || material === this.back;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
      this.batches.push(mesh);
    }
    this.projected = this.projections();
    this.requestRender();
  }
  hideTarget(nodeId) {
    if (this.hidden === nodeId) return;
    this.hidden = nodeId;
    this.rebuild();
  }
  resize(width, height, dpr = 1) {
    if (!(width > 0 && height > 0)) return;
    const T = this.THREE,
      q = nativeQuality(width, height, dpr);
    const same =
      this.width === width && this.height === height && this.dpr === q.dpr;
    if (same) return;
    this.width = width;
    this.height = height;
    this.dpr = q.dpr;
    this.renderer.setPixelRatio(q.dpr);
    this.renderer.setSize(width, height, false);
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
      return {
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
    });
  }
  feltPolygon() {
    return [
      [-17, 0, -13],
      [17, 0, -13],
      [17, 0, 13],
      [-17, 0, 13],
    ].map((p) => this.project(p));
  }
  setDropTarget(value) {
    if (this.outline.visible === !!value) return;
    this.outline.visible = !!value;
    this.requestRender();
  }
  renderNow() {
    if (this.disposed || !this.active || this.failed) return false;
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
      this.renderer.render(this.scene, this.camera);
      if (this.renderer.getContext().isContextLost()) {
        this.loss();
        return false;
      }
      this.dirty = false;
      this.frames++;
      this.stats = {
        frames: this.frames,
        drawCalls: this.renderer.info.render.calls,
        triangles: this.renderer.info.render.triangles,
        drawMs: Date.now() - start,
        dpr: this.dpr,
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
  }
}

export class NativeTable3D {
  constructor(host, api) {
    this.host = host;
    this.api = api;
    this.bitmap = api.getDeviceInfo?.().platform === "devtools";
    if (this.bitmap) host.setData({ table3dBitmap: true });
    this.serial = 0;
    this.rect = null;
    this.scene = null;
    this.dead = false;
  }
  ready(value) {
    if (this.host.data.table3dReady !== value)
      this.host.setData({ table3dReady: value });
  }
  async sync() {
    const h = this.host,
      room = h.data.room;
    if (this.dead || !h.active || !room?.game) {
      this.suspend();
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
        const q = this.api.createSelectorQuery().in(h);
        q.select("#table-webgl").fields({ node: true, size: true });
        q.select(".table").boundingClientRect();
        q.exec((results) => {
          if (
            this.dead ||
            serial !== this.serial ||
            !h.active ||
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
                this.api.getWindowInfo?.().pixelRatio || 1,
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
              scene.onRendered = () => {
                if (
                  !h.active ||
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
                  context.clearRect(0, 0, node.width, node.height);
                  context.drawImage(glCanvas, 0, 0, node.width, node.height);
                  this.ready(true);
                }
                scene.stats.presentMs = Date.now() - presentStart;
              };
              this.canvas = node;
              this.scene = scene;
            }
            const scene = this.scene;
            this.rect = rect;
            scene.resume();
            scene.resize(
              rect.width,
              rect.height,
              this.api.getWindowInfo?.().pixelRatio || 1,
            );
            const reveals =
              room.game.settlement?.drawInfo?.revealedHands?.filter(
                (p) => h.data.settlement?.tableReveals?.[p.seat],
              ) || [];
            const age = h.openingRun
              ? Math.max(h.openingRun.age, Date.now() - h.openingRun.time)
              : null;
            const pieces = table3dLayout(room, room.mySeat, {
              openingAge: age,
              revealedHands: reveals,
            });
            for (const p of pieces) {
              p.nodeId = nativePieceNode(p);
              if (p.kind === "meld") {
                p.nodeId = this.meldNode(p);
              }
            }
            scene.setPieces(pieces);
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
        });
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
  suspend() {
    ++this.serial;
    this.rect = null;
    this.scene?.suspend();
    this.ready(false);
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
