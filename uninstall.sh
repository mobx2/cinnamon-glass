#!/usr/bin/env bash
set -euo pipefail

BACKUP_ROOT="$HOME/.dotfiles-backup"
LATEST_FILE="$BACKUP_ROOT/latest"

echo "Stopping Conky widgets and systemd user services..."
systemctl --user stop dotfiles-conky-ascii.service dotfiles-conky-matrix.service dotfiles-conky-cava.service 2>/dev/null || true
systemctl --user disable dotfiles-conky-ascii.service dotfiles-conky-matrix.service dotfiles-conky-cava.service 2>/dev/null || true
rm -f "$HOME/.config/systemd/user/dotfiles-conky-ascii.service" \
      "$HOME/.config/systemd/user/dotfiles-conky-matrix.service" \
      "$HOME/.config/systemd/user/dotfiles-conky-cava.service"
systemctl --user daemon-reload 2>/dev/null || true
killall conky 2>/dev/null || true
pkill -f "cava-bar/run.sh" 2>/dev/null || true
rm -f "$HOME/.config/autostart/conky.desktop"

# Strip tagged cinnamon-glass CSS block cleanly without deleting user's own rules
GTK_CSS="$HOME/.config/gtk-3.0/gtk.css"
if [ -f "$GTK_CSS" ]; then
    python3 - "$GTK_CSS" <<'PY'
import re, sys
p = sys.argv[1]
with open(p, "r", encoding="utf-8") as f:
    s = f.read()
s = re.sub(r"\n?/\* >>> cinnamon-glass start >>> \*/.*?/\* <<< cinnamon-glass end <<< \*/\n?", "\n", s, flags=re.S).strip()
with open(p, "w", encoding="utf-8") as f:
    f.write((s + "\n") if s else "")
PY
fi

if [ -f "$LATEST_FILE" ]; then
    BACKUP_DIR="$(cat "$LATEST_FILE")"
    if [ -d "$BACKUP_DIR" ]; then
        echo "Restoring backup from $BACKUP_DIR ..."
        [ -f "$BACKUP_DIR/cinnamon.dconf" ] && dconf load /org/cinnamon/ <"$BACKUP_DIR/cinnamon.dconf"
        [ -f "$BACKUP_DIR/gtk.css" ] && cp "$BACKUP_DIR/gtk.css" "$HOME/.config/gtk-3.0/gtk.css"
        if [ -d "$BACKUP_DIR/rofi" ]; then
            rm -rf "$HOME/.config/rofi"
            cp -r "$BACKUP_DIR/rofi" "$HOME/.config/rofi"
        fi
        if [ -d "$BACKUP_DIR/conky" ]; then
            rm -rf "$HOME/.conky"
            cp -r "$BACKUP_DIR/conky" "$HOME/.conky"
        fi
        [ -f "$BACKUP_DIR/conky.desktop" ] && cp "$BACKUP_DIR/conky.desktop" "$HOME/.config/autostart/conky.desktop"
        if [ -d "$BACKUP_DIR/spices" ]; then
            cp -r "$BACKUP_DIR/spices/"* "$HOME/.config/cinnamon/spices/"
        fi
    fi
else
    echo "No backup found; resetting Cinnamon theme & extensions to defaults..."
    gsettings reset org.cinnamon enabled-extensions 2>/dev/null || true
    gsettings reset org.cinnamon.theme name 2>/dev/null || true
fi

echo "Uninstall complete. Restart Cinnamon (Alt+F2 -> r) or log out and back in."
