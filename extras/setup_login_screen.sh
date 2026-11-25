#!/usr/bin/env bash
set -euo pipefail

if [ "${EUID}" -ne 0 ]; then
    echo "Run with sudo: sudo bash $0 [--dual-monitor LEFT_OUT RIGHT_OUT]"
    exit 1
fi

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
TARGET_USER="${SUDO_USER:-$(logname 2>/dev/null || echo '')}"
TARGET_HOME="$(eval echo "~${TARGET_USER}")"

WALLPAPER="$REPO_DIR/wallpaper.jpg"
TARGET_BG="/usr/share/backgrounds/cinnamon-glass-login.jpg"

LEFT_OUT=""
RIGHT_OUT=""
if [ "${1:-}" = "--dual-monitor" ] && [ $# -ge 3 ]; then
    LEFT_OUT="$2"
    RIGHT_OUT="$3"
fi

if [ -f "$WALLPAPER" ]; then
    cp "$WALLPAPER" "$TARGET_BG"
    chmod 644 "$TARGET_BG"
else
    echo "Warning: $WALLPAPER not found, keeping existing login background."
fi

# 1. Sync user avatar if present
if [ -n "$TARGET_USER" ] && [ -f "$TARGET_HOME/.face" ]; then
    cp "$TARGET_HOME/.face" "/var/lib/AccountsService/icons/$TARGET_USER"
    chmod 644 "/var/lib/AccountsService/icons/$TARGET_USER"
fi

# 2. Center cinnamon-screensaver clock at top-center (backup original once)
CLOCK_PY="/usr/share/cinnamon-screensaver/clock.py"
if [ -f "$CLOCK_PY" ]; then
    [ ! -f "${CLOCK_PY}.bak" ] && cp "$CLOCK_PY" "${CLOCK_PY}.bak"
    sed -i 's/Gtk\.Align\.START, Gtk\.Align\.CENTER/Gtk.Align.CENTER, Gtk.Align.START/' "$CLOCK_PY"
fi

# 3. Optional dual-monitor alignment for LightDM
if [ -n "$LEFT_OUT" ] && [ -n "$RIGHT_OUT" ]; then
    cat <<EOF >/usr/local/bin/lightdm-monitors.sh
#!/bin/sh
if xrandr | grep -q "$LEFT_OUT connected" && xrandr | grep -q "$RIGHT_OUT connected"; then
    xrandr --output "$LEFT_OUT" --primary --auto --pos 0x0 --output "$RIGHT_OUT" --auto --right-of "$LEFT_OUT"
fi
EOF
    chmod +x /usr/local/bin/lightdm-monitors.sh
    mkdir -p /etc/lightdm/lightdm.conf.d
    cat <<'EOF' >/etc/lightdm/lightdm.conf.d/50-monitors.conf
[Seat:*]
display-setup-script=/usr/local/bin/lightdm-monitors.sh
EOF
fi

# 4. Clean LightDM Slick Greeter configuration (backup original once)
GREETER_CONF="/etc/lightdm/slick-greeter.conf"
[ -f "$GREETER_CONF" ] && [ ! -f "${GREETER_CONF}.bak" ] && cp "$GREETER_CONF" "${GREETER_CONF}.bak"

ICON_THEME="Mint-Y-Dark"
if [ -d "/usr/share/icons/kora" ] || [ -d "$TARGET_HOME/.icons/kora" ]; then
    ICON_THEME="kora"
elif [ -d "/usr/share/icons/Papirus-Dark" ]; then
    ICON_THEME="Papirus-Dark"
fi

CURSOR_THEME="DMZ-White"
if [ -d "/usr/share/icons/Bibata-Modern-Classic" ]; then
    CURSOR_THEME="Bibata-Modern-Classic"
fi

cat <<EOF >"$GREETER_CONF"
[Greeter]
background=$TARGET_BG
draw-user-backgrounds=false
draw-grid=false
content-align=center
only-on-monitor=0
theme-name=Mint-Y-Dark-Grey
icon-theme-name=$ICON_THEME
cursor-theme-name=$CURSOR_THEME
cursor-theme-size=24
font-name=Barlow 11
show-clock=true
clock-format=%a %b %e  %l:%M %p
show-hostname=false
show-a11y=false
stretch-background-across-monitors=false
activate-numlock=true
EOF

echo "Login & Lock Screen updated cleanly."
