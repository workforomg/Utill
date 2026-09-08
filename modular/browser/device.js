(() => {
  "use strict";

  const root = globalThis;
  const CrackModules = root.CrackModules = root.CrackModules || {};
  if (CrackModules.Device) return;

  const log = CrackModules.Logger?.create?.("Device") || console;
  const listeners = new Set();
  let started = false;
  let lastSignature = "";

  function getInfo() {
    const ua = navigator.userAgent || "";
    const uaDataMobile = navigator.userAgentData?.mobile;
    const touchPoints = navigator.maxTouchPoints || 0;
    const minSide = Math.min(screen.width || innerWidth, screen.height || innerHeight);

    const mobileUA = /Android|iPhone|iPod|Mobile/i.test(ua);
    const tabletUA = /iPad|Tablet|SM-T|Tab/i.test(ua);
    const isIPadDesktopUA = /Macintosh/i.test(ua) && touchPoints > 1;

    const tablet = tabletUA || isIPadDesktopUA || (!mobileUA && touchPoints > 1 && minSide >= 600);
    const mobile = !tablet && (uaDataMobile === true || mobileUA || (touchPoints > 0 && minSide < 600));
    const desktop = !mobile && !tablet;

    const width = root.visualViewport?.width ?? innerWidth;
    const height = root.visualViewport?.height ?? innerHeight;

    return {
      mobile,
      tablet,
      desktop,
      touch: touchPoints > 0,
      touchPoints,
      orientation: width >= height ? "landscape" : "portrait",
      userAgent: ua
    };
  }

  function signature(info) {
    return [info.mobile, info.tablet, info.desktop, info.orientation, info.touchPoints].join("|");
  }

  function notify(reason) {
    const info = getInfo();
    const nextSignature = signature(info);
    if (nextSignature === lastSignature) return;
    lastSignature = nextSignature;

    const payload = { ...info, reason, at: Date.now() };
    for (const callback of [...listeners]) {
      try { callback(payload); } catch (error) { console.error("[Crack:Device] listener error", error); }
    }
    CrackModules.Events?.emit?.("device:change", payload);
  }

  function onChange() { notify("viewport"); }

  function start() {
    if (started) return false;
    lastSignature = signature(getInfo());
    root.addEventListener("resize", onChange, { passive: true });
    root.addEventListener("orientationchange", onChange, { passive: true });
    started = true;
    log.info?.("started");
    return true;
  }

  function stop() {
    if (!started) return false;
    root.removeEventListener("resize", onChange);
    root.removeEventListener("orientationchange", onChange);
    started = false;
    log.info?.("stopped");
    return true;
  }

  CrackModules.Device = {
    start,
    stop,
    isStarted: () => started,
    getInfo,
    isMobile: () => getInfo().mobile,
    isTablet: () => getInfo().tablet,
    isDesktop: () => getInfo().desktop,
    orientation: () => getInfo().orientation,
    onChange(callback) {
      listeners.add(callback);
      return () => listeners.delete(callback);
    }
  };
})();