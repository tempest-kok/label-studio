/**
 * @jest-environment jsdom
 */
/* global describe, test, expect, beforeEach */
import { TRACE_CONTOUR_DEFAULTS, getTraceConfig } from "../config";
import { DEFAULT_GAP_PX } from "../geometry";

describe("trace-contour config", () => {
  beforeEach(() => {
    window.LS_FORK_TOOLS = undefined;
  });

  test("the default gap is 0.7 px of the original image", () => {
    expect(DEFAULT_GAP_PX).toBe(0.7);
    expect(getTraceConfig().gapPx).toBe(0.7);
  });

  test("the tool is on by default", () => {
    expect(getTraceConfig()).toMatchObject({ enabled: true, apply: true, showOverlay: true });
  });

  test("window.LS_FORK_TOOLS overrides single values and keeps the rest", () => {
    window.LS_FORK_TOOLS = { traceContour: { gapPx: 0.5, enabled: false } };

    expect(getTraceConfig()).toMatchObject({ gapPx: 0.5, enabled: false, apply: true });
  });

  test("the defaults object itself is never modified by overrides", () => {
    window.LS_FORK_TOOLS = { traceContour: { gapPx: 3 } };
    getTraceConfig();

    expect(TRACE_CONTOUR_DEFAULTS.gapPx).toBe(0.7);
  });

  test("the overrides are read on every call, so a console change works at once", () => {
    expect(getTraceConfig().gapPx).toBe(0.7);
    window.LS_FORK_TOOLS = { traceContour: { gapPx: 2 } };
    expect(getTraceConfig().gapPx).toBe(2);
  });
});
