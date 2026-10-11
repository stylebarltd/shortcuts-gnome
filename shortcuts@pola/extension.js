import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Shell from 'gi://Shell';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

const CONFIG_PATH = GLib.build_filenamev([GLib.get_user_config_dir(), 'shortcuts-gnome', 'config.json']);
const CACHE_PATH = GLib.build_filenamev([GLib.get_user_cache_dir(), 'shortcuts-gnome', 'top.json']);
const DEFAULTS = {
    sites: 15,               // how many tiles per section
    apps: 10,
    folders: 5,
    columns: 5,
    refreshMinutes: 60,      // re-rank history at most this often (checked when the menu opens)
    hide: [],                // hosts ("facebook.com") or folder paths to leave out
    pin: [],                 // extra shortcuts shown first: "https://…" or "/path/to/folder"
};
const TILE = 104;

// St.BoxLayout swapped `vertical` for `orientation` in GNOME 48
const vbox = params => {
    const box = new St.BoxLayout(params);
    if ('orientation' in box) box.orientation = Clutter.Orientation.VERTICAL;
    else box.vertical = true;
    return box;
};

const readJson = path => {
    try {
        const [, bytes] = GLib.file_get_contents(path);
        return JSON.parse(new TextDecoder().decode(bytes));
    } catch (_e) { return null; }
};

const home = GLib.get_home_dir();
const tildify = p => p.startsWith(home) ? `~${p.slice(home.length)}` : p;

// Folder icon as Files shows it (Downloads, Pictures, … get their own).
const folderIcon = path => {
    try {
        return Gio.File.new_for_path(path).query_info('standard::symbolic-icon', Gio.FileQueryInfoFlags.NONE, null)
            .get_symbolic_icon();
    } catch (_e) {
        return new Gio.ThemedIcon({name: 'folder-symbolic'});
    }
};

const Indicator = GObject.registerClass(
class Indicator extends PanelMenu.Button {
    _init() {
        super._init(0.5, 'Shortcuts');
        this.add_style_class_name('shortcuts-button');
        const box = new St.BoxLayout({style_class: 'panel-status-menu-box shortcuts-chip'});
        box.add_child(new St.Icon({icon_name: 'view-app-grid-symbolic', style_class: 'system-status-icon'}));
        this.add_child(box);

        this._board = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        this._grid = vbox({style_class: 'shortcuts-board'});
        this._board.add_child(this._grid);
        this.menu.addMenuItem(this._board);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._refreshItem = new PopupMenu.PopupMenuItem('Refresh from history');
        this.menu.addMenuItem(this._refreshItem);
    }

    onOpen(cb) { this.menu.connect('open-state-changed', (_m, open) => { if (open) cb(); }); }
    onRefresh(cb) { this._refreshItem.connect('activate', cb); }
    setRefreshText(text) { this._refreshItem.label.set_text(text); }

    render(sections, columns) {
        this._grid.destroy_all_children();
        for (const {title, items} of sections) {
            if (!items.length) continue;
            this._grid.add_child(new St.Label({text: title, style_class: 'shortcuts-heading'}));
            for (let i = 0; i < items.length; i += columns) {
                const row = new St.BoxLayout({style_class: 'shortcuts-row'});
                for (const it of items.slice(i, i + columns)) row.add_child(this._tile(it));
                this._grid.add_child(row);
            }
        }
        if (!this._grid.get_n_children())
            this._grid.add_child(new St.Label({text: 'Nothing in your history yet', style_class: 'shortcuts-sub'}));
    }

    _tile(it) {
        const content = vbox({x_align: Clutter.ActorAlign.CENTER});
        let icon;
        if (it.gicon) {
            icon = new St.Icon({gicon: it.gicon, icon_size: 28, x_align: Clutter.ActorAlign.CENTER});
        } else {
            // no favicon stored: a letter badge in a colour derived from the name
            const hue = [...it.title].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 360, 7);
            icon = new St.Label({
                text: it.title.charAt(0).toUpperCase(), style_class: 'shortcuts-badge',
                style: `background-color: hsl(${hue}, 45%, 42%);`, x_align: Clutter.ActorAlign.CENTER,
            });
        }
        content.add_child(icon);
        const name = new St.Label({text: it.title, style_class: 'shortcuts-name', x_align: Clutter.ActorAlign.CENTER});
        name.clutter_text.ellipsize = 3;   // Pango.EllipsizeMode.END
        content.add_child(name);
        if (it.sub) {
            const sub = new St.Label({text: it.sub, style_class: 'shortcuts-sub', x_align: Clutter.ActorAlign.CENTER});
            sub.clutter_text.ellipsize = 2;    // MIDDLE: keeps both ends of a path or host
            content.add_child(sub);
        }

        const btn = new St.Button({
            child: content, style_class: 'shortcuts-tile', style: `width: ${TILE}px;`,
            can_focus: true, track_hover: true,
        });
        btn.connect('clicked', () => {
            this.menu.close();
            if (it.app) {
                it.app.activate();   // focuses the app if it is already open
                return;
            }
            try {
                Gio.AppInfo.launch_default_for_uri(it.uri, global.create_app_launch_context(0, -1));
            } catch (e) {
                Main.notifyError('Shortcuts', `Could not open ${it.uri}: ${e.message}`);
            }
        });
        return btn;
    }
});

export default class ShortcutsExtension extends Extension {
    enable() {
        this._cancel = new Gio.Cancellable();
        this._cfg = {...DEFAULTS, ...(readJson(CONFIG_PATH) ?? {})};
        this._indicator = new Indicator();
        this._indicator.onOpen(() => this._maybeRefresh());
        this._indicator.onRefresh(() => this._collect());
        Main.panel.addToStatusArea(this.uuid, this._indicator);
        this._data = readJson(CACHE_PATH);
        this._render();
        this._maybeRefresh();
    }

    disable() {
        this._cancel?.cancel();
        this._cancel = null;
        this._indicator?.destroy();
        this._indicator = null;
        this._data = null;
    }

    _maybeRefresh() {
        const age = Date.now() / 1000 - (this._data?.updated ?? 0);
        if (age > this._cfg.refreshMinutes * 60) this._collect();
    }

    async _collect() {
        if (this._collecting) return;
        this._collecting = true;
        this._indicator?.setRefreshText('Reading history…');
        try {
            const proc = new Gio.Subprocess({
                // ask for a few more than shown so hidden entries can be skipped
                argv: ['python3', GLib.build_filenamev([this.path, 'collect.py']),
                    String(Math.max(this._cfg.sites, this._cfg.folders) + this._cfg.hide.length + 5)],
                flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE,
            });
            proc.init(null);
            const [, out] = await new Promise((res, rej) => proc.communicate_utf8_async(null, this._cancel, (p, r) => {
                try { res(p.communicate_utf8_finish(r)); } catch (e) { rej(e); }
            }));
            this._data = JSON.parse(out);
            GLib.mkdir_with_parents(GLib.path_get_dirname(CACHE_PATH), 0o755);
            GLib.file_set_contents(CACHE_PATH, out);
            this._render();
        } catch (e) {
            if (!this._cancel?.is_cancelled()) console.error(`shortcuts: ${e.message}`);
        } finally {
            this._collecting = false;
            this._indicator?.setRefreshText('Refresh from history');
        }
    }

    _render() {
        if (!this._indicator) return;
        const {hide, pin, columns} = this._cfg;
        const hidden = new Set(hide.map(h => h.replace(/^~/, home)));
        const pinnedSites = pin.filter(p => /^https?:/.test(p)).map(url => {
            const host = GLib.Uri.parse(url, GLib.UriFlags.NONE).get_host().replace(/^www\./, '');
            return {title: host, sub: host, uri: url};
        });
        const pinnedPlaces = pin.filter(p => !/^https?:/.test(p)).map(p => p.replace(/^~/, home));
        const sites = [...pinnedSites, ...(this._data?.sites ?? [])
            .filter(s => !hidden.has(s.host) && !pinnedSites.some(p => p.sub === s.host))
            .map(s => ({
                title: s.title, sub: s.host, uri: s.url,
                gicon: s.icon && GLib.file_test(s.icon, GLib.FileTest.EXISTS)
                    ? new Gio.FileIcon({file: Gio.File.new_for_path(s.icon)}) : null,
            }))].slice(0, this._cfg.sites);
        const places = [...pinnedPlaces, ...(this._data?.places ?? []).map(p => p.path)
            .filter(p => !hidden.has(p) && !pinnedPlaces.includes(p))]
            .filter(p => GLib.file_test(p, GLib.FileTest.IS_DIR))
            .slice(0, this._cfg.folders)
            .map(p => ({
                title: GLib.path_get_basename(p), sub: tildify(GLib.path_get_dirname(p)),
                uri: Gio.File.new_for_path(p).get_uri(), gicon: folderIcon(p),
            }));
        // the same usage ranking GNOME keeps for its "Frequent" apps view
        const apps = Shell.AppUsage.get_default().get_most_used()
            .filter(app => !hidden.has(app.get_id()) && app.get_app_info()?.should_show() !== false)
            .slice(0, this._cfg.apps)
            .map(app => ({title: app.get_name(), sub: '', gicon: app.get_icon(), app}));
        this._indicator.render([
            {title: 'Websites', items: sites},
            {title: 'Apps', items: apps},
            {title: 'Folders', items: places},
        ], columns);
    }
}
