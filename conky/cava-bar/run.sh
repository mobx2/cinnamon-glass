#!/usr/bin/env bash
set -e
rm -f /dev/shm/cava_desktop.dat /dev/shm/cava_desktop.dat.tmp \
      /dev/shm/cava_nowplaying.png /dev/shm/cava_nowplaying.png.tmp \
      /dev/shm/cava_nowplaying.ver /dev/shm/cava_nowplaying.ver.tmp

cleanup() {
    kill "$CAVA_PID" "$MPRIS_PID" "$CONKY_PID" 2>/dev/null || true
    rm -f /dev/shm/cava_desktop.dat /dev/shm/cava_desktop.dat.tmp \
          /dev/shm/cava_nowplaying.png /dev/shm/cava_nowplaying.png.tmp \
          /dev/shm/cava_nowplaying.ver /dev/shm/cava_nowplaying.ver.tmp
}
trap cleanup EXIT INT TERM

# 1. Feed Cava raw ASCII bars atomically into RAM (/dev/shm)
python3 -u -c '
import os, subprocess
p = subprocess.Popen(
    ["/usr/bin/stdbuf", "-oL", "/usr/bin/cava", "-p", os.path.expanduser("~/.conky/cava-bar/cava.conf")],
    stdout=subprocess.PIPE,
    stderr=subprocess.DEVNULL,
    text=True,
    bufsize=1,
)
tmp = "/dev/shm/cava_desktop.dat.tmp"
dst = "/dev/shm/cava_desktop.dat"
for line in p.stdout:
    if line and line[0].isdigit():
        with open(tmp, "w") as f:
            f.write(line)
        os.replace(tmp, dst)
' &
CAVA_PID=$!

# 2. Poll Spotify (and fallback MPRIS2 players) and pre-render crisp PangoCairo PNG
#    (full HarfBuzz Arabic shaping + RTL/BiDi + Barlow/Noto Kufi Arabic fallback)
python3 -u -c '
import os, time
import gi
gi.require_version("Pango", "1.0")
gi.require_version("PangoCairo", "1.0")
from gi.repository import Gio, GLib, Pango, PangoCairo
import cairo

bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
png_tmp = "/dev/shm/cava_nowplaying.png.tmp"
png_dst = "/dev/shm/cava_nowplaying.png"
ver_tmp = "/dev/shm/cava_nowplaying.ver.tmp"
ver_dst = "/dev/shm/cava_nowplaying.ver"

W, H = 680, 72
last = None
ver = 0

def render_label(title, artist):
    surf = cairo.ImageSurface(cairo.FORMAT_ARGB32, W, H)
    cr = cairo.Context(surf)

    def draw_pango(text, font_str, y, rgba):
        if not text:
            return
        layout = PangoCairo.create_layout(cr)
        layout.set_width((W - 40) * Pango.SCALE)
        layout.set_alignment(Pango.Alignment.CENTER)
        layout.set_ellipsize(Pango.EllipsizeMode.END)
        layout.set_auto_dir(True)
        layout.set_font_description(Pango.FontDescription(font_str))
        layout.set_text(text, -1)

        # Soft dark drop shadow
        cr.save()
        cr.move_to(20, y + 1.5)
        cr.set_source_rgba(0.03, 0.04, 0.06, 0.68)
        PangoCairo.show_layout(cr, layout)
        cr.restore()

        # Crisp foreground text
        cr.save()
        cr.move_to(20, y)
        cr.set_source_rgba(*rgba)
        PangoCairo.show_layout(cr, layout)
        cr.restore()

    draw_pango(title, "Barlow, Noto Kufi Arabic Bold 15", 8, (0.98, 0.99, 1.00, 0.96))
    draw_pango(artist, "Barlow, Noto Kufi Arabic Medium 10.5", 38, (0.71, 0.75, 1.00, 0.90))

    surf.write_to_png(png_tmp)
    os.replace(png_tmp, png_dst)

def get_playing():
    try:
        names = bus.call_sync(
            "org.freedesktop.DBus", "/org/freedesktop/DBus",
            "org.freedesktop.DBus", "ListNames", None, None, 0, -1, None
        ).unpack()[0]
    except Exception:
        return "", ""
    mpris = [n for n in names if n.startswith("org.mpris.MediaPlayer2.")]
    mpris.sort(key=lambda n: (0 if "spotify" in n.lower() else 1, n))
    for m in mpris:
        try:
            proxy = Gio.DBusProxy.new_sync(
                bus, 0, None, m, "/org/mpris/MediaPlayer2",
                "org.freedesktop.DBus.Properties", None
            )
            st = proxy.call_sync(
                "Get", GLib.Variant("(ss)", ("org.mpris.MediaPlayer2.Player", "PlaybackStatus")),
                0, -1, None
            ).unpack()[0]
            if st != "Playing":
                continue
            md = proxy.call_sync(
                "Get", GLib.Variant("(ss)", ("org.mpris.MediaPlayer2.Player", "Metadata")),
                0, -1, None
            ).unpack()[0]
            title = str(md.get("xesam:title") or "").strip()
            artists = md.get("xesam:artist") or []
            artist = ", ".join(str(a).strip() for a in artists if str(a).strip())
            if title:
                return title, artist
        except Exception:
            continue
    return "", ""

while True:
    title, artist = get_playing()
    key = (title, artist)
    if key != last:
        last = key
        ver += 1
        if title:
            render_label(title, artist)
            state = f"{ver}\n1\n"
        else:
            state = f"{ver}\n0\n"
        with open(ver_tmp, "w") as f:
            f.write(state)
        os.replace(ver_tmp, ver_dst)
    time.sleep(1.0)
' &
MPRIS_PID=$!

# 3. Launch transparent Cairo Conky widget
/usr/bin/conky -c "$HOME/.conky/cava-bar/conkyrc.conf" &
CONKY_PID=$!

wait -n "$CAVA_PID" "$MPRIS_PID" "$CONKY_PID"
