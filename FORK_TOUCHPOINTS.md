# FORK_TOUCHPOINTS

Every place where the fork changes a file that exists in upstream Label Studio 1.21.0.
New files of the fork live in `web/libs/editor/src/fork-tools/` and are not listed here.
When porting to another Label Studio, apply exactly these edits, then check "What the code relies on".

## Edits of upstream files

| # | File | Feature | What changed | Branch |
|---|------|---------|--------------|--------|
| 1 | `web/libs/editor/src/tools/Polygon.js` | trace-contour | `import { TraceMixin }` + `TraceMixin` added as the last argument of `types.compose(...)`. Both lines are marked `// FORK`. | `feat/trace-contour` |

Find them again at any time: `grep -rn "FORK" web/libs/editor/src --include=*.js --include=*.jsx --include=*.ts`

## What the code relies on (check these first if something breaks after a port)

### trace-contour
- Polygon points are stored in **percent of the image** (feature flag `fflag_fix_front_dev_3793_relative_coords_short` = on; in 1.21.0 it is in `stale_feature_flags.py` as `True`). The mixin does nothing when it is off.
- Tool model (`tools/Polygon.js` + `mixins/DrawingTool.js`): `isDrawing`, `getActivePolygon`, `obj`, `annotation`.
- Image object (`tags/object/Image/Image.js`): `stageRef`, `stageWidth`, `zoomScale`, `naturalWidth`, `naturalHeight`, `isSideways`, `fixZoomedCoords`, `canvasToInternalX/Y`.
- Regions: `annotation.regions`; polygon region fields `type === "polygonregion"`, `closed`, `hidden`, `parent`, `points[].x/y`.
- Konva 8 (lockfile: 8.4.3): `stage.container()`, `stage.setPointersPositions(event)`, `stage.getPointerPosition()`. Clicks are taken over with capture-phase listeners on `window`, because a region's own `onClick` stops the click before it reaches the tool.
- Inserting the arc: the polygon being drawn is `tool.getActivePolygon`; points are appended with the region action `insertPoint(index, canvasX, canvasY)` (it never closes the polygon, unlike `addPoint`). The history (`annotation.history`, `core/TimeTraveller.js`) is snapshot-based: `freeze(key)` / `unfreeze(key)` around the loop merge all points into one undo step (checked against the real `TimeTraveller`). Multi-image: `obj.multiImage`, `obj.currentImage`, `region.item_index`.
- The overlay (`TraceOverlay.js`) adds one non-listening Konva layer to the image stage (`stage.add`, `layer.moveToTop`) and draws in canvas coordinates under the stage's own zoom (`stage.scaleX()`), the same way region layers do when the flag above is on. It touches no React component. Switch it off alone with `showOverlay: false`.
- Hotkeys are plain `keydown` listeners (`event.code` Comma/Period, with `event.key` as a fallback), not keymaster.
- Switch: `window.LS_FORK_TOOLS = { traceContour: { enabled: false } }` or `enabled` in `fork-tools/trace-contour/config.js`.
