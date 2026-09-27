"use strict";

const DEFAULTS = Object.freeze({
  folderKind: "bundled",
  folderPath: "",
  periodMinutes: 15,
  defaultFile: "background.jpg",
});

let rotationTimer = null;
let lastStatus = null;

function normalizeConfig(values = {}) {
  const minutes = Number(values.periodMinutes);
  const folderKind = values.folderKind === "absolute" || values.folderKind === "profile-relative"
    ? values.folderKind
    : DEFAULTS.folderKind;
  return {
    folderKind,
    folderPath: folderKind === "bundled"
      ? ""
      : (typeof values.folderPath === "string" ? values.folderPath.trim() : ""),
    periodMinutes: Number.isFinite(minutes)
      ? Math.min(1440, Math.max(1, Math.round(minutes)))
      : DEFAULTS.periodMinutes,
    defaultFile: DEFAULTS.defaultFile,
  };
}

async function storedConfig() {
  return normalizeConfig(await browser.storage.local.get(DEFAULTS));
}

function scheduleRotation(periodMinutes) {
  if (rotationTimer) clearInterval(rotationTimer);
  rotationTimer = setInterval(async () => {
    try {
      lastStatus = JSON.parse(await browser.wallpaperChanger.next());
    } catch (error) {
      console.error("Even Better BetterBird wallpaper rotation failed", error);
    }
  }, periodMinutes * 60 * 1000);
}

async function applyConfig(config, initial = false) {
  const normalized = normalizeConfig(config);
  const result = initial
    ? await browser.wallpaperChanger.start(JSON.stringify(normalized))
    : await browser.wallpaperChanger.configure(JSON.stringify(normalized));
  lastStatus = JSON.parse(result);
  scheduleRotation(normalized.periodMinutes);
  return lastStatus;
}

browser.runtime.onMessage.addListener(message => {
  if (message?.type === "even-better-betterbird-choose-folder") {
    return browser.wallpaperChanger.chooseFolder();
  }
  if (message?.type === "even-better-betterbird-save") {
    return (async () => {
      const config = normalizeConfig(message.config);
      await browser.storage.local.set(config);
      return applyConfig(config, false);
    })();
  }
  if (message?.type === "even-better-betterbird-next") {
    return (async () => {
      lastStatus = JSON.parse(await browser.wallpaperChanger.next());
      return lastStatus;
    })();
  }
  if (message?.type === "even-better-betterbird-status") {
    return (async () => lastStatus || JSON.parse(await browser.wallpaperChanger.getStatus()))();
  }
  return undefined;
});

(async () => {
  await browser.themeLoader.start();
  await browser.agendaImportance.start();
  await browser.messageContrast.start();
  await browser.senderAvatars.start();
  await browser.twoMonthCalendar.start();
  const config = await storedConfig();
  await browser.storage.local.set(config);
  lastStatus = await applyConfig(config, true);
})().catch(error => {
  console.error("Even Better BetterBird startup failed", error);
});
