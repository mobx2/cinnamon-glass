#!/bin/sh

killall conky 2>/dev/null || true
pkill -f "cava-bar/run.sh" 2>/dev/null || true
sleep 4s

systemctl --user import-environment DISPLAY XAUTHORITY 2>/dev/null || true
conky -c "$HOME/.conky/panel/conkyrc.conf" >/dev/null 2>&1 &
systemctl --user restart dotfiles-conky-ascii.service dotfiles-conky-matrix.service dotfiles-conky-cava.service >/dev/null 2>&1 &
exit 0
