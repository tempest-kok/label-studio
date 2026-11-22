/* global describe, test, expect */
import { PATH_MODE } from "../geometry";
import { STAGE, createTraceFlow } from "../flow";

const W = 1000;
const H = 1000;
const neighbour = { id: "n", points: [[20, 20], [40, 20], [40, 40], [20, 40]] };
const big = { id: "big", points: [[0, 0], [100, 0], [100, 100], [0, 100]] };

const base = { polygons: [big, neighbour], width: W, height: H, pickRadiusImagePx: 10, gapPx: 2 };
const click = (flow, point, extra = {}) => flow.click({ ...base, point, ...extra });

// Walks the flow up to the state "waiting for the end vertex"; vertex `a` is index 0 = (20%, 20%).
const toPickEnd = (mode = PATH_MODE.SHORT) => {
  const flow = createTraceFlow();

  flow.press(mode);
  click(flow, [30, 30]);
  click(flow, [20.3, 20.2]);
  return flow;
};

describe("trace flow: states", () => {
  test("starts idle and ignores clicks", () => {
    const flow = createTraceFlow();

    expect(flow.stage).toBe(STAGE.IDLE);
    expect(click(flow, [30, 30]).type).toBe("ignored");
  });

  test("press starts the flow with the chosen mode", () => {
    const flow = createTraceFlow();

    expect(flow.press(PATH_MODE.LONG)).toEqual({ type: "started", mode: PATH_MODE.LONG });
    expect(flow.stage).toBe(STAGE.PICK_POLYGON);
    expect(flow.mode).toBe(PATH_MODE.LONG);
  });

  test("press inside the flow only switches the mode", () => {
    const flow = toPickEnd(PATH_MODE.SHORT);

    expect(flow.press(PATH_MODE.LONG)).toEqual({ type: "mode", mode: PATH_MODE.LONG });
    expect(flow.stage).toBe(STAGE.PICK_END);
  });

  test("cancel resets everything", () => {
    const flow = toPickEnd();

    expect(flow.cancel()).toEqual({ type: "cancelled", wasActive: true });
    expect(flow.stage).toBe(STAGE.IDLE);
    expect(flow.picked).toBeNull();
    expect(flow.startIndex).toBeNull();
    expect(flow.cancel().wasActive).toBe(false);
  });
});

describe("trace flow: click 1 (polygon)", () => {
  test("the smallest polygon under the cursor wins", () => {
    const flow = createTraceFlow();

    flow.press(PATH_MODE.SHORT);
    expect(click(flow, [30, 30])).toEqual({ type: "polygon-picked", id: "n", vertexCount: 4 });
    expect(flow.stage).toBe(STAGE.PICK_START);
  });

  test("a click on empty space is a miss and keeps the stage", () => {
    const flow = createTraceFlow();

    flow.press(PATH_MODE.SHORT);
    expect(click(flow, [30, 30], { polygons: [neighbour] }).type).toBe("polygon-picked");
    const second = createTraceFlow();

    second.press(PATH_MODE.SHORT);
    expect(click(second, [70, 70], { polygons: [neighbour] })).toEqual({ type: "miss", reason: "no-polygon" });
    expect(second.stage).toBe(STAGE.PICK_POLYGON);
  });

  test("degenerate polygons (fewer than 3 vertices) are skipped", () => {
    const flow = createTraceFlow();

    flow.press(PATH_MODE.SHORT);
    expect(click(flow, [30, 30], { polygons: [{ id: "x", points: [[20, 20], [40, 40]] }] }).type).toBe("miss");
  });
});

describe("trace flow: click 2 and 3 (vertices)", () => {
  test("start vertex is the nearest one within the radius", () => {
    const flow = createTraceFlow();

    flow.press(PATH_MODE.SHORT);
    click(flow, [30, 30]);
    expect(click(flow, [20.3, 20.2])).toEqual({ type: "start-picked", index: 0 });
    expect(flow.stage).toBe(STAGE.PICK_END);
  });

  test("a click far from every vertex is a miss", () => {
    const flow = createTraceFlow();

    flow.press(PATH_MODE.SHORT);
    click(flow, [30, 30]);
    expect(click(flow, [30, 30])).toEqual({ type: "miss", reason: "no-vertex" });
    expect(flow.stage).toBe(STAGE.PICK_START);
  });

  test("the end vertex cannot be the start vertex", () => {
    const flow = toPickEnd();

    expect(click(flow, [20.1, 20.1])).toEqual({ type: "miss", reason: "same-vertex" });
    expect(flow.stage).toBe(STAGE.PICK_END);
  });
});

describe("trace flow: result", () => {
  test("short arc between neighbouring vertices", () => {
    const flow = toPickEnd(PATH_MODE.SHORT);
    const event = click(flow, [40.2, 19.8]); // vertex 1 = (40%, 20%)

    expect(event.type).toBe("done");
    expect(event.polygonId).toBe("n");
    expect(event.indices).toEqual([0, 1]);
    expect(event.points).toHaveLength(2);
    expect(flow.stage).toBe(STAGE.IDLE);
  });

  test("long arc goes the other way round the ring", () => {
    const flow = toPickEnd(PATH_MODE.LONG);
    const event = click(flow, [40.2, 19.8]);

    expect(event.indices).toEqual([0, 3, 2, 1]);
    expect(event.points).toHaveLength(4);
  });

  test("switching the mode before click 3 changes the arc", () => {
    const flow = toPickEnd(PATH_MODE.SHORT);

    flow.press(PATH_MODE.LONG);
    expect(click(flow, [40.2, 19.8]).indices).toEqual([0, 3, 2, 1]);
  });

  test("traced points lie outside the neighbour by the gap", () => {
    const flow = toPickEnd(PATH_MODE.SHORT);
    const { points } = click(flow, [40.2, 19.8], { gapPx: 5 });

    // vertex (20%, 20%) of a 1000 px image is (200, 200) px; the gap pushes it out to (195, 195) px = 19.5%
    expect(points[0][0]).toBeCloseTo(19.5, 5);
    expect(points[0][1]).toBeCloseTo(19.5, 5);
  });

  test("the flow can be reused right after a result", () => {
    const flow = toPickEnd();

    click(flow, [40.2, 19.8]);
    expect(flow.press(PATH_MODE.LONG).type).toBe("started");
  });
});

describe("trace flow: preview (what the overlay shows)", () => {
  const view = (flow, point, extra = {}) => flow.preview({ ...base, point, ...extra });

  test("nothing to show while idle", () => {
    expect(view(createTraceFlow(), [30, 30])).toBeNull();
  });

  test("before click 1 the polygon under the cursor is shown, nothing outside", () => {
    const flow = createTraceFlow();

    flow.press(PATH_MODE.SHORT);
    expect(view(flow, [30, 30]).vertices).toEqual(neighbour.points);
    expect(view(flow, [70, 70], { polygons: [neighbour] }).vertices).toBeNull();
    expect(view(flow, null).vertices).toBeNull();
  });

  test("before click 1 the smallest polygon under the cursor is shown", () => {
    const flow = createTraceFlow();

    flow.press(PATH_MODE.SHORT);
    expect(view(flow, [30, 30]).vertices).toEqual(neighbour.points);
    expect(view(flow, [70, 70]).vertices).toEqual(big.points);
  });

  test("after click 1 the picked polygon stays shown and the vertex under the cursor is marked", () => {
    const flow = createTraceFlow();

    flow.press(PATH_MODE.SHORT);
    click(flow, [30, 30]);

    expect(view(flow, [70, 70]).vertices).toEqual(neighbour.points); // cursor left the polygon, it stays
    expect(view(flow, [70, 70]).hoverIndex).toBeNull();
    expect(view(flow, [40.1, 40.1]).hoverIndex).toBe(2);
    expect(view(flow, [40.1, 40.1]).arcs).toBeNull(); // no start vertex yet
  });

  test("after click 2 the start vertex is reported", () => {
    const flow = toPickEnd();

    expect(view(flow, null).startIndex).toBe(0);
  });

  test("in the last stage both arcs are previewed, the chosen one follows the mode", () => {
    const flow = toPickEnd(PATH_MODE.SHORT);
    const short = view(flow, [40.2, 19.8]);

    expect(short.hoverIndex).toBe(1);
    expect(short.arcs.chosen).toHaveLength(2);
    expect(short.arcs.other).toHaveLength(4);

    flow.press(PATH_MODE.LONG);
    const long = view(flow, [40.2, 19.8]);

    expect(long.arcs.chosen).toHaveLength(4);
    expect(long.arcs.other).toHaveLength(2);
    expect(long.arcs.chosen).toEqual(short.arcs.other);
  });

  test("the preview is exactly what the third click would insert", () => {
    const flow = toPickEnd(PATH_MODE.LONG);
    const preview = view(flow, [40.2, 19.8]).arcs.chosen;

    expect(click(flow, [40.2, 19.8]).points).toEqual(preview);
  });

  test("hovering the start vertex itself gives no arcs", () => {
    const flow = toPickEnd();
    const hover = view(flow, [20.1, 20.1]);

    expect(hover.hoverIndex).toBe(0);
    expect(hover.arcs).toBeNull();
  });

  test("preview does not change the flow state", () => {
    const flow = toPickEnd();

    view(flow, [40.2, 19.8]);
    expect(flow.stage).toBe(STAGE.PICK_END);
    expect(flow.startIndex).toBe(0);
  });
});
