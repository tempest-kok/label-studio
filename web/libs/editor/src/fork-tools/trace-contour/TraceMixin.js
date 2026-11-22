/**
 * Trace-contour: glue between the pure flow (flow.js) and Label Studio's Polygon tool.
 *
 * What it does, step 2 (no drawing yet, the result is only written to the console):
 *  - `,` starts the flow with the SHORT arc, `.` starts it with the LONG arc (inside the flow the keys switch the arc);
 *  - while the flow is active, left clicks on the image are taken over before Konva sees them, so the neighbour
 *    polygon is not selected and not dragged, and the polygon being drawn gets no extra points;
 *  - three clicks: neighbour polygon, start vertex, end vertex;  Esc cancels.
 *
 * The mixin is added to the Polygon tool with one line in tools/Polygon.js (see FORK_TOUCHPOINTS.md).
 */
import { types } from "mobx-state-tree";

import { FF_DEV_3793, isFF } from "../../utils/feature-flags";
import { getTraceConfig } from "./config";
import { createTraceFlow } from "./flow";
import { PATH_MODE } from "./geometry";

const LOG = "[trace-contour]";
// Everything that makes up a mouse click. Konva listens to both the mouse and the pointer variants.
const SWALLOWED_MOUSE_EVENTS = ["mousedown", "mouseup", "pointerdown", "pointerup", "click", "dblclick"];

const isTypingTarget = (el) =>
  !!el && (["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) || el.isContentEditable === true);

export const TraceMixin = types.model("TraceContourMixin").actions((self) => {
  const flow = createTraceFlow();
  let pressedAt = null; // where the left button went down, client coordinates

  const log = (...args) => {
    if (getTraceConfig().debug) console.info(LOG, ...args);
  };

  /** The flow makes sense only while the user is in the middle of drawing a polygon with this tool. */
  const available = () => {
    try {
      return (
        getTraceConfig().enabled &&
        isFF(FF_DEV_3793) &&
        self.isDrawing &&
        !!self.getActivePolygon &&
        !self.annotation.isReadOnly() &&
        !self.obj.isSideways
      );
    } catch (e) {
      return false;
    }
  };

  const cancel = (reason) => {
    const event = flow.cancel();

    pressedAt = null;
    if (event.wasActive) log(reason ? `cancelled: ${reason}` : "cancelled");
  };

  /** Closed polygons of the current image that can be traced, points in percent. */
  const getCandidates = () => {
    const obj = self.obj;
    const current = self.getActivePolygon;

    return self.annotation.regions
      .filter((r) => r.type === "polygonregion" && r !== current && r.closed && !r.hidden && r.parent === obj)
      .map((r) => ({ id: r.id, points: r.points.map((p) => [p.x, p.y]) }));
  };

  /** Mouse event -> point in percent of the image, exactly as ImageView does for the tools. */
  const toInternal = (ev) => {
    const obj = self.obj;
    const stage = obj.stageRef;

    stage.setPointersPositions(ev);
    const pos = stage.getPointerPosition();

    if (!pos) return null;
    const [canvasX, canvasY] = obj.fixZoomedCoords([pos.x, pos.y]);

    return [obj.canvasToInternalX(canvasX), obj.canvasToInternalY(canvasY)];
  };

  const imageSize = () => ({ width: self.obj.naturalWidth, height: self.obj.naturalHeight });

  /** Click tolerance for vertices: a fixed number of screen pixels, converted to image pixels. */
  const pickRadiusImagePx = () => {
    const obj = self.obj;
    const screenPxPerImagePx = (obj.stageWidth * obj.zoomScale) / obj.naturalWidth;

    return getTraceConfig().pickRadiusScreenPx / screenPxPerImagePx;
  };

  const report = (event) => {
    switch (event.type) {
      case "started":
        log(`started, arc: ${event.mode === PATH_MODE.SHORT ? "SHORT (,)" : "LONG (.)"}. Click 1: the neighbour polygon.`);
        break;
      case "mode":
        log(`arc: ${event.mode === PATH_MODE.SHORT ? "SHORT (,)" : "LONG (.)"}`);
        break;
      case "polygon-picked":
        log(`click 1 ok: polygon ${event.id} (${event.vertexCount} vertices). Click 2: the start vertex.`);
        break;
      case "start-picked":
        log(`click 2 ok: start vertex #${event.index}. Click 3: the end vertex.`);
        break;
      case "miss":
        log(
          {
            "no-polygon": "no closed polygon under the cursor",
            "no-vertex": "no vertex close enough to the cursor",
            "same-vertex": "that is the start vertex, pick another one",
          }[event.reason] ?? event.reason,
        );
        break;
      case "failed":
        log("no path between these vertices");
        break;
      case "done":
        log(
          `click 3 ok: polygon ${event.polygonId}, vertices #${event.from} -> #${event.to}, arc ${event.mode}. ` +
            `Would insert ${event.points.length} points (indices ${event.indices.join(", ")}):`,
        );
        // percent of the image, the same units Label Studio uses in the result JSON
        if (getTraceConfig().debug) console.table(event.points.map(([x, y], i) => ({ vertex: event.indices[i], x, y })));
        break;
      default:
    }
  };

  const handleClick = (ev) => {
    const point = toInternal(ev);

    if (!point) return;

    const { width, height } = imageSize();
    const { gapPx, miterLimit } = getTraceConfig();

    report(
      flow.click({
        point,
        polygons: getCandidates(),
        width,
        height,
        pickRadiusImagePx: pickRadiusImagePx(),
        gapPx,
        miterLimit,
      }),
    );
  };

  const onMouseEvent = (ev) => {
    if (!flow.active) return;

    if (!available()) {
      cancel("the polygon is no longer being drawn");
      return;
    }

    const container = self.obj.stageRef?.container?.();

    // Only clicks on the image canvas. Toolbars, side panels etc. keep working as usual.
    if (!container || !container.contains(ev.target)) return;
    // Right and middle buttons (pan, context menu) are not ours.
    if (ev.button !== undefined && ev.button !== 0) return;

    // Konva must not see this click: it would select or drag the neighbour polygon.
    ev.stopPropagation();
    ev.stopImmediatePropagation();

    if (ev.type === "mousedown") {
      pressedAt = { x: ev.clientX, y: ev.clientY };
    } else if (ev.type === "mouseup") {
      const moved = !pressedAt || Math.hypot(ev.clientX - pressedAt.x, ev.clientY - pressedAt.y) > getTraceConfig().clickMovePx;

      pressedAt = null;
      if (!moved) handleClick(ev);
    }
  };

  const onKeyDown = (ev) => {
    if (ev.code === "Escape" && flow.active) {
      cancel("Esc");
      ev.preventDefault();
      ev.stopPropagation();
      ev.stopImmediatePropagation();
      return;
    }

    // `code` is the physical key (works with any keyboard layout), `key` covers keys sent by a mouse driver as text.
    const isComma = ev.code === "Comma" || ev.key === ",";
    const isPeriod = ev.code === "Period" || ev.key === ".";

    if (!isComma && !isPeriod) return;
    if (ev.ctrlKey || ev.altKey || ev.metaKey || ev.shiftKey || ev.repeat) return;
    if (isTypingTarget(ev.target)) return;
    if (!available()) return;

    ev.preventDefault();
    ev.stopPropagation();
    ev.stopImmediatePropagation();
    report(flow.press(isComma ? PATH_MODE.SHORT : PATH_MODE.LONG));
  };

  return {
    afterCreate() {
      // The capture phase on `window` runs before Konva and before keymaster, which is what makes the takeover possible.
      window.addEventListener("keydown", onKeyDown, true);
      SWALLOWED_MOUSE_EVENTS.forEach((type) => window.addEventListener(type, onMouseEvent, true));
    },

    beforeDestroy() {
      window.removeEventListener("keydown", onKeyDown, true);
      SWALLOWED_MOUSE_EVENTS.forEach((type) => window.removeEventListener(type, onMouseEvent, true));
    },

    traceCancel() {
      cancel();
    },
  };
});
