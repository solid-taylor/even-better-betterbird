"use strict";
{

const { ExtensionCommon } = ChromeUtils.importESModule(
  "resource://gre/modules/ExtensionCommon.sys.mjs"
);
const observerService = Components.classes[
  "@mozilla.org/observer-service;1"
].getService(Components.interfaces.nsIObserverService);
const windowMediator = Components.classes[
  "@mozilla.org/appshell/window-mediator;1"
].getService(Components.interfaces.nsIWindowMediator);

const IMPORTANCE_CLASSES = [
  "nature-glass-importance-1",
  "nature-glass-importance-2",
  "nature-glass-importance-3",
];
const PREFIX_LEVELS = new Map([
  ["\u204E", 1],
  ["\u2051", 2],
  ["\u2042", 3],
]);
const FALLBACK_CALENDAR_COLOR = "#37c6d3";

function safeProperty(item, name) {
  try {
    return item?.getProperty?.(name) ?? null;
  } catch (_) {
    return null;
  }
}

function priorityLevel(priority) {
  const value = Number(priority);
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  if (value <= 4) {
    return 3;
  }
  if (value === 5) {
    return 2;
  }
  return value <= 9 ? 1 : 0;
}

function categoryLevel(item) {
  let categories = [];
  try {
    categories = item?.getCategories?.() || [];
  } catch (_) {}
  const property = safeProperty(item, "CATEGORIES");
  if (property) {
    categories = categories.concat(String(property).split(","));
  }
  return categories.some(
    category => String(category).trim().toLocaleLowerCase() === "important"
  )
    ? 3
    : 0;
}

var agendaImportance = class extends ExtensionCommon.ExtensionAPI {
  constructor(...args) {
    super(...args);
    this.started = false;
    this.windowStates = new Map();
    this.windowObserver = null;
    this.styleURL = null;
  }

  getAPI(context) {
    this.styleURL = context.extension.rootURI.resolve("style.css");
    return {
      agendaImportance: {
        start: async () => this.start(),
      },
    };
  }

  start() {
    if (this.started) {
      return;
    }
    this.started = true;
    this.windowObserver = {
      observe: window => {
        if (window.document.readyState === "complete") {
          this.attachWindow(window);
        } else {
          window.addEventListener("load", () => this.attachWindow(window), {
            once: true,
          });
        }
      },
    };
    observerService.addObserver(this.windowObserver, "domwindowopened");
    for (const window of windowMediator.getEnumerator("mail:3pane")) {
      this.attachWindow(window);
    }
  }

  attachWindow(window) {
    if (
      !this.started ||
      this.windowStates.has(window) ||
      window.document.documentURI !==
        "chrome://messenger/content/messenger.xhtml"
    ) {
      return;
    }
    const state = {
      agendaObserver: null,
      documentObserver: null,
      styleElement: null,
      scheduled: false,
      unload: null,
    };
    state.styleElement = window.document.createElement("link");
    state.styleElement.rel = "stylesheet";
    state.styleElement.href = this.styleURL;
    state.styleElement.dataset.natureGlassAgendaImportance = "true";
    window.document.documentElement.append(state.styleElement);

    const classifyAll = () => {
      state.scheduled = false;
      for (const row of window.document.querySelectorAll(
        "#agenda .agenda-listitem"
      )) {
        this.classifyRow(row);
      }
    };
    const schedule = () => {
      if (!state.scheduled) {
        state.scheduled = true;
        window.setTimeout(classifyAll, 0);
      }
    };
    const observeAgenda = agenda => {
      state.documentObserver?.disconnect();
      state.documentObserver = null;
      state.agendaObserver = new window.MutationObserver(schedule);
      state.agendaObserver.observe(agenda, {
        attributes: true,
        attributeFilter: ["class"],
        characterData: true,
        childList: true,
        subtree: true,
      });
      schedule();
    };
    const agenda = window.document.querySelector("#agenda");
    if (agenda) {
      observeAgenda(agenda);
    } else {
      state.documentObserver = new window.MutationObserver(() => {
        const insertedAgenda = window.document.querySelector("#agenda");
        if (insertedAgenda) {
          observeAgenda(insertedAgenda);
        }
      });
      state.documentObserver.observe(window.document.documentElement, {
        childList: true,
        subtree: true,
      });
    }
    state.unload = () => this.detachWindow(window);
    window.addEventListener("unload", state.unload, { once: true });
    this.windowStates.set(window, state);
  }

  classifyRow(row) {
    const item = row.item;
    const titleElement = row.querySelector(".agenda-listitem-title");
    const title = item?.title ?? titleElement?.textContent ?? "";
    const prefixLevel = PREFIX_LEVELS.get(title.trimStart().charAt(0)) ?? 0;
    const nativePriority = item?.priority ?? safeProperty(item, "PRIORITY");
    const calendar = item?.calendar;
    const calendarColor =
      calendar?.getProperty?.("color") ||
      calendar?.getProperty?.("COLOR") ||
      FALLBACK_CALENDAR_COLOR;

    row.dataset.natureGlassCalendar = calendar?.id || "unknown";
    row.style.setProperty("--nature-glass-calendar-color", calendarColor);

    let level = 0;
    const sources = [];
    if (!row.classList.contains("agenda-listitem-past")) {
      const nativeLevel = priorityLevel(nativePriority);
      const importantCategoryLevel = categoryLevel(item);
      level = Math.max(prefixLevel, nativeLevel, importantCategoryLevel);
      if (prefixLevel) sources.push("prefix");
      if (nativeLevel) sources.push("priority");
      if (importantCategoryLevel) sources.push("category");
    }
    const desiredClass = level ? `nature-glass-importance-${level}` : null;
    for (const className of IMPORTANCE_CLASSES) {
      row.classList.toggle(className, className === desiredClass);
    }
    if (level) {
      row.dataset.natureGlassImportance = String(level);
      row.dataset.natureGlassImportanceSources = sources.join(" ");
    } else {
      delete row.dataset.natureGlassImportance;
      delete row.dataset.natureGlassImportanceSources;
    }
    if (prefixLevel) {
      this.wrapImportanceMarker(titleElement, title, prefixLevel);
    } else {
      this.unwrapImportanceMarker(titleElement, title);
    }
  }

  wrapImportanceMarker(titleElement, title, level) {
    if (!titleElement) {
      return;
    }
    const currentMarker = titleElement.querySelector(
      ":scope > .nature-glass-importance-marker"
    );
    if (
      currentMarker?.dataset.level === String(level) &&
      titleElement.textContent === title
    ) {
      return;
    }
    const match = title.match(/^(\s*)([\u204E\u2051\u2042])(.*)$/u);
    if (!match) {
      this.unwrapImportanceMarker(titleElement, title);
      return;
    }
    const marker = titleElement.ownerDocument.createElement("span");
    marker.className = "nature-glass-importance-marker";
    marker.dataset.level = String(level);
    marker.textContent = match[2];
    titleElement.replaceChildren(
      titleElement.ownerDocument.createTextNode(match[1]),
      marker,
      titleElement.ownerDocument.createTextNode(match[3])
    );
  }

  unwrapImportanceMarker(titleElement, title) {
    if (
      titleElement?.querySelector(":scope > .nature-glass-importance-marker")
    ) {
      titleElement.textContent = title;
    }
  }

  resetRow(row) {
    const titleElement = row.querySelector(".agenda-listitem-title");
    const title = row.item?.title ?? titleElement?.textContent ?? "";
    row.classList.remove(...IMPORTANCE_CLASSES);
    delete row.dataset.natureGlassImportance;
    delete row.dataset.natureGlassImportanceSources;
    delete row.dataset.natureGlassCalendar;
    row.style.removeProperty("--nature-glass-calendar-color");
    this.unwrapImportanceMarker(titleElement, title);
  }

  detachWindow(window) {
    const state = this.windowStates.get(window);
    if (!state) {
      return;
    }
    state.agendaObserver?.disconnect();
    state.documentObserver?.disconnect();
    state.styleElement?.remove();
    window.removeEventListener("unload", state.unload);
    this.windowStates.delete(window);
  }

  stop() {
    if (!this.started) {
      return;
    }
    observerService.removeObserver(this.windowObserver, "domwindowopened");
    this.windowObserver = null;
    this.started = false;
    for (const window of [...this.windowStates.keys()]) {
      for (const row of window.document.querySelectorAll(
        "#agenda .agenda-listitem"
      )) {
        this.resetRow(row);
      }
      this.detachWindow(window);
    }
  }

  onShutdown(isAppShutdown) {
    this.stop();
    if (!isAppShutdown) {
      observerService.notifyObservers(null, "startupcache-invalidate");
    }
  }
};
}
