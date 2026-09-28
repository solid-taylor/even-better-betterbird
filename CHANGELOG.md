# Changelog

## 1.0.4 - 2026-09-28

- Made direct site-icon redirect validation use Betterbird's native URI parser,
  ensuring it also works inside the privileged Experiment API context.

## 1.0.3 - 2026-09-28

- Added public-suffix-aware fallback from sender subdomains to their base domain,
  so addresses such as `news@insideapple.apple.com` and
  `no-reply@connect.etoro.com` can use the Apple and eToro icons.
- Added a validated HTTPS site-icon fallback when Geticon returns only its
  generated letter avatar, while continuing to reject that generated avatar.
- Updated Geticon requests to its current documented `?url=` interface.

## 1.0.2 - 2026-09-27

- Ensured sender-avatar decorations are removed immediately when the add-on is disabled.
- Cancelled pending avatar decoration work during shutdown for clean enable/disable cycles.

## 1.0.1 - 2026-09-27

- Isolated the bundled Experiment API modules so all unified features can start
  together in Betterbird's shared parent-script scope.

## 1.0.0 - 2026-09-27

- First unified community release.
- Bundles the complete Nature Glass interface and included wallpaper.
- Adds sender Address Book photos, cached domain icons, and two-letter monograms.
- Adds adaptive dark-message contrast repair.
- Adds calendar-source colors and importance levels to Today Pane events.
- Adds the permanent functional two-month Today Pane day selector.
- Adds portable, configurable wallpaper rotation.
- Restyles Mail, Address Book, composer, Calendar, Tasks, and related dialogs.
