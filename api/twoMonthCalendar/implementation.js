"use strict";
{

const { ExtensionCommon } = ChromeUtils.importESModule(
  "resource://gre/modules/ExtensionCommon.sys.mjs"
);
const { classes: Cc, interfaces: Ci } = Components;
const observerService = Cc["@mozilla.org/observer-service;1"].getService(Ci.nsIObserverService);
const windowMediator = Cc["@mozilla.org/appshell/window-mediator;1"].getService(Ci.nsIWindowMediator);

const ROOT_ID = "nature-glass-two-month-calendar";
const STYLE_ID = `${ROOT_ID}-style`;

var twoMonthCalendar = class extends ExtensionCommon.ExtensionAPI {
  constructor(...args) {
    super(...args);
    this.started = false;
    this.windowObserver = null;
    this.windowStates = new Map();
  }

  getAPI() {
    return { twoMonthCalendar: { start: async () => this.start() } };
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
    for (const window of windowMediator.getEnumerator("mail:3pane")) this.attachWindow(window);
  }

  attachWindow(window) {
    if (!this.started || this.windowStates.has(window) ||
        window.document.documentURI !== "chrome://messenger/content/messenger.xhtml") return;
    const state = { observer: null, scheduled: false, timer: null, unload: null,
      root: null, baseMonth: null, oldButtonDisplay: "", listeners: [],
      lastSyncKey: "" };
    const schedule = () => {
      if (state.scheduled || !this.started) return;
      state.scheduled = true;
      window.setTimeout(() => { state.scheduled = false; this.render(window, state); }, 0);
    };
    state.observer = new window.MutationObserver(schedule);
    state.observer.observe(window.document.documentElement, {
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true,
    });
    state.timer = window.setInterval(schedule, 60 * 1000);
    state.unload = () => this.detachWindow(window);
    window.addEventListener("unload", state.unload, { once: true });
    this.windowStates.set(window, state);
    schedule();
  }

  render(window, state) {
    const document = window.document;
    const miniDay = document.getElementById("mini-day-box");
    const dropButton = document.getElementById("miniday-dropdown-button");
    if (!miniDay || !dropButton || !window.TodayPane?.setDaywithjsDate) return;
    this.ensureStyle(document);
    if (!state.root?.isConnected) this.buildSelector(window, state, miniDay, dropButton);
    const selected = this.selectedDate(window);
    const today = new Date();
    const syncKey = [
      state.baseMonth?.getFullYear(), state.baseMonth?.getMonth(),
      selected.getFullYear(), selected.getMonth(), selected.getDate(),
      today.getFullYear(), today.getMonth(), today.getDate(),
    ].join("/");
    if (state.lastSyncKey !== syncKey) this.syncCalendars(window, state);
  }

  buildSelector(window, state, miniDay, dropButton) {
    const document = window.document;
    document.getElementById(ROOT_ID)?.remove();
    state.oldButtonDisplay = dropButton.style.getPropertyValue("display");
    dropButton.style.setProperty("display", "none", "important");
    const root = document.createElement("div");
    root.id = ROOT_ID;
    root.className = "ng-native-two-month-selector";
    const nav = document.createElement("div");
    nav.className = "ng-selector-nav";
    const button = (className, text, title) => {
      const node = document.createElement("button");
      node.type = "button"; node.className = className; node.textContent = text; node.title = title;
      return node;
    };
    const today = button("ng-today", "▣", "Go to Today");
    const prevMonth = button("ng-prev-month", "‹", "Previous month");
    const nextMonth = button("ng-next-month", "›", "Next month");
    const prevYear = button("ng-prev-year", "‹", "Previous year");
    const nextYear = button("ng-next-year", "›", "Next year");
    const monthLabel = document.createElement("span"); monthLabel.className = "ng-month-label";
    const yearLabel = document.createElement("span"); yearLabel.className = "ng-year-label";
    nav.append(today, prevMonth, monthLabel, nextMonth, prevYear, yearLabel, nextYear);
    const grids = document.createElement("div"); grids.className = "ng-selector-grids";
    const makeCalendar = id => {
      const node = document.createXULElement("calendar-minimonth");
      node.id = id; node.setAttribute("orient", "vertical"); node.setAttribute("freebusy", "true");
      return node;
    };
    const left = makeCalendar("ng-selector-month-left");
    const right = makeCalendar("ng-selector-month-right");
    grids.append(left, right); root.append(nav, grids);
    miniDay.parentElement.insertBefore(root, miniDay.nextElementSibling);
    state.root = root; state.left = left; state.right = right;
    state.monthLabel = monthLabel; state.yearLabel = yearLabel;
    const selected = this.selectedDate(window);
    state.baseMonth = new Date(selected.getFullYear(), selected.getMonth(), 1, 12);
    const listen = (node, type, handler) => {
      node.addEventListener(type, handler); state.listeners.push([node, type, handler]);
    };
    listen(left, "change", () => this.chooseDate(window, state, left));
    listen(right, "change", () => this.chooseDate(window, state, right));
    listen(today, "click", () => {
      const now = new Date(); state.baseMonth = new Date(now.getFullYear(), now.getMonth(), 1, 12);
      window.TodayPane.setDaywithjsDate(now); this.syncCalendars(window, state);
    });
    listen(prevMonth, "click", () => this.shiftMonth(window, state, -1));
    listen(nextMonth, "click", () => this.shiftMonth(window, state, 1));
    listen(prevYear, "click", () => this.shiftYear(window, state, -1));
    listen(nextYear, "click", () => this.shiftYear(window, state, 1));
  }

  selectedDate(window) {
    const value = window.TodayPane.start;
    return value ? new Date(value.year, value.month, value.day, 12) : new Date();
  }

  chooseDate(window, state, calendar) {
    if (state.syncing || !calendar.value) return;
    const selected = new Date(calendar.value);
    state.syncing = true;
    window.TodayPane.setDaywithjsDate(selected);
    const lastVisible = new Date(state.baseMonth.getFullYear(), state.baseMonth.getMonth() + 2, 0, 12);
    if (selected < state.baseMonth || selected > lastVisible) {
      state.baseMonth = new Date(selected.getFullYear(), selected.getMonth(), 1, 12);
    }
    this.syncCalendars(window, state);
    state.syncing = false;
  }

  shiftMonth(window, state, amount) {
    state.baseMonth = new Date(state.baseMonth.getFullYear(), state.baseMonth.getMonth() + amount, 1, 12);
    this.syncCalendars(window, state);
  }

  shiftYear(window, state, amount) {
    state.baseMonth = new Date(state.baseMonth.getFullYear() + amount, state.baseMonth.getMonth(), 1, 12);
    this.syncCalendars(window, state);
  }

  syncCalendars(window, state) {
    if (!state.root?.isConnected || !state.left?.showMonth) return;
    const base = state.baseMonth || new Date();
    const next = new Date(base.getFullYear(), base.getMonth() + 1, 1, 12);
    const selected = this.selectedDate(window);
    for (const [calendar, month] of [[state.left, base], [state.right, next]]) {
      calendar.mValue = selected;
      calendar.showMonth(month);
    }
    const locale = Services.locale?.regionalPrefsLocales?.[0] || "en-US";
    const formatter = new Intl.DateTimeFormat(locale, { month: "short" });
    state.monthLabel.textContent = `${formatter.format(base)} + ${formatter.format(next)}`;
    state.yearLabel.textContent = base.getFullYear() === next.getFullYear()
      ? String(base.getFullYear()) : `${base.getFullYear()}/${next.getFullYear()}`;
    const today = new Date();
    state.lastSyncKey = [
      base.getFullYear(), base.getMonth(), selected.getFullYear(),
      selected.getMonth(), selected.getDate(), today.getFullYear(),
      today.getMonth(), today.getDate(),
    ].join("/");
  }

  ensureStyle(document) {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style"); style.id = STYLE_ID;
    style.textContent = `
      #${ROOT_ID}{margin:8px 6px 5px!important;border:1px solid rgba(186,221,206,.58)!important;border-radius:10px!important;background:rgba(15,28,24,.70)!important;overflow:hidden!important;box-shadow:inset 0 0 0 1px rgba(255,255,255,.03)!important;color:#e8f2ed!important}
      #${ROOT_ID} .ng-selector-nav{display:grid!important;grid-template-columns:28px 25px minmax(68px,1fr) 25px 25px minmax(52px,.7fr) 25px!important;gap:2px!important;align-items:center!important;padding:4px!important;border-bottom:1px solid rgba(186,221,206,.25)!important;background:rgba(230,236,229,.10)!important}
      #${ROOT_ID} .ng-selector-nav button{appearance:none!important;min-width:0!important;height:25px!important;padding:0!important;border:1px solid rgba(186,221,206,.18)!important;border-radius:4px!important;background:rgba(230,236,229,.09)!important;color:#edf6f1!important;font:600 16px/1 "Segoe UI",sans-serif!important;cursor:pointer!important}
      #${ROOT_ID} .ng-selector-nav button:hover{background:rgba(230,236,229,.18)!important}
      #${ROOT_ID} :is(.ng-month-label,.ng-year-label){min-width:0!important;overflow:hidden!important;text-overflow:ellipsis!important;white-space:nowrap!important;text-align:center!important;font:650 11px/1 "Segoe UI",sans-serif!important;text-transform:uppercase!important}
      #${ROOT_ID} .ng-selector-grids{display:grid!important;grid-template-columns:1fr 1fr!important;gap:0!important;padding:2px 4px 1px!important}
      #${ROOT_ID} calendar-minimonth{min-width:0!important;width:auto!important;padding:0 4px!important;background:transparent!important;color:#e8f2ed!important;border:0!important}
      #${ROOT_ID} calendar-minimonth+calendar-minimonth{border-inline-start:1px solid rgba(160,196,184,.45)!important}
      #${ROOT_ID} .minimonth-header{display:none!important}
      #${ROOT_ID} .minimonth-readonly-header{display:block!important;margin:1px 0 3px!important;text-align:center!important;color:#ebf6f0!important;font:650 10px/1.2 "Segoe UI",sans-serif!important;text-transform:uppercase!important}
      #${ROOT_ID} .minimonth-calendar{width:100%!important;border-spacing:0!important;background:transparent!important}
      #${ROOT_ID} :is(.minimonth-row-header,.minimonth-row-header-week){height:14px!important;padding:0!important;color:#9dbbae!important;font:600 9px/1 "Segoe UI",sans-serif!important;text-align:center!important;background:transparent!important}
      #${ROOT_ID} :is(.minimonth-row-header-week,.minimonth-week){display:none!important}
      #${ROOT_ID} .minimonth-day{box-sizing:border-box!important;width:auto!important;height:13px!important;padding:0!important;border:0!important;border-radius:4px!important;background:transparent!important;color:#e2eee7!important;font:500 10px/13px "Segoe UI",sans-serif!important;text-align:center!important;cursor:pointer!important}
      #${ROOT_ID} .minimonth-day[othermonth]{color:#768d83!important;opacity:.52!important}
      #${ROOT_ID} .minimonth-day:hover{background:rgba(230,236,229,.15)!important;color:#fff!important;box-shadow:inset 0 0 0 1px rgba(230,236,229,.25)!important}
      #${ROOT_ID} .minimonth-day[today]{background:rgba(36,147,239,.20)!important;box-shadow:inset 0 0 0 1px rgba(36,147,239,.72)!important;color:#fff!important;font-weight:700!important}
      #${ROOT_ID} .minimonth-day[selected]{background:rgba(93,144,162,.34)!important;box-shadow:inset 0 0 0 2px #9bbfc8!important;color:#fff!important;font-weight:700!important}
      #${ROOT_ID} .minimonth-day:focus-visible{outline:2px solid rgba(207,235,226,.95)!important;outline-offset:1px!important}
    `;
    document.documentElement.append(style);
  }

  detachWindow(window) {
    const state = this.windowStates.get(window); if (!state) return;
    state.observer?.disconnect(); if (state.timer) window.clearInterval(state.timer);
    for (const [node, type, handler] of state.listeners) node.removeEventListener(type, handler);
    state.left?.removeAttribute("freebusy"); state.right?.removeAttribute("freebusy");
    state.root?.remove(); window.document.getElementById(STYLE_ID)?.remove();
    const dropButton = window.document.getElementById("miniday-dropdown-button");
    if (dropButton) state.oldButtonDisplay ? dropButton.style.setProperty("display", state.oldButtonDisplay) : dropButton.style.removeProperty("display");
    window.removeEventListener("unload", state.unload); this.windowStates.delete(window);
  }

  stop() {
    if (!this.started) return;
    observerService.removeObserver(this.windowObserver, "domwindowopened");
    this.windowObserver = null; this.started = false;
    for (const window of [...this.windowStates.keys()]) this.detachWindow(window);
  }

  onShutdown(isAppShutdown) {
    this.stop();
    if (!isAppShutdown) observerService.notifyObservers(null, "startupcache-invalidate");
  }
};
}
