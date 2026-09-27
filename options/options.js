"use strict";

const DEFAULTS = Object.freeze({
  folderKind: "bundled",
  folderPath: "",
  periodMinutes: 15,
  defaultFile: "background.jpg",
});

const folderInput = document.getElementById("folder");
const pathKind = document.getElementById("path-kind");
const periodInput = document.getElementById("period");
const currentFile = document.getElementById("current-file");
const imageCount = document.getElementById("image-count");
const statusNode = document.getElementById("status");

let config = { ...DEFAULTS };

function setStatus(message, error = false) {
  statusNode.textContent = message;
  statusNode.classList.toggle("error", error);
}

function renderConfig() {
  folderInput.value = config.folderKind === "bundled" ? "Included Nature Glass wallpaper" : config.folderPath;
  periodInput.value = config.periodMinutes;
  pathKind.textContent = config.folderKind === "bundled"
    ? "Included wallpaper: works immediately on every installation."
    : config.folderKind === "profile-relative"
      ? "Portable path: stored relative to the running Betterbird profile."
      : "Absolute path: tied to this machine and drive layout.";
}

function renderStatus(status) {
  currentFile.textContent = status?.currentFile || "—";
  imageCount.textContent = Number.isFinite(status?.imageCount) ? String(status.imageCount) : "—";
  if (status?.displayFolder) folderInput.title = status.displayFolder;
  if (status?.error) setStatus(status.error, true);
}

async function load() {
  config = { ...DEFAULTS, ...(await browser.storage.local.get(DEFAULTS)) };
  renderConfig();
  try {
    renderStatus(await browser.runtime.sendMessage({ type: "even-better-betterbird-status" }));
  } catch (error) {
    setStatus(String(error?.message || error), true);
  }
}

document.getElementById("browse").addEventListener("click", async () => {
  setStatus("Choose a wallpaper folder…");
  try {
    const result = await browser.runtime.sendMessage({ type: "even-better-betterbird-choose-folder" });
    if (!result) return setStatus("Folder selection cancelled.");
    const selected = JSON.parse(result);
    config.folderKind = selected.folderKind;
    config.folderPath = selected.folderPath;
    renderConfig();
    folderInput.title = selected.displayPath || selected.folderPath;
    setStatus(config.folderKind === "profile-relative"
      ? "Portable profile-relative folder selected. Save to apply it."
      : "Absolute folder selected. Save to apply it.");
  } catch (error) {
    setStatus(String(error?.message || error), true);
  }
});

document.getElementById("save").addEventListener("click", async () => {
  config.periodMinutes = Math.min(1440, Math.max(1, Math.round(Number(periodInput.value) || 15)));
  periodInput.value = config.periodMinutes;
  setStatus("Applying settings…");
  try {
    const result = await browser.runtime.sendMessage({ type: "even-better-betterbird-save", config });
    renderStatus(result);
    if (!result.error) setStatus(`Saved. ${result.imageCount} wallpaper${result.imageCount === 1 ? "" : "s"} available.`);
  } catch (error) {
    setStatus(String(error?.message || error), true);
  }
});

document.getElementById("next").addEventListener("click", async () => {
  setStatus("Changing wallpaper…");
  try {
    const result = await browser.runtime.sendMessage({ type: "even-better-betterbird-next" });
    renderStatus(result);
    if (!result.error) setStatus(`Now showing ${result.currentFile}.`);
  } catch (error) {
    setStatus(String(error?.message || error), true);
  }
});

document.getElementById("reset").addEventListener("click", () => {
  config = { ...DEFAULTS };
  renderConfig();
  setStatus("Portable default restored. Save to apply it.");
});

load();
