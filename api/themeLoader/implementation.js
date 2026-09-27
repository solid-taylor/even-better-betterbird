"use strict";
{

const { ExtensionCommon } = ChromeUtils.importESModule(
  "resource://gre/modules/ExtensionCommon.sys.mjs"
);
const { classes: Cc, interfaces: Ci } = Components;

const sheetService = Cc["@mozilla.org/content/style-sheet-service;1"]
  .getService(Ci.nsIStyleSheetService);

var themeLoader = class extends ExtensionCommon.ExtensionAPI {
  constructor(...args) {
    super(...args);
    this.started = false;
    this.sheetURIs = [];
    this.rootURI = null;
  }

  getAPI(context) {
    this.rootURI = context.extension.rootURI;
    return {
      themeLoader: {
        start: async () => this.start(),
      },
    };
  }

  start() {
    if (this.started) return;
    this.started = true;
    for (const path of ["styles/userChrome.css", "styles/userContent.css"]) {
      const uri = Services.io.newURI(this.rootURI.resolve(path));
      if (!sheetService.sheetRegistered(uri, sheetService.USER_SHEET)) {
        sheetService.loadAndRegisterSheet(uri, sheetService.USER_SHEET);
      }
      this.sheetURIs.push(uri);
    }
  }

  onShutdown() {
    for (const uri of this.sheetURIs) {
      if (sheetService.sheetRegistered(uri, sheetService.USER_SHEET)) {
        sheetService.unregisterSheet(uri, sheetService.USER_SHEET);
      }
    }
    this.sheetURIs = [];
    this.started = false;
  }
};
}
