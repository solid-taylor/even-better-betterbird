# Even Better BetterBird

**Even Better BetterBird** is a single-install enhancement package for
[Betterbird](https://www.betterbird.eu/). It combines the complete Nature Glass
visual experience with practical improvements for mail reading, sender
identification, calendars, the Today Pane, composing, and wallpaper rotation.

Install one `.xpi` file and restart Betterbird. No manual `userChrome.css`
editing is required.

> Tested with Betterbird 140.13.0 on Windows. Betterbird 140 or newer is
> required. This is an independent community project and is not affiliated with
> the Betterbird or Thunderbird teams.

## What it changes

### A complete Nature Glass interface

- A forest photograph flows through the application frame.
- Dark teal and charcoal glass panels keep mail readable without hiding the
  wallpaper completely.
- Consistent translucent controls, restrained borders, rounded corners, and
  clear hover, focus, selected, and disabled states.
- Coordinated styling for the Mail view, message reader, folder pane, message
  list, tabs, toolbars, menus, status bar, Address Book, composer, Calendar,
  Tasks, event windows, and calendar-management dialogs.
- A balanced 2 px wallpaper blur and carefully tuned Forest tint improve text
  clarity while retaining the original Nature Glass character.

### Clearer message list

- Message cards are visually separated without turning the list into a set of
  opaque boxes.
- Date/group headers use a neutral frosted treatment that remains distinct from
  ordinary messages.
- Unread messages receive a discreet sage accent on the individual unread row
  only—not every message in the same conversation or group.
- Starred messages and messages carrying Betterbird's **Important** tag use a
  warm gold accent inspired by the Today Pane.
- Selected messages retain their own clear outline and remain distinguishable
  from unread and important states.
- Long subjects preserve access to star and tag controls.

### Smarter sender avatars

The message list chooses the best available identity image in this order:

1. the sender's individual Address Book photo;
2. a cached icon for the sender's domain or its public-suffix-aware base domain;
3. a bold two-letter monogram derived from the sender's display name.

Contacts that exist in the Address Book but have no photo are still eligible
for a domain icon. Contacts with an individual photo always keep that photo.

Domain icons are requested from `geticon.dev` using the domain only—the full
email address is never sent. For a sender on a subdomain, the add-on also checks
the registrable base domain, such as `apple.com` for
`news@insideapple.apple.com`. If Geticon has only a generated placeholder, the
add-on can make a credential-free HTTPS request for the base domain's standard
site icon. Accepted images are cached in the active profile's `Photos` folder.
Generated placeholder avatars are rejected, and failed lookups are temporarily
cached so Betterbird does not repeatedly request them.

### Safer light and dark message reading

- Betterbird's per-message light/dark switch remains functional.
- Newsletter templates that correctly support light and dark presentation keep
  their own design.
- In dark mode, the add-on detects catastrophically low-contrast direct text and
  repairs only the unreadable foreground instead of flattening the entire
  message into one color scheme.
- Bright author-created panels and full dark newsletters remain readable across
  the templates tested during development.

### A more useful Today Pane

- The day selector is permanently available as a compact, functional two-month
  calendar.
- Selecting a date continues to use Betterbird's native agenda navigation.
- **Today** and the currently selected date use clearly different accents.
- Event rows receive a subtle wash based on their Betterbird calendar color,
  making calendar sources recognizable at a glance.
- Importance highlighting understands title markers (`⁎`, `⁑`, `⁂`),
  Betterbird event priority, and the **Important** category. The strongest
  applicable importance level wins.
- Past events remain subdued while retaining a reduced calendar-source tint.

### Restyled Calendar and Tasks

- Day, Week, Multiweek, and Month views share the Nature Glass canvas while
  retaining functional differences for today, weekends, off-hours, and selected
  days.
- The active view mode is visibly selected.
- The mini-month, event finder, task list, event editor, task editor, event
  viewer, Create Calendar flow, and Calendar Properties are included in the
  visual system.
- Calendar event colors remain intact.
- Event descriptions and invitation details remain readable in summary windows.

### Wallpaper rotation

- The included Nature Glass wallpaper works immediately after installation.
- Choose any local folder containing JPG, JPEG, PNG, WebP, GIF, or BMP files.
- Set a rotation interval from 1 to 1,440 minutes; the default is 15 minutes.
- Use **Show next now** to test the selected folder immediately.
- If the chosen folder is inside the active Betterbird profile, the add-on saves
  a profile-relative path so a portable profile can continue working on another
  machine or drive.
- Folders outside the profile use an absolute machine-specific path.
- When present, `background.jpg` is always the first wallpaper.

### BetterBird looks like this:
<img width="1808" height="1006" alt="image" src="https://github.com/user-attachments/assets/7d2da4b8-9ff3-452c-a559-7a85978697fa" />

### Starting from this look:
<img width="1517" height="957" alt="image" src="https://github.com/user-attachments/assets/d87384c6-461b-4965-a243-e101b4279e7f" />


## Installation

1. Download the latest `even-better-betterbird-*.xpi` from the GitHub Releases
   page.
2. In Betterbird, open **Add-ons and Themes**.
3. Open the gear menu and choose **Install Add-on From File…**.
4. Select the downloaded XPI and approve the requested Betterbird access.
5. Restart Betterbird if requested.

The add-on uses privileged Betterbird integration because ordinary web-extension
permissions cannot style Betterbird's internal interface or connect message rows
to Address Book and Calendar data.

### Existing Nature Glass users

This package replaces the separate Nature Glass Sender Avatars, Message
Contrast, Agenda Importance, Two-Month Calendar, and Wallpaper Changer add-ons.
Disable or remove those separate add-ons before installing the unified package
to avoid duplicated observers and styling. Your Address Book photos and cached
domain images are not deleted.

## Wallpaper settings

Open **Add-ons and Themes**, select **Even Better BetterBird**, and open its
Preferences/Options page.

- **Choose folder…** selects a wallpaper directory.
- **Change wallpaper every** controls the interval in minutes.
- **Show next now** advances immediately.
- **Use included default** returns to the built-in Nature Glass wallpaper.
- **Save settings** applies the chosen folder and interval.

The selected wallpaper is shared by every themed Betterbird surface, including
the main window, standalone message readers, composers, Address Book, Calendar,
Tasks, and related dialogs. Message and compose canvases still respect their
light/dark content mode so readability is preserved.

## Removing the add-on

Disable or remove **Even Better BetterBird** from Add-ons and Themes, then
restart Betterbird. The runtime theme and interface enhancements are removed and
Betterbird returns to its normal interface.

For privacy and safety, uninstalling does not delete user data. Previously
cached domain icons may remain as `nature-glass-domain-*` files in the active
profile's `Photos` folder; they can be removed manually after Betterbird is
closed if desired.

## Privacy and network use

Most features work entirely inside Betterbird. External requests are limited to
automatic sender-domain icon lookup:

- service: `https://geticon.dev/`;
- transmitted value: the sender's domain or registrable base domain, never the
  complete email address;
- fallback: if Geticon has no real icon, a credential-free, no-referrer HTTPS
  request may check `/favicon.ico` and `/apple-touch-icon.png` on that same base
  domain; redirects to a different registrable domain are rejected;
- storage: accepted icons and bounded negative-cache markers are kept locally in
  the current Betterbird profile;
- limits: images are size-limited and signature-checked before use;
- final fallback: rejected or unavailable icons use the local two-letter
  monogram.

## Compatibility and known limits

- Requires Betterbird 140 or newer.
- Currently developed and tested on Windows with Betterbird 140.13.0.
- Betterbird's internal interface is not a stable public API; a future major
  Betterbird update may require a matching add-on update.
- Native Windows title bars remain controlled by Windows and are not recolored
  by the add-on.
- Wallpaper folders are read non-recursively; place images directly in the
  selected folder.
- Very unusual HTML email templates may still require a future contrast repair.

## Reporting a problem

When opening a GitHub issue, please include:

- Betterbird version and operating system;
- the affected view (Mail, composer, Calendar, Today Pane, and so on);
- whether the problem occurs in message light mode, dark mode, or both;
- a screenshot with private mail content obscured;
- the smallest sequence of steps that reproduces it.

## License

Even Better BetterBird is released under the [MIT License](LICENSE).
