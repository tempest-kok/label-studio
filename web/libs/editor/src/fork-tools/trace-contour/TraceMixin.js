/**
 * Trace-contour: glue between the pure flow (flow.js) and Label Studio's Polygon tool.
 *
 * What it does:
 *  - `,` starts the flow with the SHORT arc, `.` starts it with the LONG arc (inside the flow the keys switch the arc);
 *  - while the flow is active, left clicks on the image are taken over before Konva sees them, so the neighbour
 *    polygon is not selected and not dragged, and the polygon being drawn gets no extra points;
 *  - three clicks: neighbour polygon, start vertex, end vertex;  Esc cancels;
 *  - while the flow is active the overlay (TraceOverlay.js) shows the neighbour's vertices and the arc preview;
 *  - after the third click the points of the arc are appended to the polygon being drawn, as ordinary polygon points,
 *    in ONE undo step (Ctrl+Z removes the whole arc).
 *
 * The mixin is added to the Polygon tool with one line in tools/Polygon.js (see FORK_TOUCHPOINTS.md).
 */
import { types } from "mobx-state-tree";

import { FF_DEV_3793, isFF } from "../../utils/feature-flags";
import { getTraceConfig } from "./config";
import { createTraceFlow } from "./flow";
import { PATH_MODE } from "./geometry";
import { createOverlay } from "./TraceOverlay";

const LOG = "[trace-contour]";
const HISTORY_KEY = "fork:trace-contour"; // the lock name used to merge the inserted points into one undo step
// Everything that makes up a mouse click. Konva listens to both the mouse and the pointer variants.
const SWALLOWED_MOUSE_EVENTS = ["mousedown", "mouseup", "pointerdown", "pointerup", "click", "dblclick"];

const isTypingTarget = (el) =>
  !!el && (["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) || el.isContentEditable === true);

export const TraceMixin = types.model("TraceContourMixin").actions((self) => {
  const flow = createTraceFlow();
  const overlay = createOverlay();
  let pressedAt = null; // where the left button went down, client coordinates
  let lastPointer = null; // last known mouse position: { x, y, target } in client coordinates
  let frame = null; // requestAnimationFrame id of a scheduled overlay refresh

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
    overlay.clear();
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

  /**
   * Appends the points to the polygon being drawn and returns how many were really added.
   *
   * - `insertPoint` is used instead of `addPoint`: `addPoint` closes the polygon when a point lands on the first one,
   *   which must never happen in the middle of an arc.
   * - The history is frozen while the points go in, so the whole arc becomes one undo step.
   */
  const insertPoints = (points) => {
    const area = self.getActivePolygon;
    const obj = self.obj;

    if (!area || !points.length) return 0;
    if (obj.multiImage && area.item_index !== obj.currentImage) return 0;

    const history = self.annotation.history;
    let inserted = 0;

    history.freeze(HISTORY_KEY);
    try {
      for (const [x, y] of points) {
        const before = area.points.length;

        area.insertPoint(before, obj.internalToCanvasX(x), obj.internalToCanvasY(y));
        if (area.points.length > before) inserted++;
      }
    } finally {
      history.unfreeze(HISTORY_KEY);
    }
    return inserted;
  };

  /** Redraw the overlay from the current flow state and the last known mouse position. */
  const refresh = () => {
    if (!flow.active || !getTraceConfig().showOverlay) {
      overlay.clear();
      return;
    }

    const obj = self.obj;
    const container = obj.stageRef?.container?.();
    const insideImage = lastPointer && container && container.contains(lastPointer.target);
    const { width, height } = imageSize();
    const { gapPx, miterLimit } = getTraceConfig();
    const view = flow.preview({
      point: insideImage ? toInternal({ clientX: lastPointer.x, clientY: lastPointer.y }) : null,
      polygons: getCandidates(),
      width,
      height,
      pickRadiusImagePx: pickRadiusImagePx(),
      gapPx,
      miterLimit,
    });

    overlay.render({
      stage: obj.stageRef,
      view,
      toCanvas: ([x, y]) => [obj.internalToCanvasX(x), obj.internalToCanvasY(y)],
    });
  };

  const scheduleRefresh = () => {
    if (frame !== null) return;
    frame = window.requestAnimationFrame(() => {
      frame = null;
      if (flow.active) refresh();
    });
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
          `click 3 ok: polygon ${event.polygonId}, vertices #${event.from} -> #${event.to}, arc ${event.mode}, ` +
            `${event.points.length} points (indices ${event.indices.join(", ")})`,
        );
        // percent of the image, the same units Label Studio uses in the result JSON
        if (getTraceConfig().debug) console.table(event.points.map(([x, y], i) => ({ vertex: event.indices[i], x, y })));
        if (getTraceConfig().apply) {
          const inserted = insertPoints(event.points);

          log(`inserted ${inserted} of ${event.points.length} points into the polygon (Ctrl+Z removes them all)`);
        } else {
          log("apply is off: nothing inserted");
        }
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
    refresh();
  };

  /** Always on and cheap: remembers where the mouse is, so the preview is right the moment the flow starts. */
  const onMouseMove = (ev) => {
    lastPointer = { x: ev.clientX, y: ev.clientY, target: ev.target };
    if (flow.active) scheduleRefresh();
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
    refresh();
  };

  return {
    afterCreate() {
      // The capture phase on `window` runs before Konva and before keymaster, which is what makes the takeover possible.
      window.addEventListener("keydown", onKeyDown, true);
      SWALLOWED_MOUSE_EVENTS.forEach((type) => window.addEventListener(type, onMouseEvent, true));
      window.addEventListener("mousemove", onMouseMove, true);
    },

    beforeDestroy() {
      window.removeEventListener("keydown", onKeyDown, true);
      SWALLOWED_MOUSE_EVENTS.forEach((type) => window.removeEventListener(type, onMouseEvent, true));
      window.removeEventListener("mousemove", onMouseMove, true);
      if (frame !== null) window.cancelAnimationFrame(frame);
      frame = null;
      overlay.destroy();
    },

    traceCancel() {
      cancel();
    },
  };
});
