// Browser-only bridge for the native Tencent r108 backend. WebGL is never mocked.
import {
  NativeScene,
  NativeTable3D,
  nativePieceNode,
  pointInPolygon,
} from "../src/online/client/native-table3d.js";
import { table3dLayout } from "../src/online/client/table3d-layout";

const canvas = document.querySelector("canvas");
const images = [];
const contextRequests = [];
let gpuDraws = 0;
class NativeCanvasBridge {
  constructor(element) {
    this.element = element;
    // The scoped adapter installs its EventTarget on the bridge prototype.
    // Preserve browser event delivery so genuine context-loss events reach it.
    this.addEventListener = element.addEventListener.bind(element);
    this.removeEventListener = element.removeEventListener.bind(element);
    this.requestAnimationFrame = requestAnimationFrame.bind(window);
    this.cancelAnimationFrame = cancelAnimationFrame.bind(window);
  }
  get width() {
    return this.element.width;
  }
  set width(value) {
    this.element.width = value;
  }
  get height() {
    return this.element.height;
  }
  set height(value) {
    this.element.height = value;
  }
  getContext(type, attributes) {
    contextRequests.push(type);
    const gl = this.element.getContext(type, attributes);
    if (gl && !this.gl) {
      this.gl = gl;
      for (const name of ["drawElements", "drawArrays"]) {
        const draw = gl[name].bind(gl);
        gl[name] = (...args) => {
          gpuDraws++;
          return draw(...args);
        };
      }
    }
    return gl;
  }
  createImage() {
    const image = new Image();
    images.push(image);
    return image;
  }
}
let scene,
  bridge,
  failureCount = 0;
const piecesFor = (room) =>
  table3dLayout(room, room.mySeat).map((piece) => ({
    ...piece,
    nodeId: nativePieceNode(piece),
  }));
function pixels() {
  scene.requestRender();
  scene.renderNow();
  const gl = scene.renderer.getContext(),
    data = new Uint8Array(canvas.width * canvas.height * 4);
  gl.readPixels(
    0,
    0,
    canvas.width,
    canvas.height,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    data,
  );
  return data;
}
function info() {
  const gl = scene.renderer.getContext(),
    extension = gl.getExtension("WEBGL_debug_renderer_info");
  return {
    revision: scene.THREE.REVISION,
    webgl1:
      gl instanceof WebGLRenderingContext &&
      !(
        typeof WebGL2RenderingContext !== "undefined" &&
        gl instanceof WebGL2RenderingContext
      ),
    version: gl.getParameter(gl.VERSION),
    renderer: extension
      ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL)
      : gl.getParameter(gl.RENDERER),
    depthBits: gl.getParameter(gl.DEPTH_BITS),
    depthTest: gl.isEnabled(gl.DEPTH_TEST),
    contextRequests,
    stats: scene.stats,
    frames: scene.frames,
    pending: scene.frame,
    pieces: scene.pieces,
    projected: scene.projected,
    felt: scene.feltPolygon(),
    textures: images.map((image) => ({
      src: new URL(image.src).pathname,
      complete: image.complete,
      width: image.naturalWidth,
      height: image.naturalHeight,
    })),
    shadow: {
      enabled: scene.renderer.shadowMap.enabled,
      map: !!scene.sun.shadow.map,
      size: scene.sun.shadow.mapSize.toArray(),
    },
    active: scene.active,
    failed: scene.failed,
    disposed: scene.disposed,
    failureCount,
    error: scene.error,
    batches: scene.batches.length,
  };
}
window.nativeHarness = {
  boot(room, width, height, dpr = 3) {
    bridge = new NativeCanvasBridge(canvas);
    canvas.style.width = width + "px";
    canvas.style.height = height + "px";
    scene = new NativeScene(bridge, width, height, dpr, () => {
      failureCount++;
    });
    scene.setPieces(piecesFor(room));
    return scene.renderNow();
  },
  info,
  async controllerPerformance(room, width, height) {
    const target = document.createElement("canvas");
    target.style.width = width + "px";
    target.style.height = height + "px";
    document.body.append(target);
    const ctx = target.getContext("2d"),
      drawImage = ctx.drawImage.bind(ctx);
    let copies = 0,
      clears = 0;
    ctx.drawImage = (source, ...args) => {
      copies++;
      return drawImage(source.element || source, ...args);
    };
    const clearRect = ctx.clearRect.bind(ctx);
    ctx.clearRect = (...args) => {
      clears++;
      return clearRect(...args);
    };
    const host = {
      active: true,
      data: { room, game: room.game, seats: [], settlement: null },
      setData(value) {
        Object.assign(this.data, value);
      },
    };
    const query = {
      in() {
        return this;
      },
      select() {
        return this;
      },
      fields() {
        return this;
      },
      boundingClientRect() {
        return this;
      },
      exec(callback) {
        callback([{ node: target }, target.getBoundingClientRect()]);
      },
    };
    const imageStart = images.length;
    const controller = new NativeTable3D(host, {
      getDeviceInfo: () => ({ platform: "android" }),
      getWindowInfo: () => ({ pixelRatio: 3 }),
      createSelectorQuery: () => query,
      createOffscreenCanvas: () =>
        new NativeCanvasBridge(document.createElement("canvas")),
    });
    const initial = await controller.sync();
    for (
      let i = 0;
      i < 100 && images.slice(imageStart).some((image) => !image.complete);
      i++
    )
      await new Promise((resolve) => setTimeout(resolve, 20));
    await new Promise((resolve) => requestAnimationFrame(resolve));
    controller.scene.renderNow();
    const before = {
      frames: controller.scene.frames,
      copies,
      ...controller.metrics,
    };
    for (let i = 0; i < 20; i++) await controller.sync();
    const afterUi = {
      frames: controller.scene.frames,
      copies,
      ...controller.metrics,
    };
    controller.scene.requestRender();
    host.data.settlement = { visible: true };
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const hidden = await controller.sync();
    controller.scene.requestRender();
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const during = {
      frames: controller.scene.frames,
      copies,
      active: controller.scene.active,
    };
    host.data.settlement = null;
    const resumed = await controller.sync();
    const stats = { ...controller.scene.stats };
    const pixels = ctx.getImageData(0, 0, target.width, target.height).data;
    let lit = 0;
    for (let i = 0; i < pixels.length; i += 4)
      if (pixels[i] + pixels[i + 1] + pixels[i + 2] > 300) lit++;
    const result = {
      initial,
      hidden,
      resumed,
      before,
      afterUi,
      during,
      afterResume: { copies, ...controller.metrics },
      clears,
      lit,
      presentMs: stats.presentMs,
      totalPresentMs: stats.totalPresentMs,
      presentations: stats.presentations,
    };
    const projected = controller.scene.projected,
      defaultDpr = controller.scene.dpr;
    const copySamples = [],
      presented = controller.presented.bind(controller);
    controller.presented = (ms) => {
      copySamples.push(ms);
      presented(ms);
    };
    for (let i = 0; i < 4; i++) {
      controller.setDropTarget(i % 2 === 0);
      controller.scene.renderNow();
    }
    await new Promise((resolve) => requestAnimationFrame(resolve));
    result.adaptive = {
      defaultDpr,
      effectiveDpr: controller.scene.dpr,
      reason: controller.metrics.qualityReason,
      copySamples,
      projectedStable: projected === controller.scene.projected,
      requestedDpr: controller.requestedDpr(),
    };
    controller.dispose();
    target.remove();
    return result;
  },
  bufferIntegrity() {
    const T = scene.THREE;
    let error = 0,
      vertices = 0,
      entries = 0;
    for (const batch of scene.batchByMaterial.values()) {
      const seen = new Set();
      for (let index = 0; index < batch.slots.length; index++) {
        const entry = batch.slots[index],
          piece = scene.records.get(entry.id).piece;
        if (entry.slot !== index || seen.has(entry.id)) return { valid: false };
        seen.add(entry.id);
        entries++;
        const matrix = new T.Matrix4().compose(
          new T.Vector3(...piece.position),
          new T.Quaternion().setFromEuler(new T.Euler(...piece.rotation)),
          new T.Vector3(1, 1, 1),
        );
        const normalMatrix = new T.Matrix3().getNormalMatrix(matrix),
          vector = new T.Vector3();
        for (const key of ["position", "normal"]) {
          const source = batch.source[key],
            actual = batch.mesh.geometry.attributes[key].array;
          for (let i = 0; i < source.length; i += 3) {
            vector.fromArray(source, i);
            if (key === "position") vector.applyMatrix4(matrix);
            else vector.applyMatrix3(normalMatrix).normalize();
            for (let j = 0; j < 3; j++)
              error = Math.max(
                error,
                Math.abs(
                  vector.getComponent(j) -
                    actual[index * source.length + i + j],
                ),
              );
            vertices++;
          }
        }
      }
    }
    return { valid: true, error, vertices, entries };
  },
  performance(room) {
    scene.setPieces(piecesFor(room));
    scene.renderNow();
    const before = { ...scene.metrics },
      original = scene.batches.map((m) => m.geometry);
    let allocations = 0,
      projections = 0;
    const geometry = scene.geometry.bind(scene),
      project = scene.projections.bind(scene);
    scene.geometry = (...args) => {
      allocations++;
      return geometry(...args);
    };
    scene.projections = (...args) => {
      projections++;
      return project(...args);
    };
    const target = scene.pieces.find((p) => p.nodeId)?.nodeId;
    const start = performance.now();
    for (let i = 0; i < 20; i++) {
      scene.hideTarget(target);
      scene.hideTarget(null);
    }
    const hideMs = performance.now() - start;
    const hide = {
      allocations,
      projections,
      ms: hideMs,
      stable: scene.batches.every((m, i) => m.geometry === original[i]),
    };
    allocations = projections = 0;
    const next = scene.pieces.map((p) => ({
      ...p,
      position: [...p.position],
      rotation: [...p.rotation],
    }));
    const moving = next.find((p) => p.nodeId);
    moving.position[0] += 0.12;
    const changeStart = performance.now();
    scene.setPieces(next);
    const change = {
      allocations,
      projections,
      ms: performance.now() - changeStart,
    };
    scene.renderNow();
    let shadowDraws = 0;
    const shadowRender = scene.renderer.shadowMap.render.bind(
      scene.renderer.shadowMap,
    );
    scene.renderer.shadowMap.render = (...args) => {
      const count = gpuDraws;
      const result = shadowRender(...args);
      shadowDraws += gpuDraws - count;
      return result;
    };
    scene.setDropTarget(true);
    scene.renderNow();
    scene.setDropTarget(false);
    scene.renderNow();
    scene.renderer.shadowMap.render = shadowRender;
    scene.geometry = geometry;
    scene.projections = project;
    const total = scene.stats.triangles;
    scene.hideTarget(target);
    scene.renderNow();
    const hiddenTriangles = scene.stats.triangles;
    scene.setPieces(
      next.map((p) =>
        p.nodeId === target
          ? { ...p, position: [p.position[0] + 0.1, ...p.position.slice(1)] }
          : p,
      ),
    );
    scene.renderNow();
    const hiddenAfterChange = scene.stats.triangles;
    scene.hideTarget(null);
    scene.renderNow();
    const restoredTriangles = scene.stats.triangles;
    scene.hideTarget(target);
    scene.setPieces(next.filter((p) => p.nodeId !== target));
    scene.renderNow();
    const afterRemoval = scene.stats.triangles;
    scene.hideTarget(null);
    scene.renderNow();
    const clearedAfterRemoval = scene.stats.triangles;
    return {
      visibility: {
        total,
        hiddenTriangles,
        hiddenAfterChange,
        restoredTriangles,
        afterRemoval,
        clearedAfterRemoval,
      },
      hide,
      change,
      outlineShadowDraws: shadowDraws,
      before,
      after: scene.metrics,
    };
  },
  setRoom(room) {
    return scene.setPieces(piecesFor(room));
  },
  render() {
    gpuDraws = 0;
    scene.requestRender();
    const ok = scene.renderNow();
    return { ok, gpuDraws, stats: scene.stats };
  },
  resize(width, height, dpr = 3) {
    canvas.style.width = width + "px";
    canvas.style.height = height + "px";
    scene.resize(width, height, dpr);
  },
  suspend() {
    scene.suspend();
  },
  resume() {
    scene.resume();
  },
  hide(nodeId) {
    scene.hideTarget(nodeId);
  },
  pointInPolygon,
  shadowPixels() {
    const enabled = pixels();
    scene.sun.castShadow = false;
    const disabled = pixels();
    scene.sun.castShadow = true;
    scene.requestRender();
    scene.renderNow();
    let changed = 0,
      maxDelta = 0,
      colored = 0;
    const palette = new Set();
    for (let i = 0; i < enabled.length; i += 4) {
      const delta =
        Math.abs(enabled[i] - disabled[i]) +
        Math.abs(enabled[i + 1] - disabled[i + 1]) +
        Math.abs(enabled[i + 2] - disabled[i + 2]);
      if (delta > 12) changed++;
      maxDelta = Math.max(maxDelta, delta);
      if (enabled[i] + enabled[i + 1] + enabled[i + 2] > 300) colored++;
      palette.add(
        (enabled[i] >> 3) +
          "," +
          (enabled[i + 1] >> 3) +
          "," +
          (enabled[i + 2] >> 3),
      );
    }
    const gl = scene.renderer.getContext();
    return {
      changed,
      maxDelta,
      colored,
      palette: palette.size,
      glError: gl.getError(),
      framebuffer: !!gl.getParameter(gl.FRAMEBUFFER_BINDING),
      bufferWidth: gl.drawingBufferWidth,
      bufferHeight: gl.drawingBufferHeight,
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
    };
  },
  lose() {
    window.nativeContextLoss = scene.renderer
      .getContext()
      .getExtension("WEBGL_lose_context");
    window.nativeContextLoss.loseContext();
  },
  restore() {
    window.nativeContextLoss.restoreContext();
  },
  dispose() {
    const resources = [
      ...scene.owned,
      ...scene.textures,
      ...scene.materials.values(),
      ...scene.batches.map((mesh) => mesh.geometry),
    ];
    const seen = new Set();
    for (const resource of resources)
      resource.addEventListener("dispose", () => seen.add(resource));
    const before = scene.frames;
    scene.dispose();
    scene.resume();
    scene.requestRender();
    return {
      resources: resources.length,
      disposedResources: seen.size,
      disposed: scene.disposed,
      active: scene.active,
      pending: scene.frame,
      pieces: scene.pieces.length,
      projected: scene.projected.length,
      renderAfter: scene.renderNow(),
      frames: scene.frames,
      before,
    };
  },
};
