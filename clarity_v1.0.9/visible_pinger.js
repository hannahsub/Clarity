(() => {
  console.log("[Clarity:pinger] loaded");

  let port = null;
  let timer = null;
  let reconnectDelay = 500;
  let invalidated = false;

  function connect() {
    if (invalidated) return false;
    try {
      port = chrome.runtime.connect({ name: "visible" });
      reconnectDelay = 500;
      console.log("[Clarity:pinger] connected");

      port.onDisconnect.addListener(() => {
        if (invalidated) return;
        console.warn("[Clarity:pinger] port disconnected");
        port = null;
        stopTimer();
        scheduleReconnect();
      });
      return true;
    } catch (e) {
      const msg = String(e?.message || e);
      if (msg.includes("Extension context invalidated")) {
        invalidated = true;
        stopTimer();
        console.info("[Clarity:pinger] extension reloaded/disabled; reload this tab to resume tracking.");
        return false;
      }
      console.warn("[Clarity:pinger] connect failed", e);
      port = null;
      scheduleReconnect();
      return false;
    }
  }

  function scheduleReconnect() {
    if (invalidated) return;
    if (document.visibilityState !== "visible") return;
    setTimeout(() => {
      if (!port) {
        if (connect()) maybeStart();
      }
    }, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 10000);
  }

  function ensurePort() {
    if (invalidated) return false;
    if (port) return true;
    return connect();
  }

  function send(type) {
    if (!ensurePort()) return;
    try {
      const domain = location.hostname;
      port.postMessage({ type, domain, ts: Date.now() });
    } catch (e) {
      const msg = String(e?.message || e);
      if (msg.includes("Extension context invalidated")) {
        invalidated = true;
        stopTimer();
        console.info("[Clarity:pinger] extension reloaded/disabled; reload this tab to resume tracking.");
        return;
      }
      console.warn("[Clarity:pinger] postMessage failed", e);
      port = null;
      stopTimer();
      scheduleReconnect();
    }
  }

  function startTimer() {
    if (invalidated || timer) return;
    send("start");
    timer = setInterval(() => send("tick"), 15000);
  }
  function stopTimer() {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
    try { send("stop"); } catch {}
  }

  function maybeStart() {
    if (document.visibilityState === "visible") startTimer();
  }

  function handleVisibility() {
    if (invalidated) return;
    if (document.visibilityState === "visible") {
      if (!port) connect();
      startTimer();
    } else {
      stopTimer();
    }
  }

  document.addEventListener("visibilitychange", handleVisibility, { passive: true });
  window.addEventListener("pagehide", stopTimer, { passive: true });
  window.addEventListener("beforeunload", stopTimer, { passive: true });

  handleVisibility();
})();