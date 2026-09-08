(() => {
  "use strict";

  const root = globalThis;
  const CrackModules = root.CrackModules = root.CrackModules || {};
  if (CrackModules.Viewport) return;

  const log = CrackModules.Logger?.create?.("Viewport") || console;
  const changeListeners = new Set();
  const keyboardListeners = new Set();

  let started = false;
  let lastState = null;

  function readState() {
    const vv = root.visualViewport;
    const layoutWidth = root.innerWidth;
    const layoutHeight = root.innerHeight;
    const width = vv?.width ?? layoutWidth;
    const height = vv?.height ?? layoutHeight;
    const offsetTop = vv?.offsetTop ?? 0;
    const offsetLeft = vv?.offsetLeft ?? 0;
    const scale = vv?.scale ?? 1;

    const keyboardHeight = Math.max(0, layoutHeight - height - offsetTop);
    const keyboardVisible =
      keyboardHeight >= 120 &&
      height <= layoutHeight * 0.82;

    return {
      width,
      height,
      layoutWidth,
      layoutHeight,
      offsetTop,
      offsetLeft,
      scale,
      keyboardVisible,
      keyboardHeight,
      orientation: width >= height ? "landscape" : "portrait",
      at: Date.now()
    };
  }

  function equalImportant(a, b) {
    if (!a || !b) return false;
    return a.width === b.width &&
      a.height === b.height &&
      a.layoutWidth === b.layoutWidth &&
      a.layoutHeight === b.layoutHeight &&
      a.offsetTop === b.offsetTop &&
      a.scale === b.scale &&
      a.keyboardVisible === b.keyboardVisible &&
      a.keyboardHeight === b.keyboardHeight;
  }

  function notify(reason) {
    const next = readState();
    const previous = lastState;
    if (equalImportant(previous, next)) return;

    lastState = next;
    const payload = { ...next, previous, reason };

    for (const callback of [...changeListeners]) {
      try { callback(payload); } catch (error) { console.error("[Crack:Viewport] listener error", error); }
    }
    CrackModules.Events?.emit?.("viewport:change", payload);

    if (!previous || previous.keyboardVisible !== next.keyboardVisible) {
      for (const callback of [...keyboardListeners]) {
        try { callback(payload); } catch (error) { console.error("[Crack:Viewport] keyboard listener error", error); }
      }
      CrackModules.Events?.emit?.("viewport:keyboard", payload);
    }
  }

  function onResize() { notify("resize"); }
  function onScroll() { notify("visualViewport.scroll"); }

  function start() {
    if (started) return false;
    lastState = readState();

    root.addEventListener("resize", onResize, { passive: true });
    root.visualViewport?.addEventListener("resize", onResize, { passive: true });
    root.visualViewport?.addEventListener("scroll", onScroll, { passive: true });

    started = true;
    log.info?.("started");
    return true;
  }

  function stop() {
    if (!started) return false;

    root.removeEventListener("resize", onResize);
    root.visualViewport?.removeEventListener("resize", onResize);
    root.visualViewport?.removeEventListener("scroll", onScroll);

    started = false;
    log.info?.("stopped");
    return true;
  }

  CrackModules.Viewport = {
    start,
    stop,
    isStarted: () => started,
    getState: readState,
    onChange(callback) {
      changeListeners.add(callback);
      return () => changeListeners.delete(callback);
    },
    onKeyboard(callback) {
      keyboardListeners.add(callback);
      return () => keyboardListeners.delete(callback);
    }
  };
})();