# Shortcuts (GNOME Shell extension)

A top-bar board with your 15 most visited websites, 10 most used apps and 5 most used folders, one click each.

- **Websites** are ranked from browser history of the last 90 days, grouped by site and weighted towards recent visits (a visit two weeks ago counts half). Reads every Chromium-family profile (Brave, Chrome, Chromium, Edge, Vivaldi, Opera) and Firefox (also snap and flatpak). Icons are the favicons your browser already stored; nothing is fetched from the network.
- **Apps** use the ranking GNOME keeps for its *Frequent* apps view; a click focuses an app that is already open.
- **Folders** are ranked from GTK's recent files (what apps opened or saved, grouped by folder) plus the folders bookmarked in Files.

History is re-read when the menu opens and the ranking is older than an hour, or with *Refresh from history*. All of it stays on your computer: the ranking is cached in `~/.cache/shortcuts-gnome/`.

Optional `~/.config/shortcuts-gnome/config.json`:

```json
{"sites": 15, "apps": 10, "folders": 5, "columns": 5, "refreshMinutes": 60,
 "hide": ["facebook.com", "~/Downloads"],
 "pin": ["https://github.com", "~/Development"]}
```

`hide` takes hosts, app ids (`brave-browser.desktop`) or folders to leave out; `pin` adds websites or folders at the front.

Needs `python3` (standard library only).

Install:

```sh
ln -s "$PWD/shortcuts@pola" ~/.local/share/gnome-shell/extensions/shortcuts@pola
gnome-extensions enable shortcuts@pola   # after restarting the shell (Alt+F2, r)
```

Targets GNOME Shell 46–50.
