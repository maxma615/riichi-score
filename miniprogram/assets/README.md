# Native table artwork

Generated PNG exports of the application's existing licensed web assets. Tile identities and font outlines are unchanged; this is format conversion, not new artwork. The original SVG files remain in `public/online/assets/tiles/regular/` and the Ma Shan Zheng subset remains in `public/online/assets/fonts/`.

- 39 tile PNGs, 150 × 200; CC0 FluffyStuff artwork, including three red fives and a deliberately blank white dragon. Native tile bodies supply the ivory background and volume.
- 7 transparent declaration PNGs, 480 × 240; the same Ma Shan Zheng SIL OFL subset and gold/stroke colors used by the web table.
- `manifest.json` records each source/output SHA-256, dimensions and bytes. Original attribution and licenses accompany the exports in `licenses/`; the copied tile notice describes the original SVG distribution, not byte identity of these PNG exports.

The native client uses `/assets/...` paths. API/login/online play still need the configured server and WeChat credentials; bundled image loading does not need a separate network request or font download.

From the repository root: `npm ci`, `npx playwright install chromium`, then `npm run sync:mini:assets`. The build reads local licensed sources, blocks external browser requests and exports all resources. `npm test` verifies resource coverage, source/output hashes, PNG decoding, red tile differences, transparency, licenses and a project-specific 1.5 MiB source/asset budget. Browser raster export and these checks do not prove current WeChat rendering or device acceptance.
