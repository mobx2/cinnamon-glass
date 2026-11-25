#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_ROOT="$HOME/.dotfiles-backup"
BACKUP_DIR="$BACKUP_ROOT/$(date +%Y%m%d_%H%M%S)"

DO_DESKTOP=0
DO_ROFI=0
DO_CONKY=0
DO_LOGIN=0
INSTALL_DEPS=1
ASSUME_YES=0

usage() {
    cat <<'EOF'
Usage: ./install.sh [OPTIONS]

Options:
  --all        Install desktop theme/extensions/panel, Rofi Spotlight, and Conky HUD
  --desktop    Install Cinnamon theme, GTK CSS, fonts, icons, extensions & applets
  --rofi       Install Rofi Spotlight config & Alt+Space keybinding
  --conky      Install 4-widget Conky HUD + Cava/MPRIS bridge + systemd units
  --login      Configure LightDM Slick Greeter & centered lock screen (uses sudo)
  --no-deps    Skip apt package installation
  -y, --yes    Non-interactive confirmation
  -h, --help   Show this help message
EOF
}

if [ $# -eq 0 ]; then
    echo "=== cinnamon-glass installer ==="
    echo "1) Full desktop setup (Theme + Cinnamon + Rofi + Conky HUD)"
    echo "2) Desktop theme, extensions & panels only"
    echo "3) Rofi Spotlight launcher only"
    echo "4) Conky HUD (ASCII Fetch + Matrix + Cava + Panel) only"
    echo "5) Full setup + Login/Lock screen (requires sudo)"
    read -rp "Choose an option [1-5] (default 1): " choice
    case "${choice:-1}" in
        1) DO_DESKTOP=1; DO_ROFI=1; DO_CONKY=1 ;;
        2) DO_DESKTOP=1 ;;
        3) DO_ROFI=1 ;;
        4) DO_CONKY=1 ;;
        5) DO_DESKTOP=1; DO_ROFI=1; DO_CONKY=1; DO_LOGIN=1 ;;
        *) echo "Invalid selection."; exit 1 ;;
    esac
else
    while [ $# -gt 0 ]; do
        case "$1" in
            --all) DO_DESKTOP=1; DO_ROFI=1; DO_CONKY=1 ;;
            --desktop) DO_DESKTOP=1 ;;
            --rofi) DO_ROFI=1 ;;
            --conky) DO_CONKY=1 ;;
            --login) DO_LOGIN=1 ;;
            --no-deps) INSTALL_DEPS=0 ;;
            -y|--yes) ASSUME_YES=1 ;;
            -h|--help) usage; exit 0 ;;
            *) echo "Unknown option: $1"; usage; exit 1 ;;
        esac
        shift
    done
fi

# Environment safety checks
if [[ "${XDG_CURRENT_DESKTOP:-}" != *"Cinnamon"* ]] && [ "$ASSUME_YES" -eq 0 ]; then
    read -rp "Warning: Cinnamon desktop not detected (${XDG_CURRENT_DESKTOP:-unknown}). Continue anyway? [y/N]: " ans
    [[ "$ans" =~ ^[Yy]$ ]] || exit 1
fi

if [ "${XDG_SESSION_TYPE:-x11}" = "wayland" ] && [ "$ASSUME_YES" -eq 0 ]; then
    read -rp "Warning: Wayland session detected; Rofi/Conky/GLSL effects target Cinnamon X11. Continue anyway? [y/N]: " ans
    [[ "$ans" =~ ^[Yy]$ ]] || exit 1
fi

create_backup() {
    mkdir -p "$BACKUP_DIR"
    echo "Backing up existing settings to $BACKUP_DIR ..."
    command -v dconf >/dev/null 2>&1 && dconf dump /org/cinnamon/ >"$BACKUP_DIR/cinnamon.dconf" || true
    [ -f "$HOME/.config/gtk-3.0/gtk.css" ] && cp "$HOME/.config/gtk-3.0/gtk.css" "$BACKUP_DIR/gtk.css"
    [ -d "$HOME/.config/rofi" ] && cp -r "$HOME/.config/rofi" "$BACKUP_DIR/rofi"
    [ -d "$HOME/.conky" ] && cp -r "$HOME/.conky" "$BACKUP_DIR/conky"
    [ -f "$HOME/.config/autostart/conky.desktop" ] && cp "$HOME/.config/autostart/conky.desktop" "$BACKUP_DIR/conky.desktop"
    [ -d "$HOME/.config/cinnamon/spices" ] && cp -r "$HOME/.config/cinnamon/spices" "$BACKUP_DIR/spices"
    echo "$BACKUP_DIR" >"$BACKUP_ROOT/latest"
}

install_packages() {
    [ "$INSTALL_DEPS" -eq 0 ] && return 0
    local pkgs=(git curl unzip x11-utils wmctrl)
    [ "$DO_DESKTOP" -eq 1 ] && pkgs+=(bibata-cursor-theme fonts-noto-kufi-arabic fonts-ubuntu)
    [ "$DO_ROFI" -eq 1 ] && pkgs+=(rofi)
    [ "$DO_CONKY" -eq 1 ] && pkgs+=(conky-all cava lm-sensors fonts-noto-cjk python3-gi python3-gi-cairo gir1.2-pango-1.0)

    echo "Installing dependencies via apt: ${pkgs[*]}"
    sudo apt-get update
    sudo apt-get install -y "${pkgs[@]}"
}

install_desktop() {
    echo "Installing fonts, theme, GTK CSS, icons, extensions, and applets..."

    # Fonts & wallpaper
    mkdir -p "$HOME/.local/share/fonts/cinnamon-glass" "$HOME/Pictures/Wallpapers"
    cp -r "$REPO_DIR/assets/fonts/"* "$HOME/.local/share/fonts/cinnamon-glass/"
    command -v fc-cache >/dev/null 2>&1 && fc-cache -f "$HOME/.local/share/fonts/cinnamon-glass" >/dev/null 2>&1 || true
    cp "$REPO_DIR/wallpaper.jpg" "$HOME/Pictures/Wallpapers/cinnamon-glass.jpg"

    # Notification sound
    mkdir -p "$HOME/.local/share/sounds"
    cp "$REPO_DIR/assets/sounds/custom-notification.oga" "$HOME/.local/share/sounds/custom-notification.oga"

    # Cinnamon theme
    mkdir -p "$HOME/.themes"
    rm -rf "$HOME/.themes/Mint-Y-Dark-Grey-Clean"
    cp -a "$REPO_DIR/themes/Mint-Y-Dark-Grey-Clean" "$HOME/.themes/"

    # GTK 3 CSS (non-destructive tagged block)
    mkdir -p "$HOME/.config/gtk-3.0"
    local gtk_css="$HOME/.config/gtk-3.0/gtk.css"
    touch "$gtk_css"
    python3 - "$gtk_css" "$REPO_DIR/themes/gtk-3.0/gtk.css" <<'PY'
import sys, re
dst, src = sys.argv[1], sys.argv[2]
start, end = "/* >>> cinnamon-glass start >>> */", "/* <<< cinnamon-glass end <<< */"
with open(dst, "r", encoding="utf-8") as f:
    existing = f.read()
with open(src, "r", encoding="utf-8") as f:
    block_body = f.read().strip()
existing = re.sub(rf"\n?{re.escape(start)}.*?{re.escape(end)}\n?", "\n", existing, flags=re.S).strip()
new_content = (existing + "\n\n" if existing else "") + f"{start}\n{block_body}\n{end}\n"
with open(dst, "w", encoding="utf-8") as f:
    f.write(new_content)
PY

    # Kora icon theme (cloned cleanly from upstream if missing)
    mkdir -p "$HOME/.icons"
    if [ ! -d "$HOME/.icons/kora" ] && [ ! -d "/usr/share/icons/kora" ]; then
        echo "Cloning Kora icon theme..."
        local tmp_kora
        tmp_kora="$(mktemp -d)"
        if git clone --depth=1 https://github.com/bikass/kora.git "$tmp_kora/kora"; then
            cp -r "$tmp_kora/kora/kora" "$HOME/.icons/"
            command -v gtk-update-icon-cache >/dev/null 2>&1 && gtk-update-icon-cache -f "$HOME/.icons/kora" >/dev/null 2>&1 || true
        else
            echo "Warning: could not download Kora icon theme; keeping current icons."
        fi
        rm -rf "$tmp_kora"
    fi

    # Extensions & applets
    mkdir -p "$HOME/.local/share/cinnamon/extensions" "$HOME/.local/share/cinnamon/applets"
    cp -r "$REPO_DIR/cinnamon/extensions/"* "$HOME/.local/share/cinnamon/extensions/"
    cp -r "$REPO_DIR/cinnamon/applets/"* "$HOME/.local/share/cinnamon/applets/"

    # Spice configs (preserve user's existing pinned-apps if already present, or keep installed apps only)
    mkdir -p "$HOME/.config/cinnamon/spices/calendar@cinnamon.org" \
             "$HOME/.config/cinnamon/spices/menu@cinnamon.org" \
             "$HOME/.config/cinnamon/spices/grouped-window-list@cinnamon.org"
    cp "$REPO_DIR/cinnamon/spices/calendar.json" "$HOME/.config/cinnamon/spices/calendar@cinnamon.org/45.json"
    cp "$REPO_DIR/cinnamon/spices/menu.json" "$HOME/.config/cinnamon/spices/menu@cinnamon.org/32.json"

    local gwl_dst="$HOME/.config/cinnamon/spices/grouped-window-list@cinnamon.org/34.json"
    python3 - "$REPO_DIR/cinnamon/spices/grouped-window-list.json" "$gwl_dst" <<'PY'
import json, os, sys
src, dst = sys.argv[1], sys.argv[2]
with open(src, "r", encoding="utf-8") as f:
    new_cfg = json.load(f)
existing_pinned = None
if os.path.exists(dst):
    try:
        with open(dst, "r", encoding="utf-8") as f:
            existing_pinned = json.load(f).get("pinned-apps", {}).get("value")
    except Exception:
        pass
if existing_pinned:
    new_cfg["pinned-apps"]["value"] = existing_pinned
else:
    app_dirs = ["/usr/share/applications", os.path.expanduser("~/.local/share/applications")]
    filtered = [a for a in new_cfg["pinned-apps"]["value"] if any(os.path.exists(os.path.join(d, a)) for d in app_dirs)]
    if filtered:
        new_cfg["pinned-apps"]["value"] = filtered
with open(dst, "w", encoding="utf-8") as f:
    json.dump(new_cfg, f, indent=4)
PY

    # Apply Cinnamon settings
    gsettings set org.cinnamon.desktop.background picture-uri "file://$HOME/Pictures/Wallpapers/cinnamon-glass.jpg"
    gsettings set org.cinnamon.desktop.background picture-options "zoom"
    gsettings set org.cinnamon.theme name "Mint-Y-Dark-Grey-Clean"
    gsettings set org.cinnamon.desktop.interface gtk-theme "Mint-Y-Dark-Grey"
    gsettings set org.cinnamon.desktop.wm.preferences theme "Mint-Y-Dark-Grey"
    gsettings set org.cinnamon.desktop.interface font-name "Ubuntu 10"
    gsettings set org.cinnamon.desktop.wm.preferences titlebar-font "Barlow Bold 10"
    gsettings set org.cinnamon.desktop.interface clock-use-24h false
    ([ -d "$HOME/.icons/kora" ] || [ -d "/usr/share/icons/kora" ]) && gsettings set org.cinnamon.desktop.interface icon-theme "kora"
    [ -d "/usr/share/icons/Bibata-Modern-Classic" ] && gsettings set org.cinnamon.desktop.interface cursor-theme "Bibata-Modern-Classic"

    gsettings set org.cinnamon panels-enabled "['1:0:bottom', '2:0:top']"
    gsettings set org.cinnamon panels-height "['1:68', '2:28']"
    gsettings set org.cinnamon panels-autohide "['1:intel', '2:false']"
    gsettings set org.cinnamon panels-hide-delay "['1:250', '2:0']"
    gsettings set org.cinnamon panels-show-delay "['1:0', '2:0']"
    gsettings set org.cinnamon panel-zone-icon-sizes '[{"panelId": 1, "left": 0, "center": 38, "right": 18}, {"panelId": 2, "left": 16, "center": 16, "right": 16}]'
    gsettings set org.cinnamon panel-zone-symbolic-icon-sizes '[{"panelId": 1, "left": 28, "center": 28, "right": 18}, {"panelId": 2, "left": 16, "center": 16, "right": 16}]'
    gsettings set org.cinnamon enabled-applets "['panel1:center:0:grouped-window-list@cinnamon.org:34', 'panel2:left:0:menu@cinnamon.org:32', 'panel2:left:1:macos-menubar@local:51', 'panel2:right:0:keyboard@cinnamon.org:40', 'panel2:right:1:control-center@local:50', 'panel2:right:2:calendar@cinnamon.org:45']"
    gsettings set org.cinnamon enabled-extensions "['rounded-corners@local', 'panel-fluid-menus@local', 'adaptive-topbar@local']"
    gsettings set org.cinnamon hotcorner-layout "['scale:true:0', 'scale:false:0', 'scale:false:0', 'desktop:true:0']"
    gsettings set org.nemo.desktop volumes-visible false 2>/dev/null || true

    gsettings set org.cinnamon.sounds notification-enabled true
    gsettings set org.cinnamon.sounds notification-file "$HOME/.local/share/sounds/custom-notification.oga"
    gsettings set org.cinnamon.sounds minimize-enabled false
    gsettings set org.cinnamon.sounds tile-enabled false
}

install_rofi() {
    echo "Installing Rofi Spotlight & binding Alt+Space..."
    mkdir -p "$HOME/.config/rofi"
    cp "$REPO_DIR/rofi/"{config.rasi,spotlight.rasi,launch.sh} "$HOME/.config/rofi/"
    chmod +x "$HOME/.config/rofi/launch.sh"

    # Free Alt+Space from window menu and bind it cleanly in Cinnamon custom keybindings
    gsettings set org.cinnamon.desktop.keybindings.wm activate-window-menu "[]" 2>/dev/null || true
    python3 - "$HOME/.config/rofi/launch.sh" <<'PY'
import ast, subprocess, sys
cmd = sys.argv[1]
raw = subprocess.check_output(["gsettings", "get", "org.cinnamon.desktop.keybindings", "custom-list"], text=True).strip()
if raw.startswith("@as "):
    items = []
else:
    items = ast.literal_eval(raw)

target_slot = None
for slot in items:
    cur_cmd = subprocess.check_output(["gsettings", "get", f"org.cinnamon.desktop.keybindings.custom-keybinding:/org/cinnamon/desktop/keybindings/custom-keybindings/{slot}/", "command"], text=True).strip().strip("'")
    if cur_cmd == cmd or "rofi/launch.sh" in cur_cmd:
        target_slot = slot
        break

if not target_slot:
    idx = 0
    while f"custom{idx}" in items:
        idx += 1
    target_slot = f"custom{idx}"
    items.append(target_slot)
    subprocess.run(["gsettings", "set", "org.cinnamon.desktop.keybindings", "custom-list", str(items)], check=True)

base = f"org.cinnamon.desktop.keybindings.custom-keybinding:/org/cinnamon/desktop/keybindings/custom-keybindings/{target_slot}/"
subprocess.run(["gsettings", "set", base, "name", "Rofi Spotlight"], check=True)
subprocess.run(["gsettings", "set", base, "command", cmd], check=True)
subprocess.run(["gsettings", "set", base, "binding", "['<Alt>space']"], check=True)
PY
}

install_conky() {
    echo "Installing Conky HUD (ASCII Fetch, Matrix Rain, Cava Visualizer, Panel)..."
    mkdir -p "$HOME/.conky" "$HOME/.config/systemd/user" "$HOME/.config/autostart"
    cp -r "$REPO_DIR/conky/"{ascii-fetch,matrix-rain,cava-bar,panel} "$HOME/.conky/"
    cp "$REPO_DIR/conky/conky-startup.sh" "$HOME/.conky/conky-startup.sh"
    chmod +x "$HOME/.conky/conky-startup.sh" "$HOME/.conky/cava-bar/run.sh"
    cp "$REPO_DIR/conky/autostart/conky.desktop" "$HOME/.config/autostart/conky.desktop"
    cp "$REPO_DIR/conky/systemd/"dotfiles-conky-*.service "$HOME/.config/systemd/user/"

    # Auto-adapt right-side Conky panel to the local machine's network, sensors, and CPU thread count
    python3 - "$HOME/.conky/panel/conkyrc.conf" <<'PY'
import glob, os, re, subprocess, sys
path = sys.argv[1]
with open(path, "r", encoding="utf-8") as f:
    text = f.read()

# 1. Detect active network interface
iface = ""
try:
    out = subprocess.check_output(["ip", "-o", "-4", "route", "show", "to", "default"], text=True)
    for line in out.splitlines():
        parts = line.split()
        if "dev" in parts:
            iface = parts[parts.index("dev") + 1]
            break
except Exception:
    pass
if not iface:
    for n in sorted(os.listdir("/sys/class/net")):
        if n != "lo":
            iface = n
            break
if iface and iface != "wlp3s0":
    text = text.replace("wlp3s0", iface)

# 2. Adapt hwmon CPU/NVMe temperature lines safely
hwmon_names = {}
for p in glob.glob("/sys/class/hwmon/hwmon*/name"):
    try:
        with open(p) as nf:
            hwmon_names[nf.read().strip()] = True
    except Exception:
        pass

cpu_sensor = next((s for s in ("coretemp", "k10temp", "zenpower", "acpitz") if s in hwmon_names), None)
if cpu_sensor:
    cpu_temp = f"${{hwmon {cpu_sensor} temp 1}}°C"
else:
    cpu_temp = "N/A"
if "nvme" in hwmon_names:
    nvme_part = "${alignr}${color3}SSD: ${color}${hwmon nvme temp 1}°C"
else:
    nvme_part = ""
text = re.sub(
    r'^\$\{color3\}Temp:.*$',
    f'${{color3}}Temp: ${{color4}}{cpu_temp}{nvme_part}',
    text,
    flags=re.M,
)

# 3. Adjust CPU core bars to actual logical cores (max 16)
cores = min(os.cpu_count() or 4, 16)
core_lines = []
for i in range(1, cores + 1, 2):
    voff = "${voffset 5}" if i == 1 else "${voffset 2}"
    left = f"{voff}${{color3}}{i:2d}${{goto 45}}$color${{cpu cpu{i}}}%${{goto 85}}${{color4}}${{cpubar cpu{i} 13, 60}}"
    if i + 1 <= cores:
        right = f"${{goto 170}}${{color3}}{i+1:2d}${{goto 195}}$color${{cpu cpu{i+1}}}%${{goto 235}}${{color4}}${{cpubar cpu{i+1} 13, 60}}"
    else:
        right = ""
    core_lines.append(left + right)
text = re.sub(
    r'(# CPU CORES\n#------------+\n# uncomment according to number of cores\n).*?(#\n#------------+\n# GPU)',
    lambda m: m.group(1) + "\n".join(core_lines) + "\n" + m.group(2),
    text,
    flags=re.S,
)

with open(path, "w", encoding="utf-8") as f:
    f.write(text)
PY

    systemctl --user daemon-reload
    # Prevent login kill race: conky-startup.sh launches them cleanly after desktop settles
    systemctl --user disable dotfiles-conky-ascii.service dotfiles-conky-matrix.service dotfiles-conky-cava.service >/dev/null 2>&1 || true
    sh "$HOME/.conky/conky-startup.sh" &
}

create_backup
install_packages
[ "$DO_DESKTOP" -eq 1 ] && install_desktop
[ "$DO_ROFI" -eq 1 ] && install_rofi
[ "$DO_CONKY" -eq 1 ] && install_conky
[ "$DO_LOGIN" -eq 1 ] && sudo bash "$REPO_DIR/extras/setup_login_screen.sh"

# Reload Cinnamon cleanly if running
if [ "$DO_DESKTOP" -eq 1 ] && command -v dbus-send >/dev/null 2>&1 && [ -n "${DISPLAY:-}" ]; then
    for ext in rounded-corners@local panel-fluid-menus@local adaptive-topbar@local; do
        dbus-send --session --dest=org.Cinnamon --type=method_call /org/Cinnamon org.Cinnamon.ReloadXlet string:"$ext" string:"EXTENSION" >/dev/null 2>&1 || true
    done
fi

echo ""
echo "Done! Backup saved at: $BACKUP_DIR"
echo "If panels or GTK look off, log out and log back in (or press Alt+F2 -> r -> Enter)."
