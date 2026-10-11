# Shortcuts (GNOME Shell extension)

A top-bar board with your 20 most visited websites, 15 most used apps and 10 most used folders, one click each.

- **Websites** are ranked from browser history of the last 90 days, grouped by site and weighted towards recent visits (a visit two weeks ago counts half). Reads every Chromium-family profile (Brave, Chrome, Chromium, Edge, Vivaldi, Opera) and Firefox (also snap and flatpak). Icons are the favicons your browser already stored; nothing is fetched from the network.
- **Apps** use the ranking GNOME keeps for its *Frequent* apps view; a click focuses an app that is already open.
- **Folders** are ranked from GTK's recent files (what apps opened or saved, grouped by folder) plus the folders bookmarked in Files.

Hover a tile and click its × to remove it for good; the next one in the ranking moves up. *Restore removed tiles* brings them all back, or restore single ones in the settings.

History is re-read when the menu opens and the ranking is older than an hour, or with *Refresh from history*. All of it stays on your computer: the ranking is cached in `~/.cache/shortcuts-gnome/`.

**Settings** (*Settings* at the bottom of the board, or `gnome-extensions prefs shortcuts@pola`):

- how many websites, apps and folders to show, and tiles per row
- how often history is re-ranked
- pinned websites or folders, always shown first
- removed tiles, with restore per tile or all at once

Needs `python3` (standard library only).

Install:

```sh
glib-compile-schemas shortcuts@pola/schemas
ln -s "$PWD/shortcuts@pola" ~/.local/share/gnome-shell/extensions/shortcuts@pola
gnome-extensions enable shortcuts@pola   # after restarting the shell (Alt+F2, r)
```

Targets GNOME Shell 46–50.
