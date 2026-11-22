/**
 * @jest-environment jsdom
 */
/* global describe, test, expect, beforeEach, afterEach, jest */
import { destroy, types } from "mobx-state-tree";

import { TraceMixin } from "../TraceMixin";

// The real module drags half of the editor in; the mixin needs only these two names.
jest.mock("../../../utils/feature-flags", () => ({ FF_DEV_3793: "ff_3793", isFF: () => true }));

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
  };
  const drawing = { type: "polygonregion", id: "drawing", closed: false, parent: obj, points: [{ x: 1, y: 1 }] };
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
      annotation: { isReadOnly: () => false, regions: [drawing, neighbour] },
    }))
    .actions((self) => ({
      setDrawing(value) {
        self.isDrawing = value;
      },
    }));
  const tool = types.compose("Tool", Fake, TraceMixin).create({});

  return { tool, container, canvas };
};

const key = (init, target = document.body) => {
  const ev = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });

  target.dispatchEvent(ev);
  return ev;
};

const mouse = (type, target, clientX, clientY, extra = {}) => {
  const ev = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX, clientY, ...extra });

  target.dispatchEvent(ev);
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

  beforeEach(() => {
    window.LS_FORK_TOOLS = undefined;
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
});
