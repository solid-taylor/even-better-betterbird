"use strict";
{

const { ExtensionCommon } = ChromeUtils.importESModule(
  "resource://gre/modules/ExtensionCommon.sys.mjs"
);
const { classes: Cc, interfaces: Ci } = Components;
const observerService = Cc["@mozilla.org/observer-service;1"]
  .getService(Ci.nsIObserverService);
const windowMediator = Cc["@mozilla.org/appshell/window-mediator;1"]
  .getService(Ci.nsIWindowMediator);

const FIXED_ATTR = "data-nature-glass-contrast-fixed";
const OLD_STYLE_ATTR = "data-nature-glass-contrast-old-style";
const HAD_STYLE_ATTR = "data-nature-glass-contrast-had-style";
const THRESHOLD = 2;
const DARK_TEXT = [23, 27, 28];
const LIGHT_TEXT = [255, 255, 255];

var messageContrast = class extends ExtensionCommon.ExtensionAPI {
  constructor(...args) {
    super(...args);
    this.started = false;
    this.windowObserver = null;
    this.windowStates = new Map();
  }

  getAPI() {
    return { messageContrast: { start: async () => this.start() } };
  }

  start() {
    if (this.started) return;
    this.started = true;
    this.windowObserver = {
      observe: window => {
        if (window.document.readyState === "complete") this.attachWindow(window);
        else window.addEventListener("load", () => this.attachWindow(window), { once: true });
      },
    };
    observerService.addObserver(this.windowObserver, "domwindowopened");
    for (const window of windowMediator.getEnumerator("mail:3pane")) {
      this.attachWindow(window);
    }
  }

  attachWindow(window) {
    if (!this.started || this.windowStates.has(window) ||
        window.document.documentURI !== "chrome://messenger/content/messenger.xhtml") {
      return;
    }
    const state = {
      scheduled: false,
      timer: null,
      interval: null,
      observer: null,
      toggle: null,
      pane: null,
      onToggle: null,
      onPaneLoad: null,
      unload: null,
    };
    const schedule = (delay = 700) => {
      if (!this.started) return;
      if (state.timer) window.clearTimeout(state.timer);
      state.timer = window.setTimeout(() => {
        state.timer = null;
        this.refresh(window, state);
      }, delay);
    };
    state.schedule = schedule;
    state.observer = new window.MutationObserver(() => schedule());
    state.observer.observe(window.document.documentElement, {
      attributes: true,
      childList: true,
      subtree: true,
    });
    state.interval = window.setInterval(() => schedule(0), 2500);
    state.unload = () => this.detachWindow(window);
    window.addEventListener("unload", state.unload, { once: true });
    this.windowStates.set(window, state);
    schedule(0);
  }

  documents(rootDocument) {
    const output = [];
    const seen = new Set();
    const walk = document => {
      if (!document || seen.has(document)) return;
      seen.add(document);
      output.push(document);
      for (const frame of document.querySelectorAll("browser, iframe, frame")) {
        try { walk(frame.contentDocument); } catch (_) {}
      }
    };
    walk(rootDocument);
    return output;
  }

  refresh(window, state) {
    const documents = this.documents(window.document);
    const shell = documents.find(document => document.documentURI === "about:message");
    const toggle = shell?.getElementById("disableDarkReader");
    const pane = shell?.getElementById("messagepane");

    if (toggle !== state.toggle || pane !== state.pane) {
      if (state.toggle && state.onToggle) {
        state.toggle.removeEventListener("click", state.onToggle);
        state.toggle.removeEventListener("change", state.onToggle);
      }
      if (state.pane && state.onPaneLoad) {
        state.pane.removeEventListener("load", state.onPaneLoad, true);
      }
      state.toggle = toggle;
      state.pane = pane;
      state.onToggle = () => state.schedule();
      state.onPaneLoad = () => state.schedule();
      toggle?.addEventListener("click", state.onToggle);
      toggle?.addEventListener("change", state.onToggle);
      pane?.addEventListener("load", state.onPaneLoad, true);
    }

    const messageDocument = pane?.contentDocument;
    if (!toggle || !this.isMessageDocument(messageDocument)) return;
    if (toggle.checked) this.clear(messageDocument);
    else this.repair(messageDocument);
  }

  isMessageDocument(document) {
    return !!document && /^(imap|mailbox|news|snews|nntp):/.test(document.documentURI || "");
  }

  parseColor(value) {
    const parts = (value.match(/[\d.]+/g) || []).map(Number);
    return parts.length >= 3 ? parts.slice(0, 3) : null;
  }

  luminance(rgb) {
    return rgb.map(value => {
      const channel = value / 255;
      return channel <= 0.04045 ? channel / 12.92 :
        ((channel + 0.055) / 1.055) ** 2.4;
    }).reduce((sum, value, index) =>
      sum + value * [0.2126, 0.7152, 0.0722][index], 0);
  }

  contrast(first, second) {
    const a = this.luminance(first);
    const b = this.luminance(second);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  }

  isTransparent(value) {
    return value === "transparent" ||
      /rgba\([^)]*,\s*0(?:\.0+)?\s*\)/.test(value);
  }

  clear(document) {
    for (const element of document.querySelectorAll(`[${FIXED_ATTR}]`)) {
      if (element.getAttribute(HAD_STYLE_ATTR) === "1") {
        element.setAttribute("style", element.getAttribute(OLD_STYLE_ATTR) || "");
      } else {
        element.removeAttribute("style");
      }
      element.removeAttribute(FIXED_ATTR);
      element.removeAttribute(OLD_STYLE_ATTR);
      element.removeAttribute(HAD_STYLE_ATTR);
    }
  }

  repair(document) {
    this.clear(document);
    if (!document.body) return;
    const walker = document.createTreeWalker(
      document.body,
      document.defaultView.NodeFilter.SHOW_TEXT
    );
    while (walker.nextNode()) {
      const text = (walker.currentNode.nodeValue || "").replace(/\s+/g, " ").trim();
      if (!text) continue;
      const element = walker.currentNode.parentElement;
      const style = document.defaultView.getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden" ||
          Number(style.opacity) < 0.05 || !element.getClientRects().length) {
        continue;
      }

      let backgroundElement = element;
      let backgroundStyle = style;
      while (backgroundElement && this.isTransparent(backgroundStyle.backgroundColor)) {
        backgroundElement = backgroundElement.parentElement;
        if (backgroundElement) {
          backgroundStyle = document.defaultView.getComputedStyle(backgroundElement);
        }
      }
      const foreground = this.parseColor(style.color);
      const background = this.parseColor(backgroundStyle?.backgroundColor || "");
      if (!foreground || !background ||
          this.contrast(foreground, background) >= THRESHOLD ||
          element.hasAttribute(FIXED_ATTR)) {
        continue;
      }

      const hadStyle = element.hasAttribute("style");
      element.setAttribute(HAD_STYLE_ATTR, hadStyle ? "1" : "0");
      element.setAttribute(OLD_STYLE_ATTR, hadStyle ? element.getAttribute("style") : "");
      element.setAttribute(FIXED_ATTR, "true");
      const darkContrast = this.contrast(DARK_TEXT, background);
      const lightContrast = this.contrast(LIGHT_TEXT, background);
      const color = darkContrast >= lightContrast ?
        "rgb(23, 27, 28)" : "rgb(255, 255, 255)";
      element.style.setProperty("color", color, "important");
      element.style.setProperty("-webkit-text-fill-color", color, "important");
    }
  }

  detachWindow(window) {
    const state = this.windowStates.get(window);
    if (!state) return;
    state.observer?.disconnect();
    if (state.timer) window.clearTimeout(state.timer);
    if (state.interval) window.clearInterval(state.interval);
    if (state.toggle && state.onToggle) {
      state.toggle.removeEventListener("click", state.onToggle);
      state.toggle.removeEventListener("change", state.onToggle);
    }
    if (state.pane && state.onPaneLoad) {
      state.pane.removeEventListener("load", state.onPaneLoad, true);
      this.clear(state.pane.contentDocument);
    }
    window.removeEventListener("unload", state.unload);
    this.windowStates.delete(window);
  }

  stop() {
    if (!this.started) return;
    observerService.removeObserver(this.windowObserver, "domwindowopened");
    this.windowObserver = null;
    this.started = false;
    for (const window of [...this.windowStates.keys()]) this.detachWindow(window);
  }

  onShutdown(isAppShutdown) {
    this.stop();
    if (!isAppShutdown) observerService.notifyObservers(null, "startupcache-invalidate");
  }
};
}
