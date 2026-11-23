/**
 * @jest-environment jsdom
 */
/* global describe, test, expect, beforeEach, afterEach, jest */
import { STORAGE_KEY, TRACE_CONTOUR_DEFAULTS, getTraceConfig, installForkToolsSettings } from "../config";
import { DEFAULT_GAP_PX } from "../geometry";

// Every test starts from a clean page: no saved value, and window.LS_FORK_TOOLS installed by the imported module.
beforeEach(() => {
  delete window.LS_FORK_TOOLS;
  window.localStorage.clear();
  installForkToolsSettings();
});

afterEach(() => {
  jest.restoreAllMocks();
});

/** Loads a second copy of the module: what happens when the page is loaded again. */
function loadFreshConfig() {
  let loaded;

  jest.isolateModules(() => {
    // eslint-disable-next-line global-require
    loaded = require("../config");
  });

  return loaded;
}

/** Simulates a page reload: the property is gone, only localStorage survives. */
function reloadPage() {
  delete window.LS_FORK_TOOLS;

  return loadFreshConfig();
}

describe("trace-contour config", () => {
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

describe("trace-contour config: saved settings", () => {
  test("an assigned object is written to localStorage", () => {
    window.LS_FORK_TOOLS = { traceContour: { gapPx: 0.5 } };

    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY))).toEqual({ traceContour: { gapPx: 0.5 } });
  });

  test("reading window.LS_FORK_TOOLS returns what was assigned", () => {
    window.LS_FORK_TOOLS = { traceContour: { gapPx: 0.5 } };

    expect(window.LS_FORK_TOOLS).toEqual({ traceContour: { gapPx: 0.5 } });
  });

  test("the saved value is restored after a page reload", () => {
    window.LS_FORK_TOOLS = { traceContour: { gapPx: 0.5, showOverlay: false } };

    const fresh = reloadPage();

    expect(window.LS_FORK_TOOLS).toEqual({ traceContour: { gapPx: 0.5, showOverlay: false } });
    expect(fresh.getTraceConfig()).toMatchObject({ gapPx: 0.5, showOverlay: false, enabled: true });
  });

  test("assigning null clears the saved value and restores the defaults", () => {
    window.LS_FORK_TOOLS = { traceContour: { gapPx: 0.5 } };
    window.LS_FORK_TOOLS = null;

    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(getTraceConfig().gapPx).toBe(0.7);
    expect(reloadPage().getTraceConfig().gapPx).toBe(0.7);
  });

  test("assigning undefined clears the saved value too", () => {
    window.LS_FORK_TOOLS = { traceContour: { gapPx: 0.5 } };
    window.LS_FORK_TOOLS = undefined;

    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(getTraceConfig().gapPx).toBe(0.7);
  });

  test("a new assignment replaces the previous one completely", () => {
    window.LS_FORK_TOOLS = { traceContour: { gapPx: 0.5, enabled: false } };
    window.LS_FORK_TOOLS = { traceContour: { gapPx: 2 } };

    expect(getTraceConfig()).toMatchObject({ gapPx: 2, enabled: true });
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY))).toEqual({ traceContour: { gapPx: 2 } });
  });

  test("a value assigned before the module loaded is kept and saved", () => {
    delete window.LS_FORK_TOOLS;
    window.LS_FORK_TOOLS = { traceContour: { gapPx: 3 } };

    const fresh = loadFreshConfig();

    expect(fresh.getTraceConfig().gapPx).toBe(3);
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY))).toEqual({ traceContour: { gapPx: 3 } });
  });

  test("a value assigned before the module loaded wins over the saved one", () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ traceContour: { gapPx: 9 } }));
    delete window.LS_FORK_TOOLS;
    window.LS_FORK_TOOLS = { traceContour: { gapPx: 3 } };

    expect(loadFreshConfig().getTraceConfig().gapPx).toBe(3);
  });

  test("a non-object assignment is kept for the page but never saved", () => {
    window.LS_FORK_TOOLS = { traceContour: { gapPx: 0.5 } };
    window.LS_FORK_TOOLS = "nonsense";

    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(getTraceConfig().gapPx).toBe(0.7);
  });

  test("installing twice does not lose the value", () => {
    window.LS_FORK_TOOLS = { traceContour: { gapPx: 0.5 } };
    installForkToolsSettings();

    expect(window.LS_FORK_TOOLS).toEqual({ traceContour: { gapPx: 0.5 } });
  });

  test("a property somebody else defined with a getter is left alone", () => {
    delete window.LS_FORK_TOOLS;
    Object.defineProperty(window, "LS_FORK_TOOLS", {
      configurable: true,
      get: () => ({ traceContour: { gapPx: 9 } }),
    });

    const fresh = loadFreshConfig();

    expect(fresh.getTraceConfig().gapPx).toBe(9);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});

describe("trace-contour config: bad data and broken storage", () => {
  test("broken JSON in localStorage is ignored", () => {
    window.localStorage.setItem(STORAGE_KEY, "{not json");

    const fresh = reloadPage();

    expect(fresh.getTraceConfig()).toEqual(TRACE_CONTOUR_DEFAULTS);
  });

  test.each(["[1,2,3]", "5", '"text"', "null"])("a saved value that is not an object (%s) is ignored", (raw) => {
    window.localStorage.setItem(STORAGE_KEY, raw);

    expect(reloadPage().getTraceConfig()).toEqual(TRACE_CONTOUR_DEFAULTS);
  });

  test("a saved object without traceContour changes nothing", () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ somethingElse: { gapPx: 5 } }));

    expect(reloadPage().getTraceConfig()).toEqual(TRACE_CONTOUR_DEFAULTS);
  });

  test("values of the wrong type are ignored, the right ones are kept", () => {
    window.LS_FORK_TOOLS = {
      traceContour: { gapPx: "0.5", enabled: "no", showOverlay: false, clickMovePx: 8 },
    };

    expect(getTraceConfig()).toMatchObject({ gapPx: 0.7, enabled: true, showOverlay: false, clickMovePx: 8 });
  });

  test("NaN and Infinity are ignored for numbers", () => {
    window.LS_FORK_TOOLS = { traceContour: { gapPx: Number.NaN, pickRadiusScreenPx: Number.POSITIVE_INFINITY } };

    expect(getTraceConfig()).toMatchObject({ gapPx: 0.7, pickRadiusScreenPx: 12 });
  });

  test("unknown settings are ignored", () => {
    window.LS_FORK_TOOLS = { traceContour: { gapPx: 1, notASetting: 123 } };

    expect(getTraceConfig()).toEqual({ ...TRACE_CONTOUR_DEFAULTS, gapPx: 1 });
  });

  test("traceContour that is not an object is ignored", () => {
    window.LS_FORK_TOOLS = { traceContour: "yes" };

    expect(getTraceConfig()).toEqual(TRACE_CONTOUR_DEFAULTS);
  });

  test("when writing to localStorage fails, the setting still works for the page", () => {
    jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });

    expect(() => {
      window.LS_FORK_TOOLS = { traceContour: { gapPx: 0.5 } };
    }).not.toThrow();
    expect(getTraceConfig().gapPx).toBe(0.5);
  });

  test("when reading from localStorage fails, the defaults are used", () => {
    jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });

    expect(reloadPage().getTraceConfig()).toEqual(TRACE_CONTOUR_DEFAULTS);
  });

  test("a circular object is kept for the page but not saved, and does not throw", () => {
    const circular = { traceContour: { gapPx: 0.5 } };

    circular.self = circular;
    window.LS_FORK_TOOLS = { traceContour: { gapPx: 2 } };

    expect(() => {
      window.LS_FORK_TOOLS = circular;
    }).not.toThrow();
    expect(getTraceConfig().gapPx).toBe(0.5);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});
