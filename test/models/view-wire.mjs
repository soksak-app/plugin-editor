// Behavior model of the view script that the host injects into each view page: window.sokView.attach(listener) and the
// queue of host messages that arrive before the listener attaches. The page posts view.ready on load and view.error for each
// refused message, through the sok-view handler of the window. The page identity is a UUID of window.crypto and the ready
// message carries the time origin of the page beside it. The conformance test replays test/fixtures/contract/view-wire.json.

/** The host messages that a view holds before its listener attaches. */
export const QUEUE_LIMIT = 256;

/**
 * Installs the model on window for the view of plugin host. The handler is window.webkit.messageHandlers["sok-view"],
 * which receives each message the page posts.
 */
export function installViewWire(window, { host } = {}) {
  const handler = window.webkit.messageHandlers["sok-view"];
  const posted = (message) => handler.postMessage(message);
  const refuse = (reason) => posted({ event: "view.error", plugin: host, reason });
  const page = window.crypto.randomUUID();
  const timeOrigin = window.performance.timeOrigin;
  const queue = [];
  let listener = null;

  window.addEventListener("message", (event) => {
    if (event.source !== window) {
      refuse(`message from another source for ${host}`);
      return;
    }
    const data = event.data;
    if (data === null || typeof data !== "object" || data.sok !== 1) {
      refuse(`message without the sok marker for ${host}`);
      return;
    }
    if (listener === null) {
      if (queue.length >= QUEUE_LIMIT) {
        refuse(`queue full for ${host}`);
        return;
      }
      queue.push(data);
      return;
    }
    listener(data);
  });

  window.sokView = Object.freeze({
    page,
    timeOrigin,
    attach(fn) {
      if (typeof fn !== "function") throw new Error("attach requires a listener function");
      if (listener !== null) throw new Error(`view channel for ${host} already has a message listener`);
      listener = fn;
      for (const data of queue.splice(0)) fn(data);
    },
  });

  posted({ event: "view.ready", plugin: host, document: page, time_origin: timeOrigin });
}
