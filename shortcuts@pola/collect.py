#!/usr/bin/env python3
"""Rank the most used websites and folders: collect.py [N]

Websites: visits from every Chromium-family profile (Brave, Chrome, Chromium, Edge, Vivaldi)
and Firefox (incl. snap/flatpak), last 90 days, grouped by host and weighted towards recent
use. Folders: GTK recent files (what apps opened or saved) and Files bookmarks, grouped by
the folder they live in. Documents: the most recently used document files (PDF, office,
text) from the same list. Prints JSON {"sites": [...], "places": [...], "documents": [...]}; favicons are written
to ~/.cache/shortcuts-gnome/icons.
"""
import glob
import hashlib
import json
import math
import re
import os
import shutil
import sqlite3
import sys
import tempfile
import time
import urllib.parse
import xml.etree.ElementTree as ET
from collections import defaultdict

HOME = os.path.expanduser('~')
CACHE = os.path.join(os.environ.get('XDG_CACHE_HOME', os.path.join(HOME, '.cache')), 'shortcuts-gnome')
ICONS = os.path.join(CACHE, 'icons')
DAYS = 90
HALF_LIFE = 14 * 86400          # a visit two weeks ago counts half
SKIP_HOSTS = {'localhost', '127.0.0.1', '0.0.0.0', 'newtab', ''}
# profile base -> desktop files that open that browser (first installed one wins)
CHROMIUM = {
    'google-chrome': ['google-chrome.desktop'],
    'google-chrome-beta': ['google-chrome-beta.desktop'],
    'chromium': ['chromium.desktop', 'chromium_chromium.desktop', 'chromium-browser.desktop'],
    'BraveSoftware/Brave-Browser': ['brave-browser.desktop', 'com.brave.Browser.desktop'],
    'microsoft-edge': ['microsoft-edge.desktop'],
    'vivaldi': ['vivaldi-stable.desktop'],
    'opera': ['opera.desktop'],
}
FIREFOX = {
    '.mozilla/firefox': ['firefox.desktop', 'firefox-esr.desktop'],
    'snap/firefox/common/.mozilla/firefox': ['firefox_firefox.desktop'],
    '.var/app/org.mozilla.firefox/.mozilla/firefox': ['org.mozilla.firefox.desktop'],
}


def weight(age):
    return math.pow(0.5, max(age, 0) / HALF_LIFE)


def query(db, sql, args=()):
    """Read a browser database that may be locked by the running browser: work on a copy."""
    with tempfile.TemporaryDirectory() as tmp:
        copy = os.path.join(tmp, 'db')
        shutil.copy(db, copy)
        for ext in ('-wal', '-journal'):
            if os.path.exists(db + ext):
                shutil.copy(db + ext, copy + ext)
        con = sqlite3.connect(f'file:{copy}?mode=ro', uri=True)
        try:
            return con.execute(sql, args).fetchall()
        finally:
            con.close()


def host_of(url):
    try:
        u = urllib.parse.urlsplit(url)
    except ValueError:
        return None, None
    if u.scheme not in ('http', 'https'):
        return None, None
    host = (u.hostname or '').lower()
    if host in SKIP_HOSTS or host.endswith('.local') or host.startswith('192.168.') or host.startswith('10.'):
        return None, None
    return (host[4:] if host.startswith('www.') else host), u.scheme


def chromium_visits(now):
    for name, apps in CHROMIUM.items():
        for hist in glob.glob(os.path.join(HOME, '.config', name, '*', 'History')):
            # Chromium time: microseconds since 1601-01-01
            since = int((now - DAYS * 86400 + 11644473600) * 1e6)
            try:
                rows = query(hist, 'SELECT u.url, u.title, v.visit_time FROM visits v JOIN urls u ON u.id = v.url '
                                   'WHERE v.visit_time > ?', (since,))
            except sqlite3.Error:
                continue
            for url, title, t in rows:
                yield url, title, t / 1e6 - 11644473600, ('chromium', os.path.dirname(hist), tuple(apps))


def firefox_visits(now):
    for base, apps in FIREFOX.items():
        for places in glob.glob(os.path.join(HOME, base, '*', 'places.sqlite')):
            try:
                rows = query(places, 'SELECT p.url, p.title, v.visit_date FROM moz_historyvisits v '
                                     'JOIN moz_places p ON p.id = v.place_id WHERE v.visit_date > ?',
                             (int((now - DAYS * 86400) * 1e6),))
            except sqlite3.Error:
                continue
            for url, title, t in rows:
                yield url, title, t / 1e6, ('firefox', os.path.dirname(places), tuple(apps))


def favicon(profile, host):
    """Save the browser's own favicon for the host (no network); returns the path or None."""
    kind, path, _apps = profile
    out = os.path.join(ICONS, hashlib.sha1(host.encode()).hexdigest()[:16] + '.png')
    try:
        if kind == 'chromium':
            rows = query(os.path.join(path, 'Favicons'),
                         'SELECT b.image_data, b.width FROM icon_mapping m JOIN favicon_bitmaps b ON b.icon_id = m.icon_id '
                         'WHERE m.page_url LIKE ? OR m.page_url LIKE ? ORDER BY b.width DESC',
                         (f'%://{host}/%', f'%://www.{host}/%'))
        else:
            rows = query(os.path.join(path, 'favicons.sqlite'),
                         'SELECT i.data, i.width FROM moz_pages_w_icons p JOIN moz_icons_to_pages ip ON ip.page_id = p.id '
                         'JOIN moz_icons i ON i.id = ip.icon_id WHERE p.page_url LIKE ? OR p.page_url LIKE ? '
                         'ORDER BY i.width DESC',
                         (f'%://{host}/%', f'%://www.{host}/%'))
    except (sqlite3.Error, OSError):
        return None
    # prefer something around 32-64 px, PNG only (St can't show every format Firefox stores)
    for data, width in sorted(rows, key=lambda r: abs((r[1] or 0) - 48)):
        if data and data[:8] == b'\x89PNG\r\n\x1a\n':
            with open(out, 'wb') as f:
                f.write(data)
            return out
    return None


def site_name(host, titles):
    """Front-page title without unread counters like "(20+) ", else the host."""
    if titles:
        t = re.sub(r'^\(\S+\)\s*', '', max(titles, key=titles.get)).strip()
        t = re.split(r'\s+[|·–—-]\s+', t)[0].strip()   # "Google Maps — Directions" -> "Google Maps"
        if 0 < len(t) <= 24:
            return t
    return host


def top_sites(n, now):
    score = defaultdict(float)
    count = defaultdict(int)
    titles = defaultdict(lambda: defaultdict(float))
    scheme = {}
    profile = {}
    by_profile = defaultdict(lambda: defaultdict(float))   # host -> profile -> score
    for source in (chromium_visits(now), firefox_visits(now)):
        for url, title, t, prof in source:
            host, sch = host_of(url)
            if not host:
                continue
            w = weight(now - t)
            score[host] += w
            count[host] += 1
            scheme.setdefault(host, sch)
            by_profile[host][prof] += w
            # only the front page's title names the site; deeper pages name the page
            if title and urllib.parse.urlsplit(url).path in ('', '/'):
                titles[host][title] += w
    os.makedirs(ICONS, exist_ok=True)
    sites = []
    for host in sorted(score, key=score.get, reverse=True)[:n]:
        # open the site in the browser (and Chromium profile) it is mostly visited with
        kind, path, apps = prof = max(by_profile[host], key=by_profile[host].get)
        profile[host] = prof
        sites.append({
            'browser': list(apps),
            'profile': os.path.basename(path) if kind == 'chromium' else None,
            'host': host,
            'url': f'{scheme[host]}://{host}/',
            'title': site_name(host, titles[host]),
            'visits': count[host],
            'icon': favicon(profile[host], host),
        })
    return sites


def top_places(n, now):
    score = defaultdict(float)
    xbel = os.path.join(HOME, '.local/share/recently-used.xbel')
    try:
        root = ET.parse(xbel).getroot()
    except (OSError, ET.ParseError):
        root = None
    for bm in (root.iter('bookmark') if root is not None else []):
        href = bm.get('href', '')
        if not href.startswith('file://'):
            continue
        path = urllib.parse.unquote(urllib.parse.urlsplit(href).path)
        folder = path if os.path.isdir(path) else os.path.dirname(path)
        if not os.path.isdir(folder) or '/.' in folder.replace(HOME, '', 1) or folder.startswith('/tmp'):
            continue
        stamp = bm.get('modified') or bm.get('visited') or bm.get('added') or ''
        try:
            t = time.mktime(time.strptime(stamp[:19], '%Y-%m-%dT%H:%M:%S')) - time.timezone
        except ValueError:
            t = now
        # every app opening a file in that folder counts; GTK keeps one entry per file
        apps = sum(int(a.get('count', 1)) for a in bm.iter('{http://www.freedesktop.org/standards/desktop-bookmarks}application'))
        score[folder] += max(apps, 1) * weight(now - t)
    # folders bookmarked in Files are an explicit wish; give them a solid base score
    for cfg in ('gtk-3.0/bookmarks', 'gtk-4.0/bookmarks'):
        try:
            with open(os.path.join(HOME, '.config', cfg)) as f:
                for line in f:
                    uri = line.split(' ', 1)[0].strip()
                    if uri.startswith('file://'):
                        folder = urllib.parse.unquote(urllib.parse.urlsplit(uri).path)
                        if os.path.isdir(folder):
                            score[folder] += 3
        except OSError:
            pass
    score.pop(HOME, None)
    return [{'path': p, 'name': os.path.basename(p.rstrip('/')) or p, 'parent': os.path.dirname(p).replace(HOME, '~', 1)}
            for p in sorted(score, key=score.get, reverse=True)[:n]]


DOC_TYPES = ('application/pdf', 'application/rtf', 'application/epub+zip', 'application/msword',
             'application/vnd.ms-', 'application/vnd.openxmlformats-officedocument.',
             'application/vnd.oasis.opendocument.', 'text/plain', 'text/markdown', 'text/csv')
MIME = '{http://www.freedesktop.org/standards/shared-mime-info}mime-type'


def recent_documents(n):
    """Last used documents, newest first; images, videos and code are left to the folders."""
    try:
        root = ET.parse(os.path.join(HOME, '.local/share/recently-used.xbel')).getroot()
    except (OSError, ET.ParseError):
        return []
    docs = {}
    for bm in root.iter('bookmark'):
        href = bm.get('href', '')
        mime = bm.find('.//' + MIME)
        mime = mime.get('type', '') if mime is not None else ''
        if not href.startswith('file://') or not mime.startswith(DOC_TYPES):
            continue
        path = urllib.parse.unquote(urllib.parse.urlsplit(href).path)
        # dotfiles (.env, …) and anything in hidden folders are config, not documents
        if not os.path.isfile(path) or '/.' in path:
            continue
        stamp = max(bm.get('modified') or '', bm.get('visited') or '', bm.get('added') or '')
        if stamp > docs.get(path, ('',))[0]:
            docs[path] = (stamp, mime)
    newest = sorted(docs, key=lambda p: docs[p][0], reverse=True)[:n]
    return [{'path': p, 'name': os.path.basename(p), 'mime': docs[p][1]} for p in newest]


if __name__ == '__main__':
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 10
    now = time.time()
    print(json.dumps({'sites': top_sites(n, now), 'places': top_places(n, now),
                      'documents': recent_documents(n), 'updated': int(now), 'n': n}))
