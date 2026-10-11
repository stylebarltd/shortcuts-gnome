# Shortcuts (GNOME Shell extension)

A top-bar board with your 18 most visited websites, 12 most used apps, 6 last used documents and 12 most used folders, six to a row, one click each.

- **Websites** are ranked from browser history of the last 90 days, grouped by site and weighted towards recent visits (a visit two weeks ago counts half). Reads every Chromium-family profile (Brave, Chrome, Chromium, Edge, Vivaldi, Opera) and Firefox (also snap and flatpak). Icons are the favicons your browser already stored; nothing is fetched from the network. A site opens in the browser (and Chromium profile) you mostly visit it with.
- **Apps** use the ranking GNOME keeps for its *Frequent* apps view; a click focuses an app that is already open.
- **Documents** are the last used PDFs, office and text files from GTK's recent files (dotfiles left out).
- **Folders** are ranked from GTK's recent files (what apps opened or saved, grouped by folder) plus the folders bookmarked in Files.

Hover a tile for its ♥ and ×. **♥ likes it**: liked tiles stay at the front of their section, even when the history ranking changes. **Drag a tile** onto another to move it there (it gets liked, so the order sticks). **× removes it** for good; the next one in the ranking moves up. *Restore removed tiles* brings them all back, or restore single ones in the settings.

History is re-read when the menu opens and the ranking is older than an hour, or with *Refresh from history*. All of it stays on your computer: the ranking is cached in `~/.cache/shortcuts-gnome/`.

**Settings** (*Settings* at the bottom of the board, or `gnome-extensions prefs shortcuts@pola`):

- how many websites, apps, documents and folders to show, and tiles per row
- how often history is re-ranked
- liked websites, apps or folders, in your order
- removed tiles, with restore per tile or all at once

Needs `python3` (standard library only).

Install:

```sh
glib-compile-schemas shortcuts@pola/schemas
ln -s "$PWD/shortcuts@pola" ~/.local/share/gnome-shell/extensions/shortcuts@pola
gnome-extensions enable shortcuts@pola   # after restarting the shell (Alt+F2, r)
```

Targets GNOME Shell 46–50.
