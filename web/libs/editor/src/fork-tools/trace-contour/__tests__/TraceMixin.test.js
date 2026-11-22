/**
 * @jest-environment jsdom
 */
/* global describe, test, expect, beforeEach, afterEach, jest */
import { destroy, types } from "mobx-state-tree";

import { TraceMixin } from "../TraceMixin";

// The real module drags half of the editor in; the mixin needs only these two names.
jest.mock("../../../utils/feature-flags", () => ({ FF_DEV_3793: "ff_3793", isFF: () => true }));
// The overlay draws with Konva, which needs a real canvas; here it is replaced by a recorder (it has its own test).
const mockOverlay = { render: jest.fn(), clear: jest.fn(), destroy: jest.fn() };

jest.mock("../TraceOverlay", () => ({ createOverlay: () => mockOverlay }));

const SIZE = 1000; // original image, px
const STAGE = 500; // the image on screen at zoom 1, px  ->  0.5 screen px per image px

// Neighbour: a 20%..40% square = (100..200, 100..200) screen px.
const square = [
  [20, 20],
  [40, 20],
  [40, 40],
  [20, 40],
];

const makeFakeTool = () => {
  const container = document.createElement("div");
  const canvas = document.createElement("canvas");

  container.appendChild(canvas);
  document.body.appendChild(container);

  const obj = {
    naturalWidth: SIZE,
    naturalHeight: SIZE,
    stageWidth: STAGE,
    zoomScale: 1,
    isSideways: false,
    stageRef: {
      container: () => container,
      setPointersPositions(ev) {
        this.pos = { x: ev.clientX, y: ev.clientY };
      },
      getPointerPosition() {
        return this.pos;
      },
    },
    fixZoomedCoords: ([x, y]) => [x, y],
    canvasToInternalX: (n) => (n / STAGE) * 100,
    canvasToInternalY: (n) => (n / STAGE) * 100,
    internalToCanvasX: (n) => (n / 100) * STAGE,
    internalToCanvasY: (n) => (n / 100) * STAGE,
  };
  // The polygon being drawn. `insertPoint` mimics the real one: canvas coordinates in, percent stored.
  const drawing = {
    type: "polygonregion",
    id: "drawing",
    closed: false,
    parent: obj,
    points: [{ x: 1, y: 1 }],
    insertPoint: jest.fn((index, canvasX, canvasY) => {
      drawing.points.splice(index, 0, { x: obj.canvasToInternalX(canvasX), y: obj.canvasToInternalY(canvasY) });
    }),
  };
  const history = { freeze: jest.fn(), unfreeze: jest.fn() };
  const neighbour = {
    type: "polygonregion",
    id: "neighbour",
    closed: true,
    hidden: false,
    parent: obj,
    points: square.map(([x, y]) => ({ x, y })),
  };
  const Fake = types
    .model("FakePolygonTool", {})
    .volatile(() => ({
      isDrawing: true,
      getActivePolygon: drawing,
      obj,
      annotation: { isReadOnly: () => false, regions: [drawing, neighbour], history },
    }))
    .actions((self) => ({
      setDrawing(value) {
        self.isDrawing = value;
      },
    }));
  const tool = types.compose("Tool", Fake, TraceMixin).create({});

  return { tool, container, canvas, drawing, history, obj };
};

const key = (init, target = document.body) => {
  const ev = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });

  target.dispatchEvent(ev);
  return ev;
};

// requestAnimationFrame is replaced by a queue that is emptied by hand: the mixin redraws once per frame.
let queuedFrames = [];
const flushFrames = () => {
  const queue = queuedFrames;

  queuedFrames = [];
  queue.forEach((fn) => fn());
};

const mouse = (type, target, clientX, clientY, extra = {}) => {
  const ev = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX, clientY, ...extra });

  target.dispatchEvent(ev);
  if (type === "mousemove") flushFrames();
  return ev;
};

const click = (target, x, y, extra) => {
  mouse("mousedown", target, x, y, extra);
  mouse("mouseup", target, x, y, extra);
};

describe("TraceMixin", () => {
  let fake;
  let seenByKonva;
  let info;
  const realRaf = window.requestAnimationFrame;
  const realCancelRaf = window.cancelAnimationFrame;

  beforeEach(() => {
    window.LS_FORK_TOOLS = undefined;
    mockOverlay.render.mockClear();
    mockOverlay.clear.mockClear();
    mockOverlay.destroy.mockClear();
    queuedFrames = [];
    window.requestAnimationFrame = (fn) => queuedFrames.push(fn);
    window.cancelAnimationFrame = () => {};
    fake = makeFakeTool();
    seenByKonva = [];
    // Stands for Konva: it listens on the stage container in the bubble phase.
    ["mousedown", "mouseup", "pointerdown", "pointerup", "click"].forEach((type) =>
      fake.container.addEventListener(type, (ev) => seenByKonva.push(ev.type)),
    );
    info = jest.spyOn(console, "info").mockImplementation(() => {});
    jest.spyOn(console, "table").mockImplementation(() => {});
  });

  afterEach(() => {
    window.requestAnimationFrame = realRaf;
    window.cancelAnimationFrame = realCancelRaf;
    destroy(fake.tool);
    document.body.innerHTML = "";
    jest.restoreAllMocks();
  });

  const logged = () => info.mock.calls.map((args) => args.join(" ")).join("\n");

  test("a click passes through to Konva while the flow is idle", () => {
    click(fake.canvas, 150, 150);
    expect(seenByKonva).toEqual(["mousedown", "mouseup"]);
  });

  test("`,` starts the flow and swallows the key", () => {
    const ev = key({ code: "Comma", key: "," });

    expect(ev.defaultPrevented).toBe(true);
    expect(logged()).toContain("started, arc: SHORT");
  });

  test("`.` starts the flow with the long arc; the physical key works on a Russian layout", () => {
    key({ code: "Period", key: "ю" });
    expect(logged()).toContain("started, arc: LONG");
  });

  test("the key sent as text by a mouse driver (no code) also works", () => {
    key({ code: "", key: "," });
    expect(logged()).toContain("started, arc: SHORT");
  });

  test("three clicks: Konva sees none of them, the result is logged", () => {
    key({ code: "Comma", key: "," });
    click(fake.canvas, 150, 150); // inside the neighbour
    click(fake.canvas, 101, 100); // vertex #0 = (100, 100)
    click(fake.canvas, 201, 99); // vertex #1 = (200, 100)

    expect(seenByKonva).toEqual([]);
    expect(logged()).toContain("click 1 ok: polygon neighbour");
    expect(logged()).toContain("click 2 ok: start vertex #0");
    expect(logged()).toContain("click 3 ok");
    expect(logged()).toContain("indices 0, 1");
  });

  test("after the result the flow is idle again and clicks pass through", () => {
    key({ code: "Comma", key: "," });
    click(fake.canvas, 150, 150);
    click(fake.canvas, 101, 100);
    click(fake.canvas, 201, 99);
    seenByKonva.length = 0;

    click(fake.canvas, 150, 150);
    expect(seenByKonva).toEqual(["mousedown", "mouseup"]);
  });

  test("a click on empty space is reported and the flow stays on click 1", () => {
    key({ code: "Comma", key: "," });
    click(fake.canvas, 400, 400);

    expect(logged()).toContain("no closed polygon under the cursor");
    expect(seenByKonva).toEqual([]);
  });

  test("Esc cancels and the next click passes through", () => {
    key({ code: "Comma", key: "," });
    const esc = key({ code: "Escape", key: "Escape" });

    expect(esc.defaultPrevented).toBe(true);
    expect(logged()).toContain("cancelled: Esc");
    click(fake.canvas, 150, 150);
    expect(seenByKonva).toEqual(["mousedown", "mouseup"]);
  });

  test("Esc is left alone when the flow is not active", () => {
    expect(key({ code: "Escape", key: "Escape" }).defaultPrevented).toBe(false);
  });

  test("a drag is swallowed but is not a click", () => {
    key({ code: "Comma", key: "," });
    mouse("mousedown", fake.canvas, 150, 150);
    mouse("mouseup", fake.canvas, 190, 190);

    expect(seenByKonva).toEqual([]);
    expect(logged()).not.toContain("click 1 ok");
  });

  test("right and middle buttons pass through", () => {
    key({ code: "Comma", key: "," });
    click(fake.canvas, 150, 150, { button: 2 });
    click(fake.canvas, 150, 150, { button: 1 });
    expect(seenByKonva).toEqual(["mousedown", "mouseup", "mousedown", "mouseup"]);
  });

  test("clicks outside the image canvas pass through", () => {
    const outside = document.createElement("button");
    const reached = [];

    document.body.appendChild(outside);
    outside.addEventListener("mousedown", () => reached.push("mousedown"));
    key({ code: "Comma", key: "," });
    click(outside, 10, 10);
    expect(reached).toEqual(["mousedown"]);
  });

  test("the keys are ignored with modifiers, in text fields and when no polygon is being drawn", () => {
    const input = document.createElement("input");

    document.body.appendChild(input);
    expect(key({ code: "Comma", key: ",", ctrlKey: true }).defaultPrevented).toBe(false);
    expect(key({ code: "Comma", key: "," }, input).defaultPrevented).toBe(false);
    fake.tool.setDrawing(false);
    expect(key({ code: "Comma", key: "," }).defaultPrevented).toBe(false);
    expect(logged()).toBe("");
  });

  test("if the polygon stops being drawn mid-flow the flow cancels itself and the click passes through", () => {
    key({ code: "Comma", key: "," });
    fake.tool.setDrawing(false);
    click(fake.canvas, 150, 150);

    expect(logged()).toContain("cancelled: the polygon is no longer being drawn");
    expect(seenByKonva).toEqual(["mousedown", "mouseup"]);
  });

  test("the on/off switch: disabled means no hotkeys at all", () => {
    window.LS_FORK_TOOLS = { traceContour: { enabled: false } };
    expect(key({ code: "Comma", key: "," }).defaultPrevented).toBe(false);
  });

  test("a destroyed tool leaves no listeners behind", () => {
    destroy(fake.tool);
    expect(key({ code: "Comma", key: "," }).defaultPrevented).toBe(false);
    fake.tool = makeFakeTool().tool; // afterEach destroys it
  });

  describe("inserting the arc", () => {
    // The gap is fixed here, so these tests do not change when the default in config.js is tuned.
    beforeEach(() => {
      window.LS_FORK_TOOLS = { traceContour: { gapPx: 1 } };
    });

    // vertices #0 (20%,20%) and #1 (40%,20%) of the neighbour; a gap of 1 px pushes them out by 1 px of 1000
    const traceFirstEdge = () => {
      key({ code: "Comma", key: "," });
      click(fake.canvas, 150, 150);
      click(fake.canvas, 101, 100);
      click(fake.canvas, 201, 99);
    };

    test("the traced points are appended after the existing ones, shifted outwards by the gap", () => {
      traceFirstEdge();

      expect(fake.drawing.points).toHaveLength(3);
      expect(fake.drawing.points[0]).toEqual({ x: 1, y: 1 }); // the user's own point is untouched
      expect(fake.drawing.points[1].x).toBeCloseTo(19.9, 6); // 200 px - 1 px = 199 px of 1000
      expect(fake.drawing.points[1].y).toBeCloseTo(19.9, 6);
      expect(fake.drawing.points[2].x).toBeCloseTo(40.1, 6);
      expect(fake.drawing.points[2].y).toBeCloseTo(19.9, 6);
    });

    test("points go in at the end of the list, through insertPoint (never through addPoint, which can close the polygon)", () => {
      traceFirstEdge();

      expect(fake.drawing.insertPoint.mock.calls.map(([index]) => index)).toEqual([1, 2]);
      // percent -> canvas: 19.9% of a 500 px stage is 99.5 px
      expect(fake.drawing.insertPoint.mock.calls[0][1]).toBeCloseTo(99.5, 6);
    });

    test("the whole arc is ONE undo step: the history is frozen around the insertion and released once", () => {
      const order = [];

      fake.history.freeze.mockImplementation(() => order.push("freeze"));
      fake.history.unfreeze.mockImplementation(() => order.push("unfreeze"));
      fake.drawing.insertPoint.mockImplementation((index, x, y) => {
        order.push("insert");
        fake.drawing.points.splice(index, 0, { x, y });
      });
      traceFirstEdge();

      expect(order).toEqual(["freeze", "insert", "insert", "unfreeze"]);
      expect(fake.history.freeze.mock.calls[0]).toEqual(fake.history.unfreeze.mock.calls[0]); // the same lock key
    });

    test("the history is released even if inserting fails", () => {
      // an error inside a DOM listener does not reach the caller; it goes to window "error" (we just catch it here)
      const errors = [];
      const onError = (ev) => {
        errors.push(ev.error?.message);
        ev.preventDefault();
      };

      window.addEventListener("error", onError);
      fake.drawing.insertPoint.mockImplementation(() => {
        throw new Error("boom");
      });
      traceFirstEdge();
      window.removeEventListener("error", onError);

      expect(errors).toEqual(["boom"]);
      expect(fake.history.freeze).toHaveBeenCalledTimes(1);
      expect(fake.history.unfreeze).toHaveBeenCalledTimes(1);
    });

    test("the long arc inserts the other way round", () => {
      key({ code: "Period", key: "." });
      click(fake.canvas, 150, 150);
      click(fake.canvas, 101, 100);
      click(fake.canvas, 201, 99);

      expect(fake.drawing.points).toHaveLength(1 + 4); // #0, #3, #2, #1
    });

    test("a point that lands on the previous one is skipped by insertPoint and is not counted", () => {
      let calls = 0;

      fake.drawing.insertPoint.mockImplementation((index, x, y) => {
        calls++;
        if (calls === 1) return; // the real insertPoint refuses a duplicate of the previous point
        fake.drawing.points.splice(index, 0, { x, y });
      });
      traceFirstEdge();
      expect(logged()).toContain("inserted 1 of 2 points");
    });

    test("the log says how many points were inserted", () => {
      traceFirstEdge();
      expect(logged()).toContain("inserted 2 of 2 points");
    });

    test("apply: false is a dry run: no history lock, no points", () => {
      window.LS_FORK_TOOLS = { traceContour: { apply: false, gapPx: 1 } };
      traceFirstEdge();

      expect(fake.drawing.points).toHaveLength(1);
      expect(fake.history.freeze).not.toHaveBeenCalled();
      expect(logged()).toContain("apply is off");
    });

    test("nothing is inserted into a polygon of another image", () => {
      fake.obj.multiImage = true;
      fake.obj.currentImage = 1;
      fake.drawing.item_index = 0;
      traceFirstEdge();

      expect(fake.drawing.points).toHaveLength(1);
    });

    test("the tool can be used again right after an insertion", () => {
      traceFirstEdge();
      key({ code: "Comma", key: "," });
      expect(logged()).toMatch(/started, arc: SHORT[\s\S]*started, arc: SHORT/);
    });
  });

  describe("overlay", () => {
    const lastView = () => mockOverlay.render.mock.calls.at(-1)[0].view;
    const lastCall = () => mockOverlay.render.mock.calls.at(-1)[0];

    test("nothing is drawn while the flow is idle", () => {
      mouse("mousemove", fake.canvas, 150, 150);
      expect(mockOverlay.render).not.toHaveBeenCalled();
    });

    test("the polygon under the cursor is outlined as soon as the flow starts, even without moving the mouse", () => {
      mouse("mousemove", fake.canvas, 150, 150); // the mouse is already over the neighbour
      key({ code: "Comma", key: "," });

      expect(lastView().vertices).toEqual(square);
      expect(lastCall().stage).toBe(fake.tool.obj.stageRef);
    });

    test("percent of the image are converted to canvas coordinates", () => {
      key({ code: "Comma", key: "," });
      mouse("mousemove", fake.canvas, 150, 150);

      expect(lastCall().toCanvas([20, 40])).toEqual([100, 200]);
    });

    test("the outline follows the cursor and disappears when it leaves the polygon or the image", () => {
      key({ code: "Comma", key: "," });
      mouse("mousemove", fake.canvas, 150, 150);
      expect(lastView().vertices).toEqual(square);

      mouse("mousemove", fake.canvas, 400, 400);
      expect(lastView().vertices).toBeNull();

      const outside = document.createElement("div");

      document.body.appendChild(outside);
      mouse("mousemove", fake.canvas, 150, 150);
      mouse("mousemove", outside, 150, 150);
      expect(lastView().vertices).toBeNull();
    });

    test("the vertex under the cursor and the start vertex are reported", () => {
      key({ code: "Comma", key: "," });
      click(fake.canvas, 150, 150);
      mouse("mousemove", fake.canvas, 101, 100);
      expect(lastView().hoverIndex).toBe(0);

      click(fake.canvas, 101, 100);
      expect(lastView().startIndex).toBe(0);
    });

    test("both arcs are previewed on the last click and the mode key swaps them", () => {
      key({ code: "Comma", key: "," });
      click(fake.canvas, 150, 150);
      click(fake.canvas, 101, 100);
      mouse("mousemove", fake.canvas, 201, 99);

      expect(lastView().arcs.chosen).toHaveLength(2);
      expect(lastView().arcs.other).toHaveLength(4);

      key({ code: "Period", key: "." });
      expect(lastView().arcs.chosen).toHaveLength(4);
      expect(lastView().arcs.other).toHaveLength(2);
    });

    test("the overlay is cleared after the result, on Esc and when the polygon stops being drawn", () => {
      key({ code: "Comma", key: "," });
      click(fake.canvas, 150, 150);
      click(fake.canvas, 101, 100);
      click(fake.canvas, 201, 99);
      expect(mockOverlay.clear).toHaveBeenCalled();

      mockOverlay.clear.mockClear();
      key({ code: "Comma", key: "," });
      key({ code: "Escape", key: "Escape" });
      expect(mockOverlay.clear).toHaveBeenCalled();

      mockOverlay.clear.mockClear();
      key({ code: "Comma", key: "," });
      fake.tool.setDrawing(false);
      click(fake.canvas, 150, 150);
      expect(mockOverlay.clear).toHaveBeenCalled();
    });

    test("showOverlay: false keeps clicks and hotkeys but draws nothing", () => {
      window.LS_FORK_TOOLS = { traceContour: { showOverlay: false } };
      key({ code: "Comma", key: "," });
      mouse("mousemove", fake.canvas, 150, 150);

      expect(mockOverlay.render).not.toHaveBeenCalled();
      click(fake.canvas, 150, 150);
      expect(logged()).toContain("click 1 ok");
    });

    test("destroying the tool destroys the overlay", () => {
      destroy(fake.tool);
      expect(mockOverlay.destroy).toHaveBeenCalled();
      fake.tool = makeFakeTool().tool; // afterEach destroys it
    });
  });
});
