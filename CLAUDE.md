# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — start the Vite dev server
- `npm run build` — type-check (`tsc -b`) then produce a production build in `dist/`
- `npm run preview` — serve the built `dist/` locally
- `npm test` — run the Vitest suite once (`vitest run`)
- Run a single test file: `npx vitest run src/geometry.test.ts`
- Watch a test during development: `npx vitest src/geometry.test.ts`

## What this app does

Single-page React + TypeScript tool ("Vastu Floor Overlay") for a Vastu consultant. The user uploads a client's floor plan (image or PDF), overlays a semi-transparent Vastu direction scale (a compass-like SVG/image) on top, aligns it, and exports the composite as JPEG or PDF. Everything runs client-side in the browser — there is no backend and no network API. State persists in `localStorage`.

## Architecture

The whole UI lives in `src/App.tsx` (one `App` component). It holds a single `ProjectState` object and delegates pure logic to small modules:

- `src/types.ts` — central type definitions. `ProjectState` is the root: it bundles the `floorPlan` asset, the `mapping` template (the Vastu scale), the overlay `transform`, and the two `floorAnchors`.
- `src/geometry.ts` — pure math for the overlay: `applyTransform` (rotate/scale/translate a point about the image center), `computeTransformFromAnchors` (derive scale+rotation+offset that maps the mapping's two anchor points onto the floor plan's two anchor points), and `normalizeTransform` (clamp scale 0.1–8, opacity 0.1–1). This is the only unit-tested module (`geometry.test.ts`).
- `src/defaultMapping.ts` — the built-in Vastu scale, an inline SVG encoded as a data URL plus its anchor points and directional labels (N/S/E/W + intercardinals).
- `src/fileUtils.ts` — converts uploaded files to assets. PDFs are rendered via `pdfjs-dist` (page 1, scale 2) to a canvas; images load directly. `detectPlanCenter` scans pixels to find the bounding box of non-white/opaque content and returns its center (used to auto-place the overlay).
- `src/storage.ts` — `localStorage` persistence. Two keys: the full project (`vastu-overlay-project`) and a user-saved default mapping (`vastu-overlay-default-mapping`). On load, if the saved project still references the default mapping id, it is refreshed from the current default.
- `src/exportUtils.ts` — turns the preview canvas into a JPEG download or a `jsPDF` document sized to the canvas.

### How the overlay rendering works (the core loop)

The preview is a single `<canvas>` sized to the floor plan's pixel dimensions. `drawPreview` in `App.tsx` redraws everything imperatively on every state change: floor plan image → transformed overlay image → labels → center marker → anchor crosshairs. A `useEffect` keyed on `floorPlan`, `mapping`, `transform`, and `floorAnchors` reloads the underlying `HTMLImageElement`s and re-runs `drawPreview`.

The overlay `transform` is applied identically in two places that must stay in sync: the canvas drawing (`context.translate/rotate/scale` around the mapping's center in `drawPreview`) and the point math (`applyTransform` in `geometry.ts`). Anchor dragging uses `invertPoint` (in `App.tsx`) to convert a canvas-space pointer back into mapping-image space. If you change the transform convention in one place, change it in all three.

Two anchor sets drive alignment: green floor anchors (canvas space) and amber mapping anchors (mapping-image space, drawn through `applyTransform`). "Match anchors" calls `computeTransformFromAnchors` to snap one onto the other.

### Conventions worth knowing

- Rotation is stored in **radians** throughout `ProjectState`; only display strings and the ±90° nudge buttons convert to/from degrees.
- Directional labels are only drawn for **custom** uploaded mappings, never for the default template (the default SVG already bakes in its own labels).
- The pure modules (`geometry`, parts of `fileUtils`/`storage`) are deliberately separated from `App.tsx` so they can be unit-tested without a DOM; keep new logic out of the component where practical.
