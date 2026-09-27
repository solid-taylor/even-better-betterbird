"use strict";
{

const { ExtensionCommon } = ChromeUtils.importESModule(
  "resource://gre/modules/ExtensionCommon.sys.mjs"
);
const { classes: Cc, interfaces: Ci } = Components;

const sheetService = Cc["@mozilla.org/content/style-sheet-service;1"]
  .getService(Ci.nsIStyleSheetService);
const windowMediator = Cc["@mozilla.org/appshell/window-mediator;1"]
  .getService(Ci.nsIWindowMediator);

const DEFAULT_CONFIG = Object.freeze({
  folderKind: "bundled",
  folderPath: "",
  periodMinutes: 15,
  defaultFile: "background.jpg",
});
const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "gif", "bmp"]);

var wallpaperChanger = class extends ExtensionCommon.ExtensionAPI {
  constructor(...args) {
    super(...args);
    this.started = false;
    this.sheetURI = null;
    this.config = { ...DEFAULT_CONFIG };
    this.folder = null;
    this.images = [];
    this.currentIndex = -1;
    this.currentFile = null;
    this.lastError = "";
    this.bundledWallpaperURL = "";
  }

  getAPI(context) {
    this.bundledWallpaperURL = context.extension.rootURI.resolve("styles/background.jpg");
    return {
      wallpaperChanger: {
        start: async configJson => this.start(configJson),
        configure: async configJson => this.configure(configJson),
        chooseFolder: async () => this.chooseFolder(),
        next: async () => this.next(),
        getStatus: async () => JSON.stringify(this.status()),
      },
    };
  }

  profileDirectory() {
    return Services.dirsvc.get("ProfD", Ci.nsIFile).clone();
  }

  parseConfig(configJson) {
    let parsed = {};
    try {
      parsed = JSON.parse(configJson || "{}");
    } catch (_) {}
    const minutes = Number(parsed.periodMinutes);
    return {
      folderKind: parsed.folderKind === "absolute" || parsed.folderKind === "profile-relative"
        ? parsed.folderKind
        : DEFAULT_CONFIG.folderKind,
      folderPath: typeof parsed.folderPath === "string" ? parsed.folderPath.trim() : "",
      periodMinutes: Number.isFinite(minutes)
        ? Math.min(1440, Math.max(1, Math.round(minutes)))
        : DEFAULT_CONFIG.periodMinutes,
      defaultFile: DEFAULT_CONFIG.defaultFile,
    };
  }

  resolveFolder(config) {
    if (config.folderKind === "bundled") return null;
    if (config.folderKind === "absolute") {
      const folder = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
      folder.initWithPath(config.folderPath);
      return folder;
    }
    const folder = this.profileDirectory();
    const segments = config.folderPath.split(/[\\/]+/).filter(Boolean);
    if (!segments.length || segments.some(segment => segment === "." || segment === "..")) {
      throw new Error("Invalid profile-relative wallpaper folder.");
    }
    for (const segment of segments) folder.append(segment);
    return folder;
  }

  listImages(folder, defaultFile) {
    if (!folder.exists() || !folder.isDirectory()) {
      throw new Error(`Wallpaper folder does not exist: ${folder.path}`);
    }
    const images = [];
    const entries = folder.directoryEntries;
    while (entries.hasMoreElements()) {
      const file = entries.getNext().QueryInterface(Ci.nsIFile);
      if (!file.isFile()) continue;
      const dot = file.leafName.lastIndexOf(".");
      const extension = dot >= 0 ? file.leafName.slice(dot + 1).toLowerCase() : "";
      if (IMAGE_EXTENSIONS.has(extension)) images.push(file);
    }
    images.sort((a, b) => a.leafName.localeCompare(b.leafName, undefined, { numeric: true, sensitivity: "base" }));
    const defaultIndex = images.findIndex(file => file.leafName.toLowerCase() === defaultFile.toLowerCase());
    if (defaultIndex > 0) images.unshift(images.splice(defaultIndex, 1)[0]);
    if (!images.length) throw new Error(`No supported wallpaper images found in: ${folder.path}`);
    return images;
  }

  start(configJson) {
    if (this.started) return JSON.stringify(this.status());
    this.started = true;
    return this.configureInternal(this.parseConfig(configJson), true);
  }

  configure(configJson) {
    this.started = true;
    return this.configureInternal(this.parseConfig(configJson), true);
  }

  configureInternal(config, resetToDefault) {
    this.config = config;
    this.lastError = "";
    try {
      if (config.folderKind === "bundled") {
        this.folder = null;
        this.images = [{
          leafName: DEFAULT_CONFIG.defaultFile,
          path: "",
          uri: this.bundledWallpaperURL,
        }];
        this.applyFile(0);
        return JSON.stringify(this.status());
      }
      const folder = this.resolveFolder(config);
      const images = this.listImages(folder, config.defaultFile);
      const previousPath = this.currentFile?.path || "";
      this.folder = folder;
      this.images = images;
      let index = resetToDefault ? 0 : images.findIndex(file => file.path === previousPath);
      if (index < 0) index = 0;
      this.applyFile(index);
    } catch (error) {
      this.folder = null;
      this.images = [];
      this.currentIndex = -1;
      this.currentFile = null;
      this.lastError = String(error?.message || error);
      this.unregisterSheet();
    }
    return JSON.stringify(this.status());
  }

  refreshImages() {
    if (!this.folder) return;
    const previousPath = this.currentFile?.path || "";
    this.images = this.listImages(this.folder, this.config.defaultFile);
    this.currentIndex = this.images.findIndex(file => file.path === previousPath);
  }

  next() {
    try {
      if (this.config.folderKind === "bundled") return this.configureInternal(this.config, true);
      if (!this.folder) return this.configureInternal(this.config, true);
      this.refreshImages();
      const nextIndex = this.images.length ? (this.currentIndex + 1 + this.images.length) % this.images.length : -1;
      if (nextIndex >= 0) this.applyFile(nextIndex);
      this.lastError = "";
    } catch (error) {
      this.lastError = String(error?.message || error);
    }
    return JSON.stringify(this.status());
  }

  applyFile(index) {
    const file = this.images[index];
    if (!file) throw new Error("Selected wallpaper is no longer available.");
    if (!file.uri && !file.exists()) throw new Error("Selected wallpaper is no longer available.");
    const fileURI = (file.uri || Services.io.newFileURI(file).spec)
      .replace(/["\\\n\r]/g, character => encodeURIComponent(character));
    const css = `@-moz-document url("chrome://messenger/content/messenger.xhtml") {
      html#messengerWindow:not(#nature-glass-cascade-guard-1):not(#nature-glass-cascade-guard-2):not(#nature-glass-cascade-guard-3):not(#nature-glass-cascade-guard-4)::before {
        background-image: linear-gradient(rgba(19, 29, 26, 0.72), rgba(19, 29, 26, 0.72)), url("${fileURI}") !important;
      }
    }`;
    const uri = Services.io.newURI("data:text/css;charset=utf-8," + encodeURIComponent(css));
    this.unregisterSheet();
    sheetService.loadAndRegisterSheet(uri, sheetService.USER_SHEET);
    this.sheetURI = uri;
    this.currentIndex = index;
    this.currentFile = file.uri ? { ...file } : file.clone();
  }

  unregisterSheet() {
    if (this.sheetURI && sheetService.sheetRegistered(this.sheetURI, sheetService.USER_SHEET)) {
      sheetService.unregisterSheet(this.sheetURI, sheetService.USER_SHEET);
    }
    this.sheetURI = null;
  }

  relativeDescriptor(file) {
    const profile = this.profileDirectory();
    const profilePath = profile.path;
    const selectedPath = file.path;
    const separator = profilePath.includes("\\") ? "\\" : "/";
    const normalizedProfile = profilePath.toLowerCase().replace(/[\\/]+$/, "");
    const normalizedSelected = selectedPath.toLowerCase();
    const prefix = normalizedProfile + separator;
    if (normalizedSelected.startsWith(prefix)) {
      return {
        folderKind: "profile-relative",
        folderPath: selectedPath.slice(profilePath.replace(/[\\/]+$/, "").length + 1),
        displayPath: selectedPath,
      };
    }
    return { folderKind: "absolute", folderPath: selectedPath, displayPath: selectedPath };
  }

  async chooseFolder() {
    const parentWindow = windowMediator.getMostRecentWindow("mail:3pane");
    const parent = parentWindow?.browsingContext || null;
    const picker = Cc["@mozilla.org/filepicker;1"].createInstance(Ci.nsIFilePicker);
    picker.init(parent, "Select Nature Glass wallpaper folder", Ci.nsIFilePicker.modeGetFolder);
    try {
      const current = this.resolveFolder(this.config);
      if (current?.exists() && current.isDirectory()) picker.displayDirectory = current;
    } catch (_) {}
    const result = await new Promise(resolve => picker.open(resolve));
    if (result !== Ci.nsIFilePicker.returnOK || !picker.file) return "";
    return JSON.stringify(this.relativeDescriptor(picker.file));
  }

  status() {
    return {
      started: this.started,
      folderKind: this.config.folderKind,
      folderPath: this.config.folderPath,
      displayFolder: this.config.folderKind === "bundled"
        ? "Included with Even Better BetterBird"
        : (this.folder?.path || ""),
      periodMinutes: this.config.periodMinutes,
      defaultFile: this.config.defaultFile,
      imageCount: this.images.length,
      currentFile: this.currentFile?.leafName || "",
      currentPath: this.currentFile?.path || "",
      sheetRegistered: Boolean(this.sheetURI && sheetService.sheetRegistered(this.sheetURI, sheetService.USER_SHEET)),
      error: this.lastError,
    };
  }

  onShutdown() {
    this.unregisterSheet();
    this.started = false;
  }
};
}
