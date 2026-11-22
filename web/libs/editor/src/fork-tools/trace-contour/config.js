/**
 * Trace-contour: settings and the on/off switch.
 *
 * Defaults live here. They can be overridden at runtime, without rebuilding, from the browser console
 * or from any script that runs before the editor starts:
 *
 *   window.LS_FORK_TOOLS = { traceContour: { enabled: false } };   // switch the tool off
 *   window.LS_FORK_TOOLS = { traceContour: { gapPx: 3 } };         // gap of 3 px of the original image
 *
 * The values are read on every use, so a change made in the console takes effect immediately.
 */
import { DEFAULT_GAP_PX, DEFAULT_MITER_LIMIT } from "./geometry";

export const TRACE_CONTOUR_DEFAULTS = {
  // Master switch. When false the tool does nothing: no hotkeys, no click interception.
  enabled: true,
  // Gap between the traced polygon and the neighbour, in pixels of the ORIGINAL image.
  gapPx: DEFAULT_GAP_PX,
  // Limit for sharp corners when the contour is shifted outwards (1 = no extension at all).
  miterLimit: DEFAULT_MITER_LIMIT,
  // How close to a vertex a click must be to select it, in SCREEN pixels (so it does not depend on zoom).
  pickRadiusScreenPx: 12,
  // A press-release that moved by more than this many screen pixels is a drag, not a click.
  clickMovePx: 5,
  // Write what the tool is doing to the browser console (prefix "[trace-contour]").
  debug: true,
};

export function getTraceConfig() {
  const overrides = (typeof window !== "undefined" && window.LS_FORK_TOOLS?.traceContour) || {};

  return { ...TRACE_CONTOUR_DEFAULTS, ...overrides };
}
