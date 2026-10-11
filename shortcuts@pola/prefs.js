import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const home = GLib.get_home_dir();
const tildify = p => p.startsWith(home) ? `~${p.slice(home.length)}` : p;
const isUrl = s => /^https?:\/\//.test(s);

// Removed entries are hosts, app ids or folder paths; show each the way the board does.
const describe = key => {
    if (key.startsWith('/') || key.startsWith('~'))
        return {title: GLib.path_get_basename(key), subtitle: tildify(key), icon: 'folder-symbolic'};
    if (key.endsWith('.desktop')) {
        const app = Gio.DesktopAppInfo.new(key);
        return {title: app?.get_name() ?? key, subtitle: 'App', icon: 'application-x-executable-symbolic'};
    }
    return {title: key, subtitle: 'Website', icon: 'web-browser-symbolic'};
};

const iconButton = (icon, tooltip, onClick) => {
    const btn = new Gtk.Button({icon_name: icon, tooltip_text: tooltip, valign: Gtk.Align.CENTER, css_classes: ['flat']});
    btn.connect('clicked', onClick);
    return btn;
};

export default class ShortcutsPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window._settings = settings;   // keep alive for the lifetime of the window
        window.set_default_size(560, 680);
        window.add(this._boardPage(settings));
        window.add(this._listsPage(window, settings));
    }

    _boardPage(settings) {
        const page = new Adw.PreferencesPage({title: 'Board', icon_name: 'view-app-grid-symbolic'});

        const tiles = new Adw.PreferencesGroup({title: 'Tiles', description: 'How many of each the board shows. 0 hides a section.'});
        for (const [key, title, subtitle] of [
            ['sites', 'Websites', 'Most visited, from browser history'],
            ['apps', 'Apps', 'Most used, as in GNOME’s Frequent view'],
            ['folders', 'Folders', 'Most used, from recent files and Files bookmarks'],
            ['columns', 'Tiles per row', null],
        ]) {
            const row = new Adw.SpinRow({
                title, subtitle,
                adjustment: new Gtk.Adjustment({lower: key === 'columns' ? 2 : 0, upper: key === 'columns' ? 10 : 60, step_increment: 1}),
            });
            settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
            tiles.add(row);
        }
        page.add(tiles);

        const history = new Adw.PreferencesGroup({
            title: 'History',
            description: 'Websites come from Brave, Chrome, Chromium, Edge, Vivaldi, Opera and Firefox history of the last 90 days. ' +
                'Everything is read locally; nothing leaves this computer.',
        });
        const refresh = new Adw.SpinRow({
            title: 'Re-rank every', subtitle: 'Minutes; checked when the board opens',
            adjustment: new Gtk.Adjustment({lower: 5, upper: 1440, step_increment: 5, page_increment: 60}),
        });
        settings.bind('refresh-minutes', refresh, 'value', Gio.SettingsBindFlags.DEFAULT);
        history.add(refresh);
        page.add(history);
        return page;
    }

    _listsPage(window, settings) {
        const page = new Adw.PreferencesPage({title: 'Pinned & Removed', icon_name: 'view-pin-symbolic'});

        // --- pinned
        const pinned = new Adw.PreferencesGroup({title: 'Pinned', description: 'Always shown first in their section.'});
        const add = new Adw.EntryRow({title: 'Add a website (https://…) or folder path', show_apply_button: true});
        const pin = value => {
            value = value.trim();
            if (!value) return;
            if (!isUrl(value)) {
                if (/^[\w-]+(\.[\w-]+)+(\/.*)?$/.test(value)) value = `https://${value}`;   // "github.com" -> URL
                else if (!GLib.file_test(value.replace(/^~/, home), GLib.FileTest.IS_DIR)) {
                    add.add_css_class('error');
                    return;
                }
            }
            add.remove_css_class('error');
            const list = settings.get_strv('pinned');
            if (!list.includes(value)) settings.set_strv('pinned', [...list, value]);
            add.text = '';
        };
        add.connect('apply', () => pin(add.text));
        add.connect('changed', () => add.remove_css_class('error'));
        add.add_suffix(iconButton('folder-open-symbolic', 'Choose a folder', () => {
            const dialog = new Gtk.FileDialog({title: 'Pin a folder'});
            dialog.select_folder(window, null, (d, res) => {
                try { pin(d.select_folder_finish(res).get_path()); } catch (_e) { /* cancelled */ }
            });
        }));
        pinned.add(add);
        page.add(pinned);

        // --- removed
        const removed = new Adw.PreferencesGroup({title: 'Removed tiles', description: 'Removed with the × on a tile. They stay off the board until restored.'});
        const restoreAll = new Gtk.Button({label: 'Restore all', valign: Gtk.Align.CENTER, css_classes: ['flat']});
        restoreAll.connect('clicked', () => settings.set_strv('hidden', []));
        removed.set_header_suffix(restoreAll);
        page.add(removed);

        // rows are rebuilt from the settings whenever the lists change (also from the board)
        let rows = [];
        const rebuild = () => {
            for (const [group, row] of rows) group.remove(row);
            rows = [];
            const push = (group, row) => { group.add(row); rows.push([group, row]); };

            for (const value of settings.get_strv('pinned')) {
                const row = new Adw.ActionRow({
                    title: isUrl(value) ? GLib.Uri.parse(value, GLib.UriFlags.NONE).get_host() : GLib.path_get_basename(value),
                    subtitle: isUrl(value) ? value : tildify(value.replace(/^~/, home)),
                });
                row.add_prefix(new Gtk.Image({icon_name: isUrl(value) ? 'web-browser-symbolic' : 'folder-symbolic'}));
                row.add_suffix(iconButton('user-trash-symbolic', 'Unpin', () =>
                    settings.set_strv('pinned', settings.get_strv('pinned').filter(v => v !== value))));
                push(pinned, row);
            }

            const hidden = settings.get_strv('hidden');
            restoreAll.sensitive = hidden.length > 0;
            if (!hidden.length)
                push(removed, new Adw.ActionRow({title: 'No removed tiles', sensitive: false}));
            for (const key of hidden) {
                const {title, subtitle, icon} = describe(key);
                const row = new Adw.ActionRow({title, subtitle});
                row.add_prefix(new Gtk.Image({icon_name: icon}));
                row.add_suffix(iconButton('edit-undo-symbolic', 'Restore', () =>
                    settings.set_strv('hidden', settings.get_strv('hidden').filter(k => k !== key))));
                push(removed, row);
            }
        };
        rebuild();
        const ids = ['changed::pinned', 'changed::hidden'].map(sig => settings.connect(sig, rebuild));
        window.connect('close-request', () => ids.forEach(id => settings.disconnect(id)));
        return page;
    }
}
