"use strict";
{

const { ExtensionCommon } = ChromeUtils.importESModule(
  "resource://gre/modules/ExtensionCommon.sys.mjs"
);
const { MailServices } = ChromeUtils.importESModule(
  "resource:///modules/MailServices.sys.mjs"
);
const observerService = Components.classes[
  "@mozilla.org/observer-service;1"
].getService(Components.interfaces.nsIObserverService);
const windowMediator = Components.classes[
  "@mozilla.org/appshell/window-mediator;1"
].getService(Components.interfaces.nsIWindowMediator);
const idnService = Components.classes[
  "@mozilla.org/network/idn-service;1"
].getService(Components.interfaces.nsIIDNService);

const DOMAIN_ICON_PREFIX = "nature-glass-domain-";
const NEGATIVE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_ICON_BYTES = 1024 * 1024;
const MAX_CONCURRENT_LOOKUPS = 4;
const ICON_EXTENSIONS = ["svg", "png", "jpg", "gif", "webp", "ico"];
const CONTENT_TYPE_EXTENSIONS = new Map([
  ["image/svg+xml", "svg"],
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/gif", "gif"],
  ["image/webp", "webp"],
  ["image/x-icon", "ico"],
  ["image/vnd.microsoft.icon", "ico"],
]);

var senderAvatars = class extends ExtensionCommon.ExtensionAPI {
  constructor(...args) {
    super(...args);
    this.started = false;
    this.windowStates = new Map();
    this.windowObserver = null;
    this.photoSpecCache = new Map();
    this.domainIconSpecCache = new Map();
    this.domainIconPromises = new Map();
    this.activeLookups = 0;
    this.lookupWaiters = [];
  }

  getAPI() {
    return {
      senderAvatars: {
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
          window.addEventListener(
            "load",
            () => this.attachWindow(window),
            { once: true }
          );
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
      documentObserver: null,
      threadObserver: null,
      threadDocument: null,
      scheduled: false,
      scheduledTimer: null,
      retryTimer: null,
      unload: null,
    };
    const findThreadDocument = () => {
      const seen = new Set();
      const walk = document => {
        if (!document || seen.has(document)) {
          return null;
        }
        seen.add(document);
        if (document.documentURI === "about:3pane") {
          return document;
        }
        for (const element of document.querySelectorAll(
          "browser, iframe, frame"
        )) {
          try {
            const found = walk(element.contentDocument);
            if (found) {
              return found;
            }
          } catch (_) {}
        }
        return null;
      };
      return walk(window.document);
    };
    const connectThreadDocument = () => {
      const document = findThreadDocument();
      const threadTree = document?.getElementById("threadTree");
      if (!document || !threadTree) {
        return false;
      }
      if (state.threadDocument === document && state.threadObserver) {
        return true;
      }
      state.threadObserver?.disconnect();
      state.threadDocument = document;
      const decorate = () => {
        state.scheduled = false;
        state.scheduledTimer = null;
        if (this.started && this.windowStates.has(window)) {
          this.decorateCards(document);
        }
      };
      const schedule = () => {
        if (!state.scheduled) {
          state.scheduled = true;
          state.scheduledTimer = window.setTimeout(decorate, 0);
        }
      };
      state.threadObserver = new document.defaultView.MutationObserver(schedule);
      state.threadObserver.observe(threadTree, {
        characterData: true,
        childList: true,
        subtree: true,
      });
      schedule();
      return true;
    };

    if (!connectThreadDocument()) {
      state.documentObserver = new window.MutationObserver(() => {
        if (connectThreadDocument()) {
          state.documentObserver?.disconnect();
          state.documentObserver = null;
          window.clearInterval(state.retryTimer);
          state.retryTimer = null;
        }
      });
      state.documentObserver.observe(window.document.documentElement, {
        childList: true,
        subtree: true,
      });
      state.retryTimer = window.setInterval(() => {
        if (connectThreadDocument()) {
          state.documentObserver?.disconnect();
          state.documentObserver = null;
          window.clearInterval(state.retryTimer);
          state.retryTimer = null;
        }
      }, 500);
    }

    state.unload = () => this.detachWindow(window);
    window.addEventListener("unload", state.unload, { once: true });
    this.windowStates.set(window, state);
  }

  decorateCards(document) {
    for (const row of document.querySelectorAll(
      "#threadTree tr.card-layout:not([data-properties~='dummy'])"
    )) {
      const card = row.querySelector(".card-container");
      const sender = row.querySelector(".sender");
      if (!card || !sender) {
        continue;
      }

      let avatar = row.querySelector(".nature-glass-sender-avatar");
      if (!avatar) {
        avatar = document.createElement("span");
        avatar.className = "nature-glass-sender-avatar";
        avatar.setAttribute("aria-hidden", "true");
      }
      if (avatar.parentElement !== card) {
        card.prepend(avatar);
      }

      const senderText = sender.textContent.trim();
      const initialText = this.initialsFor(senderText);
      avatar.dataset.tone = this.toneFor(senderText);
      avatar.title = senderText;

      const senderInfo = this.senderInfoForRow(document, row);
      const photoSpec = this.addressBookPhotoForEmail(senderInfo.email);
      if (photoSpec) {
        this.applyPhoto(avatar, photoSpec, "address-book");
      } else {
        const domainIconSpec = this.domainIconFor(senderInfo.domain);
        if (domainIconSpec) {
          this.applyPhoto(avatar, domainIconSpec, "domain-cache");
        } else {
          this.applyInitial(avatar, initialText);
        }
      }
    }
  }

  senderInfoForRow(document, row) {
    if (!Number.isInteger(row._index)) {
      return { email: "", domain: "" };
    }

    try {
      const header = document.defaultView.gDBView?.getMsgHdrAt(row._index);
      if (!header) {
        return { email: "", domain: "" };
      }
      const address = MailServices.headerParser.parseEncodedHeader(
        header.mime2DecodedAuthor || header.author
      )[0];
      const email = (address?.email || "").trim().toLocaleLowerCase();
      return { email, domain: this.domainFromEmail(email) };
    } catch (_) {
      return { email: "", domain: "" };
    }
  }

  addressBookPhotoForEmail(email) {
    if (!email) {
      return "";
    }

    try {
      const contact = MailServices.ab.cardForEmailAddress(email);
      const photoName = contact?.getProperty("PhotoName", "") || "";
      if (!photoName) {
        return "";
      }
      if (this.photoSpecCache.has(photoName)) {
        return this.photoSpecCache.get(photoName);
      }

      const photo = Services.dirsvc.get("ProfD", Components.interfaces.nsIFile);
      photo.append("Photos");
      photo.append(photoName);
      const photoSpec =
        photo.exists() && photo.isFile()
          ? Services.io.newFileURI(photo).spec
          : "";
      this.photoSpecCache.set(photoName, photoSpec);
      return photoSpec;
    } catch (_) {
      return "";
    }
  }

  applyPhoto(avatar, photoSpec, source) {
    avatar.textContent = "";
    avatar.style.backgroundImage = `url("${photoSpec}")`;
    avatar.style.backgroundSize = "cover";
    avatar.style.backgroundPosition = "center";
    avatar.dataset.hasPhoto = "true";
    avatar.dataset.photoSource = source;
  }

  applyInitial(avatar, initialText) {
    avatar.textContent = initialText;
    avatar.style.removeProperty("background-image");
    avatar.style.removeProperty("background-size");
    avatar.style.removeProperty("background-position");
    delete avatar.dataset.hasPhoto;
    delete avatar.dataset.photoSource;
  }

  initialsFor(text) {
    const trimmed = text.trim();
    const localPart = trimmed.includes("@")
      ? trimmed.slice(0, trimmed.lastIndexOf("@"))
      : trimmed;
    const words = localPart.match(/[\p{L}\p{N}]+/gu) || [];
    const firstCharacter = word =>
      [...word].find(character => /[\p{L}\p{N}]/u.test(character)) || "";

    let initials = "";
    if (words.length >= 2) {
      initials = firstCharacter(words[0]) + firstCharacter(words.at(-1));
    } else if (words.length === 1) {
      initials = [...words[0]]
        .filter(character => /[\p{L}\p{N}]/u.test(character))
        .slice(0, 2)
        .join("");
    }
    return (initials || "?").toLocaleUpperCase();
  }

  domainFromEmail(email) {
    const at = email.lastIndexOf("@");
    if (at < 1 || at === email.length - 1) {
      return "";
    }

    try {
      const candidate = email.slice(at + 1)
        .trim()
        .toLocaleLowerCase()
        .replace(/\.$/, "");
      const domain = idnService.convertUTF8toACE(candidate);
      const labels = domain.split(".");
      if (
        labels.length < 2 ||
        domain.length > 253 ||
        !/^[a-z0-9.-]+$/.test(domain) ||
        labels.some(label =>
          !label ||
          label.length > 63 ||
          label.startsWith("-") ||
          label.endsWith("-")
        )
      ) {
        return "";
      }
      return domain;
    } catch (_) {
      return "";
    }
  }

  photosDirectory() {
    const directory = Services.dirsvc.get(
      "ProfD",
      Components.interfaces.nsIFile
    );
    directory.append("Photos");
    if (!directory.exists()) {
      directory.create(Components.interfaces.nsIFile.DIRECTORY_TYPE, 0o700);
    }
    return directory;
  }

  cacheBaseName(domain) {
    return `${DOMAIN_ICON_PREFIX}${domain.replace(/[^a-z0-9.-]/g, "_")}`;
  }

  cacheFile(domain, extension) {
    const file = this.photosDirectory();
    file.append(`${this.cacheBaseName(domain)}.${extension}`);
    return file;
  }

  domainIconFor(domain) {
    if (!domain) {
      return "";
    }
    if (this.domainIconSpecCache.has(domain)) {
      return this.domainIconSpecCache.get(domain);
    }

    for (const extension of ICON_EXTENSIONS) {
      const file = this.cacheFile(domain, extension);
      if (file.exists() && file.isFile() && file.fileSize > 0) {
        const spec = Services.io.newFileURI(file).spec;
        this.domainIconSpecCache.set(domain, spec);
        return spec;
      }
    }

    const negativeMarker = this.cacheFile(domain, "none");
    if (negativeMarker.exists()) {
      if (Date.now() - negativeMarker.lastModifiedTime < NEGATIVE_CACHE_TTL_MS) {
        this.domainIconSpecCache.set(domain, "");
        return "";
      }
      try {
        negativeMarker.remove(false);
      } catch (_) {}
    }

    this.domainIconSpecCache.set(domain, "");
    this.queueDomainIconLookup(domain);
    return "";
  }

  queueDomainIconLookup(domain) {
    if (this.domainIconPromises.has(domain)) {
      return;
    }

    const promise = this.lookupAndCacheDomainIcon(domain)
      .catch(error => {
        Services.console.logStringMessage(
          `[Nature Glass Sender Avatars] Domain lookup failed for ${domain}: ` +
          `${error?.message || error}`
        );
        return "";
      })
      .finally(() => {
        this.domainIconPromises.delete(domain);
        this.redecorateAllWindows();
      });
    this.domainIconPromises.set(domain, promise);
  }

  async acquireLookupSlot() {
    if (this.activeLookups < MAX_CONCURRENT_LOOKUPS) {
      this.activeLookups++;
      return;
    }
    await new Promise(resolve => this.lookupWaiters.push(resolve));
    this.activeLookups++;
  }

  releaseLookupSlot() {
    this.activeLookups--;
    this.lookupWaiters.shift()?.();
  }

  async lookupAndCacheDomainIcon(domain) {
    await this.acquireLookupSlot();
    try {
      const encodedDomain = encodeURIComponent(domain);
      const metadataUrl =
        `https://geticon.dev/api/icon?domain=${encodedDomain}&format=json`;
      const metadataResponse = await this.systemFetch(metadataUrl);
      if (!metadataResponse.ok) {
        return "";
      }
      const metadata = await metadataResponse.json();
      if (
        metadata?.domain?.toLocaleLowerCase() !== domain ||
        metadata?.type === "avatar"
      ) {
        if (metadata?.type === "avatar") {
          await this.writeNegativeMarker(domain);
          Services.console.logStringMessage(
            `[Nature Glass Sender Avatars] Rejected generated avatar for ${domain}`
          );
        }
        return "";
      }

      const imageUrl =
        `https://geticon.dev/api/icon?domain=${encodedDomain}`;
      const imageResponse = await this.systemFetch(imageUrl);
      if (!imageResponse.ok || !imageResponse.url.startsWith("https://")) {
        return "";
      }

      const declaredLength = Number(
        imageResponse.headers.get("content-length") || 0
      );
      if (declaredLength > MAX_ICON_BYTES) {
        return "";
      }
      const contentType = (imageResponse.headers.get("content-type") || "")
        .split(";", 1)[0]
        .trim()
        .toLocaleLowerCase();
      const extension = CONTENT_TYPE_EXTENSIONS.get(contentType);
      if (!extension) {
        return "";
      }

      const bytes = new Uint8Array(await imageResponse.arrayBuffer());
      if (
        bytes.byteLength === 0 ||
        bytes.byteLength > MAX_ICON_BYTES ||
        !this.hasValidImageSignature(bytes, extension)
      ) {
        return "";
      }

      const file = this.cacheFile(domain, extension);
      await IOUtils.write(file.path, bytes);
      const spec = Services.io.newFileURI(file).spec;
      this.domainIconSpecCache.set(domain, spec);
      Services.console.logStringMessage(
        `[Nature Glass Sender Avatars] Cached domain icon for ${domain} as ` +
        file.leafName
      );
      return spec;
    } finally {
      this.releaseLookupSlot();
    }
  }

  systemFetch(url) {
    const fetchWindow =
      windowMediator.getMostRecentWindow("mail:3pane") ||
      windowMediator.getMostRecentWindow(null);
    if (typeof fetchWindow?.fetch !== "function") {
      throw new Error("No active Betterbird window provides fetch()");
    }
    return fetchWindow.fetch(url, {
      cache: "no-store",
      credentials: "omit",
      redirect: "follow",
      referrerPolicy: "no-referrer",
    });
  }

  hasValidImageSignature(bytes, extension) {
    const startsWith = signature =>
      signature.every((value, index) => bytes[index] === value);
    if (extension === "png") {
      return startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    }
    if (extension === "jpg") {
      return startsWith([0xff, 0xd8, 0xff]);
    }
    if (extension === "gif") {
      return startsWith([0x47, 0x49, 0x46, 0x38]);
    }
    if (extension === "webp") {
      return (
        startsWith([0x52, 0x49, 0x46, 0x46]) &&
        bytes[8] === 0x57 && bytes[9] === 0x45 &&
        bytes[10] === 0x42 && bytes[11] === 0x50
      );
    }
    if (extension === "ico") {
      return startsWith([0x00, 0x00, 0x01, 0x00]);
    }
    if (extension === "svg") {
      let prefix = "";
      for (let index = 0; index < Math.min(bytes.length, 4096); index++) {
        prefix += String.fromCharCode(bytes[index]);
      }
      return /<svg[\s>]/i.test(prefix) && !/<script[\s>]/i.test(prefix);
    }
    return false;
  }

  async writeNegativeMarker(domain) {
    const marker = this.cacheFile(domain, "none");
    await IOUtils.writeUTF8(
      marker.path,
      `geticon.dev returned type=avatar for ${domain}\n`
    );
    this.domainIconSpecCache.set(domain, "");
  }

  redecorateAllWindows() {
    for (const [window, state] of this.windowStates) {
      if (!state.threadDocument) {
        continue;
      }
      window.setTimeout(() => {
        if (this.windowStates.has(window)) {
          this.decorateCards(state.threadDocument);
        }
      }, 0);
    }
  }

  toneFor(text) {
    let hash = 0;
    for (const character of text) {
      hash = ((hash << 5) - hash + character.codePointAt(0)) | 0;
    }
    return String(Math.abs(hash) % 4);
  }

  detachWindow(window) {
    const state = this.windowStates.get(window);
    if (!state) {
      return;
    }
    state.documentObserver?.disconnect();
    state.threadObserver?.disconnect();
    if (state.scheduledTimer) {
      window.clearTimeout(state.scheduledTimer);
      state.scheduledTimer = null;
      state.scheduled = false;
    }
    if (state.retryTimer) {
      window.clearInterval(state.retryTimer);
    }
    this.removeAvatarNodes(window.document);
    window.removeEventListener("unload", state.unload);
    this.windowStates.delete(window);
  }

  removeAvatarNodes(document, seen = new Set()) {
    if (!document || seen.has(document)) {
      return;
    }
    seen.add(document);
    for (const avatar of document.querySelectorAll(
      ".nature-glass-sender-avatar"
    )) {
      avatar.remove();
    }
    for (const element of document.querySelectorAll("browser, iframe, frame")) {
      try {
        this.removeAvatarNodes(element.contentDocument, seen);
      } catch (_) {}
    }
  }

  stop() {
    if (this.windowObserver) {
      observerService.removeObserver(this.windowObserver, "domwindowopened");
    }
    this.windowObserver = null;
    this.started = false;
    this.photoSpecCache.clear();
    this.domainIconSpecCache.clear();
    this.domainIconPromises.clear();
    this.lookupWaiters.length = 0;
    this.activeLookups = 0;
    for (const window of [...this.windowStates.keys()]) {
      this.detachWindow(window);
    }
    for (const window of windowMediator.getEnumerator("mail:3pane")) {
      this.removeAvatarNodes(window.document);
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
