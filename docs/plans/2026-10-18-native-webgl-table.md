# Native WeChat geometric table implementation plan

> 2026-10-19范围变更：原生联机已移出微信记分发布包，本文件中的原生联机实现／验收为历史记录。当前miniprogram/只包含线下记分工具；联机仅保留网站。历史原生源与资源见archive/native-online/。

**Goal:** Port the existing real three-dimensional online table to native WeChat Canvas, retaining touch discard, calls, nuki, automatic riichi, and settlement.

**Architecture:** Reuse table3d-layout and rounded geometry dimensions. Tencent's scoped Three.js r108 backend supports native WebGL1; browser Three.js r186 stays unchanged. Merge identical tile body/material geometry to reduce draw calls. Original WXML hand, actions and results remain native controls; hidden public proxies are measured only as fallback. Actual projected meshes supply flight endpoints and discard hit polygons.

**Constraints:** No production restart, database change, secret commit, or mini program publication during pending filing. Device performance must be labelled separately from developer-tool/browser measurements.

- [x] Bundle pinned official scoped adapter, shared layout and generated rounded buffers; native renderer uses reusable texture cache, depth buffer, lighting/shadows and same perspective camera.
- [x] Native controller mounts canvas, projects public tile geometry, guards stale asynchronous node/image callbacks, handles background, resize, room replacement and disposal. On failure show existing WXML fallback.
- [x] Integrate page, touch and flight endpoints while preserving all existing business semantics and result timing.
- [x] Verify actual depth, merged draw budgets, idle scheduling, lifecycle, hit tests, native compile and action flows. Capture current developer-tool evidence if available; retain explicit Android-device gap.
- [x] Run repository regressions, update handover docs, commit and push GitHub.

Final scope: native actual geometry + mobile Canvas2D composition, simulator-only bitmap presentation workaround, instance-scoped Tencent event shim, same business controls. Android actual-device composition/performance remains an explicit acceptance gap. GitHub delivery and compile evidence recorded in README/devtools-current.
