/* global describe, test, expect, beforeEach, jest */
import { createOverlay } from "../TraceOverlay";

// A minimal stand-in for Konva: records what was created and what happened to the layer.
jest.mock("konva", () => {
  class Shape {
    constructor(attrs) {
      this.attrs = attrs;
    }
  }
  class Line extends Shape {}
  class Circle extends Shape {}
  class Layer {
    constructor(attrs) {
      this.attrs = attrs;
      this.children = [];
      this.stage = null;
      this.calls = [];
    }
    getStage() {
      return this.stage;
    }
    add(shape) {
      this.children.push(shape);
    }
    destroyChildren() {
      this.children = [];
    }
    moveToTop() {
      this.calls.push("moveToTop");
    }
    batchDraw() {
      this.calls.push("batchDraw");
    }
    destroy() {
      this.stage = null;
      this.calls.push("destroy");
    }
  }

  return { __esModule: true, default: { Layer, Line, Circle } };
});

const makeStage = (zoom = 1) => ({
  zoom,
  layers: [],
  scaleX() {
    return this.zoom;
  },
  add(layer) {
    layer.stage = this;
    this.layers.push(layer);
  },
});

// percent of the image -> canvas: 1% = 10 px
const toCanvas = ([x, y]) => [x * 10, y * 10];

const square = [
  [20, 20],
  [40, 20],
  [40, 40],
  [20, 40],
];

const lines = (layer) => layer.children.filter((c) => c.attrs.points);
const circles = (layer) => layer.children.filter((c) => c.attrs.radius !== undefined);

describe("TraceOverlay", () => {
  let overlay;
  let stage;

  beforeEach(() => {
    overlay = createOverlay();
    stage = makeStage();
  });

  test("the layer is added to the stage once, ignores the mouse and is brought to the top", () => {
    overlay.render({ stage, view: { vertices: square, startIndex: null, hoverIndex: null, arcs: null }, toCanvas });
    overlay.render({ stage, view: { vertices: square, startIndex: null, hoverIndex: null, arcs: null }, toCanvas });

    expect(stage.layers).toHaveLength(1);
    expect(stage.layers[0].attrs.listening).toBe(false);
    expect(stage.layers[0].calls.filter((c) => c === "moveToTop")).toHaveLength(2);
    expect(stage.layers[0].calls.at(-1)).toBe("batchDraw");
  });

  test("outline + one marker per vertex, in canvas coordinates", () => {
    overlay.render({ stage, view: { vertices: square, startIndex: null, hoverIndex: null, arcs: null }, toCanvas });
    const layer = stage.layers[0];

    expect(lines(layer)).toHaveLength(1);
    expect(lines(layer)[0].attrs.closed).toBe(true);
    expect(lines(layer)[0].attrs.points).toEqual([200, 200, 400, 200, 400, 400, 200, 400]);
    expect(circles(layer)).toHaveLength(4);
    expect(circles(layer)[0].attrs).toMatchObject({ x: 200, y: 200 });
  });

  test("the start and the hovered vertices are drawn larger and are not duplicated", () => {
    overlay.render({ stage, view: { vertices: square, startIndex: 0, hoverIndex: 2, arcs: null }, toCanvas });
    const radii = circles(stage.layers[0]).map((c) => c.attrs.radius);

    expect(radii).toHaveLength(4);
    expect(radii.filter((r) => r > 4)).toHaveLength(2);
  });

  test("the chosen arc is bold, the other one is faint and dashed", () => {
    overlay.render({
      stage,
      view: {
        vertices: square,
        startIndex: 0,
        hoverIndex: 1,
        arcs: {
          chosen: [
            [19, 19],
            [41, 19],
          ],
          other: [
            [19, 19],
            [19, 41],
            [41, 41],
            [41, 19],
          ],
        },
      },
      toCanvas,
    });
    const [, faint, bold] = lines(stage.layers[0]); // [0] is the outline

    expect(faint.attrs.opacity).toBeLessThan(0.5);
    expect(faint.attrs.dash).toBeDefined();
    expect(bold.attrs.strokeWidth).toBeGreaterThan(faint.attrs.strokeWidth);
    expect(bold.attrs.points).toEqual([190, 190, 410, 190]);
  });

  test("sizes are divided by the zoom, line widths do not scale", () => {
    const zoomed = makeStage(2);

    overlay.render({ stage: zoomed, view: { vertices: square, startIndex: null, hoverIndex: null, arcs: null }, toCanvas });
    expect(circles(zoomed.layers[0])[0].attrs.radius).toBe(2); // 4 screen px at zoom 2
    expect(circles(zoomed.layers[0])[0].attrs.strokeScaleEnabled).toBe(false);
    expect(lines(zoomed.layers[0])[0].attrs.strokeScaleEnabled).toBe(false);
  });

  test("a view without vertices draws nothing but keeps the layer", () => {
    overlay.render({ stage, view: { vertices: null, startIndex: null, hoverIndex: null, arcs: null }, toCanvas });
    expect(stage.layers[0].children).toHaveLength(0);
  });

  test("a null view clears the layer", () => {
    overlay.render({ stage, view: { vertices: square, startIndex: null, hoverIndex: null, arcs: null }, toCanvas });
    overlay.render({ stage, view: null, toCanvas });
    expect(stage.layers[0].children).toHaveLength(0);
  });

  test("clear() before anything was drawn does nothing", () => {
    expect(() => overlay.clear()).not.toThrow();
  });

  test("a new stage (the image was reloaded) gets a new layer and the old one is dropped", () => {
    const view = { vertices: square, startIndex: null, hoverIndex: null, arcs: null };
    const other = makeStage();

    overlay.render({ stage, view, toCanvas });
    overlay.render({ stage: other, view, toCanvas });

    expect(other.layers).toHaveLength(1);
    expect(stage.layers[0].calls).toContain("destroy");
  });

  test("destroy() removes the layer", () => {
    overlay.render({ stage, view: { vertices: square, startIndex: null, hoverIndex: null, arcs: null }, toCanvas });
    overlay.destroy();
    expect(stage.layers[0].calls).toContain("destroy");
    expect(() => overlay.destroy()).not.toThrow();
  });

  test("no stage, no work", () => {
    expect(() => overlay.render({ stage: null, view: { vertices: square }, toCanvas })).not.toThrow();
  });
});
