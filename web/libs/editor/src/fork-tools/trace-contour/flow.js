/**
 * Trace-contour: a pure state machine for the three-click flow.
 * No DOM, no MobX, no Konva: everything it needs comes in through arguments,
 * so it can be unit-tested and moved to another Label Studio version as is.
 *
 *   idle --press(mode)--> pickPolygon --click--> pickStart --click--> pickEnd --click--> idle (done)
 *
 *   click 1: a point inside the neighbour polygon (the smallest one wins if polygons are nested)
 *   click 2: the start vertex `a` of that polygon
 *   click 3: the end vertex `g` of that polygon
 *
 * All points are in percent of the image (0..100), the way Label Studio stores polygons.
 */
import { PATH_MODE, nearestVertex, pointInPolygon, polygonArea, toPixels, traceContour } from "./geometry";

export const STAGE = {
  IDLE: "idle",
  PICK_POLYGON: "pickPolygon",
  PICK_START: "pickStart",
  PICK_END: "pickEnd",
};

export function createTraceFlow() {
  let stage = STAGE.IDLE;
  let mode = PATH_MODE.SHORT;
  let picked = null; // { id, points } the neighbour polygon chosen by click 1
  let startIndex = null; // vertex `a`

  const reset = () => {
    stage = STAGE.IDLE;
    picked = null;
    startIndex = null;
  };

  return {
    get stage() {
      return stage;
    },
    get mode() {
      return mode;
    },
    get picked() {
      return picked;
    },
    get startIndex() {
      return startIndex;
    },
    get active() {
      return stage !== STAGE.IDLE;
    },

    /**
     * A hotkey was pressed. From idle it starts the flow with this arc mode;
     * inside the flow it only switches the arc mode (so `,` and `.` can be used to change one's mind).
     */
    press(newMode) {
      if (stage === STAGE.IDLE) {
        mode = newMode;
        stage = STAGE.PICK_POLYGON;
        return { type: "started", mode };
      }
      mode = newMode;
      return { type: "mode", mode };
    },

    cancel() {
      const wasActive = stage !== STAGE.IDLE;

      reset();
      return { type: "cancelled", wasActive };
    },

    /**
     * @param {Object} params
     * @param {number[]} params.point click position, percent
     * @param {{id: string, points: number[][]}[]} params.polygons closed polygons that can be traced, points in percent
     * @param {number} params.width original image width, px
     * @param {number} params.height original image height, px
     * @param {number} params.pickRadiusImagePx how far from a vertex a click still counts as hitting it, image px
     * @param {number} [params.gapPx]
     * @param {number} [params.miterLimit]
     */
    click({ point, polygons, width, height, pickRadiusImagePx, gapPx, miterLimit }) {
      if (stage === STAGE.IDLE) return { type: "ignored" };

      const clickPx = toPixels([point], width, height)[0];

      if (stage === STAGE.PICK_POLYGON) {
        let best = null;

        for (const polygon of polygons) {
          const ring = toPixels(polygon.points, width, height);

          if (ring.length < 3 || !pointInPolygon(clickPx, ring)) continue;
          const area = polygonArea(ring);

          if (!best || area < best.area) best = { polygon, area };
        }
        if (!best) return { type: "miss", reason: "no-polygon" };

        picked = { id: best.polygon.id, points: best.polygon.points };
        stage = STAGE.PICK_START;
        return { type: "polygon-picked", id: picked.id, vertexCount: picked.points.length };
      }

      const ring = toPixels(picked.points, width, height);
      const vertex = nearestVertex(ring, clickPx, pickRadiusImagePx);

      if (!vertex) return { type: "miss", reason: "no-vertex" };

      if (stage === STAGE.PICK_START) {
        startIndex = vertex.index;
        stage = STAGE.PICK_END;
        return { type: "start-picked", index: startIndex };
      }

      // PICK_END
      if (vertex.index === startIndex) return { type: "miss", reason: "same-vertex" };

      const result = traceContour({
        ring: picked.points,
        width,
        height,
        from: startIndex,
        to: vertex.index,
        mode,
        gapPx,
        miterLimit,
      });
      const event = {
        type: "done",
        polygonId: picked.id,
        from: startIndex,
        to: vertex.index,
        mode,
        indices: result?.indices ?? [],
        points: result?.points ?? [],
      };

      reset();
      return result ? event : { type: "failed", reason: "no-path" };
    },
  };
}
