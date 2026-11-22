/**
 * Trace-contour: what the user sees while the flow is active.
 *
 * One extra Konva layer, added to the image stage on demand and drawn imperatively (no React):
 *  - the outline and the vertices of the neighbour polygon (the one under the cursor, then the picked one);
 *  - the vertex under the cursor, larger;
 *  - the start vertex, in its own colour;
 *  - the arc that would be inserted (bright) and the other way round the ring (faint).
 *
 * The layer does not listen to events, so it can never steal a click. Sizes are given in screen pixels and divided
 * by the zoom, so markers look the same at any zoom.
 */
import Konva from "konva";

const COLOR = {
  outline: "#00e5ff",
  vertex: "#00e5ff",
  hover: "#ffeb3b",
  start: "#ff4081",
  arc: "#ff9800",
  halo: "#000000",
};

export function createOverlay() {
  let layer = null;

  const ensureLayer = (stage) => {
    if (layer && layer.getStage() === stage) return layer;
    if (layer) layer.destroy();
    layer = new Konva.Layer({ name: "trace-contour-overlay", listening: false });
    stage.add(layer);
    return layer;
  };

  return {
    /**
     * @param {Object} params
     * @param {import("konva/lib/Stage").Stage} params.stage
     * @param {Object|null} params.view result of flow.preview(); null clears the overlay
     * @param {(point: number[]) => number[]} params.toCanvas percent of the image -> canvas coordinates
     */
    render({ stage, view, toCanvas }) {
      if (!stage) return;
      if (!view) {
        this.clear();
        return;
      }

      const zoom = stage.scaleX() || 1;
      const px = (n) => n / zoom;
      const target = ensureLayer(stage);
      const flat = (points) => points.flatMap((p) => toCanvas(p));
      const line = (points, props) =>
        new Konva.Line({ points: flat(points), strokeScaleEnabled: false, lineJoin: "round", lineCap: "round", ...props });
      const dot = (point, radius, fill) => {
        const [x, y] = toCanvas(point);

        return new Konva.Circle({
          x,
          y,
          radius: px(radius),
          fill,
          stroke: COLOR.halo,
          strokeWidth: 1,
          strokeScaleEnabled: false,
        });
      };

      target.destroyChildren();

      if (view.vertices) {
        target.add(line(view.vertices, { closed: true, stroke: COLOR.outline, strokeWidth: 1.5, opacity: 0.85 }));
      }

      if (view.arcs) {
        if (view.arcs.other.length > 1) {
          target.add(line(view.arcs.other, { stroke: COLOR.arc, strokeWidth: 2, opacity: 0.35, dash: [6, 4] }));
        }
        target.add(line(view.arcs.chosen, { stroke: COLOR.arc, strokeWidth: 3.5 }));
        view.arcs.chosen.forEach((point) => target.add(dot(point, 3, COLOR.arc)));
      }

      if (view.vertices) {
        view.vertices.forEach((point, index) => {
          if (index !== view.startIndex && index !== view.hoverIndex) target.add(dot(point, 4, COLOR.vertex));
        });
        if (view.startIndex !== null && view.vertices[view.startIndex]) {
          target.add(dot(view.vertices[view.startIndex], 7, COLOR.start));
        }
        if (view.hoverIndex !== null && view.hoverIndex !== view.startIndex && view.vertices[view.hoverIndex]) {
          target.add(dot(view.vertices[view.hoverIndex], 7, COLOR.hover));
        }
      }

      target.moveToTop(); // the editor may add its own layers later
      target.batchDraw();
    },

    clear() {
      if (!layer || !layer.getStage()) return;
      layer.destroyChildren();
      layer.batchDraw();
    },

    destroy() {
      if (layer) layer.destroy();
      layer = null;
    },
  };
}
