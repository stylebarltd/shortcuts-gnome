# Shortcuts (GNOME Shell extension)

<!-- Public repo: keep this file free of personal browsing data and local paths. -->

## What this is
A top-bar board of your most visited websites, most used apps, last used documents and
most used folders, ranked from browser history and GTK recent files, with likes, drag
to reorder and remove. Repo `stylebarltd/shortcuts-gnome` (public).

## Stack & layout
- GNOME Shell extension (GJS), uuid `shortcuts@pola`, shell 46–50, GSettings schema
  `org.gnome.shell.extensions.shortcuts`.
- `shortcuts@pola/extension.js` (board UI) · `prefs.js` (settings) · `schemas/`
- `collect.py`: reads browser history (Chromium-family profiles and others) and recent
  files, ranks them; standard library only. Ranking cache: `~/.cache/shortcuts-gnome/`.

## Commands
```bash
glib-compile-schemas shortcuts@pola/schemas      # after any schema change
ln -s "$PWD/shortcuts@pola" ~/.local/share/gnome-shell/extensions/shortcuts@pola   # once
gnome-extensions enable shortcuts@pola
gnome-extensions prefs shortcuts@pola
journalctl -f -o cat /usr/bin/gnome-shell
```
Reload after a change: X11 `Alt+F2`, `r`; Wayland: log out and back in.

## Gotchas
- Everything stays local: never send history anywhere, never commit cache or sample data.
- History is re-ranked when the menu opens and the ranking is older than an hour.
- Each website opens in the browser it is mostly visited with.
