/**
 * Trace-contour: settings and the on/off switch.
 *
 * Defaults live here. They can be overridden at runtime, without rebuilding, from the browser console
 * or from any script that runs before the editor starts:
 *
 *   window.LS_FORK_TOOLS = { traceContour: { enabled: false } };   // switch the tool off
 *   window.LS_FORK_TOOLS = { traceContour: { gapPx: 2 } };         // gap of 2 px of the original image
 *   window.LS_FORK_TOOLS = null;                                   // back to the defaults
 *
 * The values are read on every use, so a change made in the console takes effect immediately.
 *
 * The assigned object is also saved in the browser's localStorage (key "ls-fork-tools") and restored on the next
 * page load, so a setting survives a reload. To make this work, window.LS_FORK_TOOLS is turned into a property with
 * a setter when this module loads. Notes:
 *   - assign the WHOLE object; changing a nested field (window.LS_FORK_TOOLS.traceContour.gapPx = 1) works for the
 *     current page only and is not saved;
 *   - localStorage belongs to one site address (host and port) in one browser;
 *   - if localStorage is unavailable or holds garbage, the tool silently falls back to the defaults.
 */
import { DEFAULT_GAP_PX, DEFAULT_MITER_LIMIT } from "./geometry";

export const STORAGE_KEY = "ls-fork-tools";
const GLOBAL_NAME = "LS_FORK_TOOLS";

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
  // Insert the traced points into the polygon. false = a dry run: everything works, the result only goes to the console.
  apply: true,
  // Draw the neighbour's vertices and the arc preview over the image. false = clicks and hotkeys only.
  showOverlay: true,
  // Write what the tool is doing to the browser console (prefix "[trace-contour]").
  debug: true,
};

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** localStorage, or null when it is missing or access to it throws (blocked cookies, private mode, ...). */
function getStorage() {
  try {
    return typeof window !== "undefined" && window.localStorage ? window.localStorage : null;
  } catch (e) {
    return null;
  }
}

function readStored() {
  const storage = getStorage();

  if (!storage) return undefined;

  try {
    const raw = storage.getItem(STORAGE_KEY);

    if (!raw) return undefined;

    const parsed = JSON.parse(raw);

    return isPlainObject(parsed) ? parsed : undefined;
  } catch (e) {
    return undefined;
  }
}

/** Saves a plain object; anything else (null, undefined, a string, ...) clears the saved value. */
function writeStored(value) {
  const storage = getStorage();

  if (!storage) return;

  let json;

  try {
    json = isPlainObject(value) ? JSON.stringify(value) : undefined;
  } catch (e) {
    json = undefined; // for example a circular structure
  }

  try {
    if (json === undefined) storage.removeItem(STORAGE_KEY);
    else storage.setItem(STORAGE_KEY, json);
  } catch (e) {
    // The quota is exceeded or storage is read-only: the setting still works until the page is reloaded.
  }
}

/**
 * Turns window.LS_FORK_TOOLS into a property that saves every assignment to localStorage.
 *
 * - If the property already holds a value (the console or a script set it before this module loaded), that value is
 *   treated as an assignment: it is kept and saved.
 * - Otherwise the value is restored from localStorage.
 * - If somebody else already defined an accessor or a non-configurable property under this name, it is left alone.
 * - Calling this twice is safe.
 */
export function installForkToolsSettings() {
  if (typeof window === "undefined") return;

  const descriptor = Object.getOwnPropertyDescriptor(window, GLOBAL_NAME);

  if (descriptor && (descriptor.get || descriptor.set || descriptor.configurable === false)) return;

  const preset = descriptor ? descriptor.value : undefined;
  let current = preset !== undefined ? preset : readStored();

  if (preset !== undefined) writeStored(preset);

  try {
    Object.defineProperty(window, GLOBAL_NAME, {
      configurable: true,
      enumerable: true,
      get() {
        return current;
      },
      set(value) {
        current = value;
        writeStored(value);
      },
    });
  } catch (e) {
    // Could not install the setter: the settings still work from window.LS_FORK_TOOLS, they just are not saved.
  }
}

/** Keeps only the overrides that are known settings of the right type; the rest is ignored. */
function pickValid(overrides) {
  const valid = {};

  if (!isPlainObject(overrides)) return valid;

  for (const key of Object.keys(TRACE_CONTOUR_DEFAULTS)) {
    if (!(key in overrides)) continue;

    const value = overrides[key];
    const expectedType = typeof TRACE_CONTOUR_DEFAULTS[key];

    if (typeof value !== expectedType) continue;
    if (expectedType === "number" && !Number.isFinite(value)) continue;

    valid[key] = value;
  }

  return valid;
}

export function getTraceConfig() {
  const overrides = typeof window !== "undefined" ? window[GLOBAL_NAME]?.traceContour : undefined;

  return { ...TRACE_CONTOUR_DEFAULTS, ...pickValid(overrides) };
}

installForkToolsSettings();
