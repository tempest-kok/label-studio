/* global describe, test, expect */
import {
  PATH_MODE,
  arcIndices,
  choosePath,
  nearestVertex,
  offsetRing,
  pathLength,
  pointInPolygon,
  polygonArea,
  signedArea,
  toPercent,
  toPixels,
  traceContour,
} from "../geometry";

// 100x100 square, counter-clockwise in math terms (positive signed area)
const squareCCW = [
  [0, 0],
  [100, 0],
  [100, 100],
  [0, 100],
];
const squareCW = [...squareCCW].reverse();

// regular ring of n vertices on a circle (used for path selection tests)
const circle = (n, r = 100) =>
  Array.from({ length: n }, (_, i) => [r * Math.cos((2 * Math.PI * i) / n), r * Math.sin((2 * Math.PI * i) / n)]);

const closeTo = (actual, expected, digits = 6) => {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((value, i) => expect(value).toBeCloseTo(expected[i], digits));
};

describe("percent <-> pixels", () => {
  test("converts each axis by its own image size", () => {
    expect(toPixels([[50, 10]], 200, 100)).toEqual([[100, 10]]);
    expect(toPercent([[100, 10]], 200, 100)).toEqual([[50, 10]]);
  });

  test("round trip keeps the points", () => {
    const pct = [
      [12.5, 33.3],
      [99, 0.5],
    ];
    const back = toPercent(toPixels(pct, 1920, 1080), 1920, 1080);

    back.forEach((p, i) => closeTo(p, pct[i]));
  });
});

describe("area and containment", () => {
  test("signed area flips with orientation, abs area does not", () => {
    expect(signedArea(squareCCW)).toBe(10000);
    expect(signedArea(squareCW)).toBe(-10000);
    expect(polygonArea(squareCW)).toBe(10000);
  });

  test("pointInPolygon", () => {
    expect(pointInPolygon([50, 50], squareCCW)).toBe(true);
    expect(pointInPolygon([150, 50], squareCCW)).toBe(false);
    expect(pointInPolygon([-1, 50], squareCW)).toBe(false);
  });

  test("nearestVertex respects the radius", () => {
    expect(nearestVertex(squareCCW, [98, 3])).toEqual({ index: 1, distance: Math.hypot(2, 3) });
    expect(nearestVertex(squareCCW, [50, 50], 10)).toBeNull();
  });
});

describe("arcs", () => {
  test("arcIndices walks with wrap-around in both directions", () => {
    expect(arcIndices(10, 8, 1, 1)).toEqual([8, 9, 0, 1]);
    expect(arcIndices(10, 1, 8, -1)).toEqual([1, 0, 9, 8]);
  });

  test("short arc has fewer vertices, long arc is the way round", () => {
    const ring = circle(10);

    expect(choosePath(ring, 0, 3, PATH_MODE.SHORT)).toEqual([0, 1, 2, 3]);
    expect(choosePath(ring, 0, 3, PATH_MODE.LONG)).toEqual([0, 9, 8, 7, 6, 5, 4, 3]);
  });

  test("direction follows from -> to, whatever the indices order", () => {
    const ring = circle(10);

    expect(choosePath(ring, 3, 0, PATH_MODE.SHORT)).toEqual([3, 2, 1, 0]);
    expect(choosePath(ring, 3, 0, PATH_MODE.LONG)).toEqual([3, 4, 5, 6, 7, 8, 9, 0]);
  });

  test("short arc may wrap around the ring start", () => {
    const ring = circle(10);

    expect(choosePath(ring, 8, 1, PATH_MODE.SHORT)).toEqual([8, 9, 0, 1]);
  });

  test("equal vertex counts: geometrically shorter arc is the short one", () => {
    // 6 vertices, from 0 to 3: both arcs have 4 vertices.
    // Forward 0-1-2-3 makes a big detour, backward 0-5-4-3 goes straight.
    const ring = [
      [0, 0],
      [300, 300],
      [600, 300],
      [600, 0],
      [400, 0],
      [200, 0],
    ];

    expect(choosePath(ring, 0, 3, PATH_MODE.SHORT)).toEqual([0, 5, 4, 3]);
    expect(choosePath(ring, 0, 3, PATH_MODE.LONG)).toEqual([0, 1, 2, 3]);
    expect(pathLength(ring, [0, 5, 4, 3])).toBe(600);
  });

  test("degenerate input gives null", () => {
    const ring = circle(5);

    expect(choosePath(ring, 2, 2, PATH_MODE.SHORT)).toBeNull();
    expect(choosePath(ring, -1, 2, PATH_MODE.SHORT)).toBeNull();
    expect(choosePath(ring, 0, 5, PATH_MODE.SHORT)).toBeNull();
    expect(choosePath([[0, 0], [1, 1]], 0, 1, PATH_MODE.SHORT)).toBeNull();
  });
});

describe("offsetRing", () => {
  test.each([
    ["CCW", squareCCW],
    ["CW", squareCW],
  ])("moves a %s square corners outward on the diagonal", (_, ring) => {
    const shifted = offsetRing(ring, 2);

    ring.forEach(([x, y], i) => {
      const expectedX = x === 0 ? -2 : 102;
      const expectedY = y === 0 ? -2 : 102;

      closeTo(shifted[i], [expectedX, expectedY]);
    });
  });

  test("collinear vertices move exactly `distance` along the normal", () => {
    // bottom edge of a polygon, interior above (y < 100), outward is +y
    const ring = [
      [0, 0],
      [100, 0],
      [100, 100],
      [50, 100],
      [0, 100],
    ];
    const shifted = offsetRing(ring, 2);

    closeTo(shifted[3], [50, 102]);
  });

  test("concave corner is offset to the intersection of the shifted edges", () => {
    // L-shape; vertex (50, 50) is the concave corner
    const ring = [
      [0, 0],
      [100, 0],
      [100, 50],
      [50, 50],
      [50, 100],
      [0, 100],
    ];
    const shifted = offsetRing(ring, 2);

    closeTo(shifted[3], [52, 52]);
  });

  test("sharp spike is limited by the miter limit", () => {
    const spike = [
      [0, 0],
      [1000, 5],
      [0, 10],
    ];
    const [x, y] = offsetRing(spike, 2, 4)[1];

    expect(Math.hypot(x - 1000, y - 5)).toBeLessThanOrEqual(2 * 4 + 1e-6);
  });

  test("duplicate consecutive vertices do not produce NaN", () => {
    const ring = [
      [0, 0],
      [100, 0],
      [100, 0],
      [100, 100],
      [0, 100],
    ];

    offsetRing(ring, 2).forEach((p) => p.forEach((v) => expect(Number.isFinite(v)).toBe(true)));
  });
});

describe("traceContour", () => {
  // neighbour square occupying 25..75 % on a 200x100 px image
  const ring = [
    [25, 25],
    [75, 25],
    [75, 75],
    [25, 75],
  ];

  test("returns the arc, shifted by gap in IMAGE pixels on each axis", () => {
    const { indices, points } = traceContour({ ring, width: 200, height: 100, from: 0, to: 1, gapPx: 2 });

    expect(indices).toEqual([0, 1]);
    // vertex (25%,25%) = (50px,25px) -> (48px,23px) = (24%, 23%)
    closeTo(points[0], [24, 23]);
    // vertex (75%,25%) = (150px,25px) -> (152px,23px) = (76%, 23%)
    closeTo(points[1], [76, 23]);
  });

  test("short and long modes give different arcs of the same ring", () => {
    const short = traceContour({ ring, width: 200, height: 100, from: 0, to: 1, mode: PATH_MODE.SHORT });
    const long = traceContour({ ring, width: 200, height: 100, from: 0, to: 1, mode: PATH_MODE.LONG });

    expect(short.indices).toEqual([0, 1]);
    expect(long.indices).toEqual([0, 3, 2, 1]);
  });

  test("does not mutate the input ring", () => {
    const copy = JSON.parse(JSON.stringify(ring));

    traceContour({ ring, width: 200, height: 100, from: 0, to: 2 });
    expect(ring).toEqual(copy);
  });

  test("clamps points to the image by default, and can be switched off", () => {
    const edgeRing = [
      [0, 0],
      [50, 0],
      [50, 50],
      [0, 50],
    ];
    const clamped = traceContour({ ring: edgeRing, width: 100, height: 100, from: 0, to: 1, gapPx: 2 });
    const free = traceContour({ ring: edgeRing, width: 100, height: 100, from: 0, to: 1, gapPx: 2, clampToImage: false });

    closeTo(clamped.points[0], [0, 0]);
    expect(free.points[0][0]).toBeLessThan(0);
  });

  test("returns null for the same start and end vertex", () => {
    expect(traceContour({ ring, width: 200, height: 100, from: 2, to: 2 })).toBeNull();
  });

  test("the traced points stay outside the neighbour", () => {
    const { points } = traceContour({ ring, width: 200, height: 100, from: 0, to: 3, mode: PATH_MODE.LONG });
    const neighbourPx = toPixels(ring, 200, 100);

    toPixels(points, 200, 100).forEach((p) => expect(pointInPolygon(p, neighbourPx)).toBe(false));
  });
});
