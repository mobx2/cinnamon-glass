#!/usr/bin/env bash
# Toggle Rofi if already open
if pkill -x rofi 2>/dev/null; then
    exit 0
fi

# Launch Rofi as a normal window so Cinnamon's Super+Space language switcher works natively inside it!
rofi -show drun -normal-window &
ROFI_PID=$!

# Hide from dock/pager, keep above, and auto-close if the user clicks outside (focus leaves Rofi).
# Exact centering on primary monitor HDMI-1 is handled natively by Muffin (rounded-corners@local).
(
    SEEN_FOCUS=0
    while kill -0 "$ROFI_PID" 2>/dev/null; do
        WIN_ID="$(xprop -root _NET_ACTIVE_WINDOW 2>/dev/null | awk '{print $NF}')"
        if [[ -n "$WIN_ID" && "$WIN_ID" != "0x0" ]]; then
            CLASS="$(xprop -id "$WIN_ID" WM_CLASS 2>/dev/null)"
            if [[ "$CLASS" == *"rofi"* || "$CLASS" == *"Rofi"* ]]; then
                if [[ "$SEEN_FOCUS" -eq 0 ]]; then
                    SEEN_FOCUS=1
                    wmctrl -i -r "$WIN_ID" -b add,above,skip_taskbar,skip_pager 2>/dev/null
                fi
            elif [[ "$SEEN_FOCUS" -eq 1 ]]; then
                kill "$ROFI_PID" 2>/dev/null
                break
            fi
        fi
        sleep 0.04
    done
) &
WATCH_PID=$!

wait "$ROFI_PID" 2>/dev/null
kill "$WATCH_PID" 2>/dev/null || true
