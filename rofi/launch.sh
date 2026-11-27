#!/usr/bin/env bash
# Toggle Rofi if already open
if pkill -x rofi 2>/dev/null; then
    exit 0
fi

# Launch Rofi as a normal window so Cinnamon's Super+Space language switcher works natively inside it!
rofi -show drun -normal-window &
ROFI_PID=$!

# Hide from dock/pager, keep above, ensure focus so Escape & typing work immediately,
# and auto-close whenever focus leaves Rofi (including empty desktop clicks).
(
    ROFI_WIN=""
    # Wait up to 1.5s for Rofi window to appear and configure/focus it immediately
    for _ in $(seq 1 50); do
        kill -0 "$ROFI_PID" 2>/dev/null || exit 0
        ROFI_WIN="$(wmctrl -lx 2>/dev/null | awk 'tolower($3) ~ /rofi/ {print $1; exit}')"
        if [[ -n "$ROFI_WIN" ]]; then
            wmctrl -i -r "$ROFI_WIN" -b add,skip_taskbar,skip_pager 2>/dev/null
            wmctrl -i -r "$ROFI_WIN" -b add,above 2>/dev/null
            wmctrl -i -a "$ROFI_WIN" 2>/dev/null
            break
        fi
        sleep 0.03
    done

    SEEN_FOCUS=0
    while kill -0 "$ROFI_PID" 2>/dev/null; do
        WIN_ID="$(xprop -root _NET_ACTIVE_WINDOW 2>/dev/null | awk '{print $NF}')"
        if [[ -z "$WIN_ID" || "$WIN_ID" == "0x0" ]]; then
            if [[ "$SEEN_FOCUS" -eq 1 ]]; then
                kill "$ROFI_PID" 2>/dev/null
                break
            fi
        else
            CLASS="$(xprop -id "$WIN_ID" WM_CLASS 2>/dev/null)"
            if [[ "$CLASS" == *"rofi"* || "$CLASS" == *"Rofi"* ]]; then
                SEEN_FOCUS=1
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
