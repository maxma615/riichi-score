// Browser-only bridge for the native Tencent r108 backend. WebGL is never mocked.
import { NativeScene, nativePieceNode, pointInPolygon } from '../src/online/client/native-table3d.js';
import { table3dLayout } from '../src/online/client/table3d-layout';

const canvas = document.querySelector('canvas');
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
  get width() { return this.element.width; }
  set width(value) { this.element.width = value; }
  get height() { return this.element.height; }
  set height(value) { this.element.height = value; }
  getContext(type, attributes) {
    contextRequests.push(type);
    const gl = this.element.getContext(type, attributes);
    if (gl && !this.gl) {
      this.gl = gl;
      for (const name of ['drawElements', 'drawArrays']) {
        const draw = gl[name].bind(gl);
        gl[name] = (...args) => { gpuDraws++; return draw(...args); };
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
let scene, bridge, failureCount = 0;
const piecesFor = room => table3dLayout(room, room.mySeat).map(piece => ({ ...piece, nodeId: nativePieceNode(piece) }));
function pixels() {
  scene.requestRender();
  scene.renderNow();
  const gl = scene.renderer.getContext(), data = new Uint8Array(canvas.width * canvas.height * 4);
  gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, data);
  return data;
}
function info() {
  const gl = scene.renderer.getContext(), extension = gl.getExtension('WEBGL_debug_renderer_info');
  return {
    revision: scene.THREE.REVISION,
    webgl1: gl instanceof WebGLRenderingContext && !(typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext),
    version: gl.getParameter(gl.VERSION), renderer: extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    depthBits: gl.getParameter(gl.DEPTH_BITS), depthTest: gl.isEnabled(gl.DEPTH_TEST), contextRequests,
    stats: scene.stats, frames: scene.frames, pending: scene.frame,
    pieces: scene.pieces, projected: scene.projected, felt: scene.feltPolygon(),
    textures: images.map(image => ({ src: new URL(image.src).pathname, complete: image.complete, width: image.naturalWidth, height: image.naturalHeight })),
    shadow: { enabled: scene.renderer.shadowMap.enabled, map: !!scene.sun.shadow.map, size: scene.sun.shadow.mapSize.toArray() },
    active: scene.active, failed: scene.failed, disposed: scene.disposed, failureCount, error: scene.error,
    batches: scene.batches.length,
  };
}
window.nativeHarness = {
  boot(room, width, height, dpr = 3) {
    bridge = new NativeCanvasBridge(canvas);
    canvas.style.width = width + 'px'; canvas.style.height = height + 'px';
    scene = new NativeScene(bridge, width, height, dpr, () => { failureCount++; });
    scene.setPieces(piecesFor(room));
    return scene.renderNow();
  },
  info,
  setRoom(room) { return scene.setPieces(piecesFor(room)); },
  render() { gpuDraws = 0; scene.requestRender(); const ok = scene.renderNow(); return { ok, gpuDraws, stats: scene.stats }; },
  resize(width, height, dpr = 3) { canvas.style.width = width + 'px'; canvas.style.height = height + 'px'; scene.resize(width, height, dpr); },
  suspend() { scene.suspend(); },
  resume() { scene.resume(); },
  hide(nodeId) { scene.hideTarget(nodeId); },
  pointInPolygon,
  shadowPixels() {
    const enabled = pixels(); scene.sun.castShadow = false;
    const disabled = pixels(); scene.sun.castShadow = true; scene.requestRender(); scene.renderNow();
    let changed = 0, maxDelta = 0, colored = 0;
    const palette = new Set();
    for (let i = 0; i < enabled.length; i += 4) {
      const delta = Math.abs(enabled[i] - disabled[i]) + Math.abs(enabled[i+1] - disabled[i+1]) + Math.abs(enabled[i+2] - disabled[i+2]);
      if (delta > 12) changed++;
      maxDelta = Math.max(maxDelta, delta);
      if (enabled[i] + enabled[i+1] + enabled[i+2] > 300) colored++;
      palette.add((enabled[i] >> 3) + ',' + (enabled[i+1] >> 3) + ',' + (enabled[i+2] >> 3));
    }
    const gl = scene.renderer.getContext();
    return { changed, maxDelta, colored, palette: palette.size, glError: gl.getError(), framebuffer: !!gl.getParameter(gl.FRAMEBUFFER_BINDING), bufferWidth: gl.drawingBufferWidth, bufferHeight: gl.drawingBufferHeight, canvasWidth: canvas.width, canvasHeight: canvas.height };
  },
  lose() { window.nativeContextLoss = scene.renderer.getContext().getExtension('WEBGL_lose_context'); window.nativeContextLoss.loseContext(); },
  restore() { window.nativeContextLoss.restoreContext(); },
  dispose() {
    const resources = [...scene.owned, ...scene.textures, ...scene.materials.values(), ...scene.batches.map(mesh => mesh.geometry)];
    const seen = new Set();
    for (const resource of resources) resource.addEventListener('dispose', () => seen.add(resource));
    const before = scene.frames; scene.dispose(); scene.resume(); scene.requestRender();
    return { resources: resources.length, disposedResources: seen.size, disposed: scene.disposed, active: scene.active, pending: scene.frame,
      pieces: scene.pieces.length, projected: scene.projected.length, renderAfter: scene.renderNow(), frames: scene.frames, before };
  },
};
