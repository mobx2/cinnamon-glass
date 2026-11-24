require 'cairo'

local BARS = 48
local DATA_PATH = "/dev/shm/cava_desktop.dat"
local VER_PATH = "/dev/shm/cava_nowplaying.ver"
local PNG_PATH = "/dev/shm/cava_nowplaying.png"

local smooth = {}
for i = 1, BARS do smooth[i] = 0.0 end

local tick = 0
local last_ver = ""
local np_active = false
local np_alpha = 0.0
local np_surf = nil

local function check_now_playing()
    local f = io.open(VER_PATH, "r")
    if not f then
        np_active = false
        return
    end
    local v = f:read("*l") or ""
    local active = (f:read("*l") or "0") == "1"
    f:close()

    np_active = active
    if v ~= last_ver then
        last_ver = v
        if np_surf then
            cairo_surface_destroy(np_surf)
            np_surf = nil
        end
        if active then
            local s = cairo_image_surface_create_from_png(PNG_PATH)
            if s and cairo_surface_status(s) == CAIRO_STATUS_SUCCESS then
                np_surf = s
            elseif s then
                cairo_surface_destroy(s)
            end
        end
    end
end

local function draw_rounded_bar(cr, x, y, w, h, r)
    if h < 1.5 then return end
    if r > w / 2 then r = w / 2 end
    if r > h / 2 then r = h / 2 end
    cairo_new_sub_path(cr)
    cairo_arc(cr, x + w - r, y + r, r, -math.pi / 2, 0)
    cairo_arc(cr, x + w - r, y + h - r, r, 0, math.pi / 2)
    cairo_arc(cr, x + r, y + h - r, r, math.pi / 2, math.pi)
    cairo_arc(cr, x + r, y + r, r, math.pi, 3 * math.pi / 2)
    cairo_close_path(cr)
end

function conky_draw_cava()
    if conky_window == nil then return end

    tick = tick + 1
    if tick % 10 == 1 then
        check_now_playing()
    end

    local target_alpha = (np_active and np_surf ~= nil) and 1.0 or 0.0
    np_alpha = np_alpha + (target_alpha - np_alpha) * 0.14
    if np_alpha < 0.01 then np_alpha = 0.0 end

    local raw = {}
    local f = io.open(DATA_PATH, "r")
    if f then
        local line = f:read("*l")
        f:close()
        if line then
            local idx = 1
            for val in string.gmatch(line, "([^;]+)") do
                if idx <= BARS then
                    raw[idx] = tonumber(val) or 0
                    idx = idx + 1
                end
            end
        end
    end

    local max_val = 0.0
    for i = 1, BARS do
        local target = raw[i] or 0.0
        if target > smooth[i] then
            smooth[i] = smooth[i] + (target - smooth[i]) * 0.55
        else
            smooth[i] = smooth[i] + (target - smooth[i]) * 0.24
        end
        if smooth[i] < 0.35 then smooth[i] = 0.0 end
        if smooth[i] > max_val then max_val = smooth[i] end
    end

    -- Completely invisible when silent and nothing is playing!
    if max_val < 0.8 and np_alpha <= 0.01 then return end

    local W = conky_window.width
    local H = conky_window.height

    local cs = cairo_xlib_surface_create(
        conky_window.display,
        conky_window.drawable,
        conky_window.visual,
        W,
        H
    )
    local cr = cairo_create(cs)

    -- 1. Blit pre-rendered PangoCairo label (perfect Arabic/RTL + English!)
    if np_alpha > 0.01 and np_surf ~= nil then
        cairo_set_source_surface(cr, np_surf, 0, 0)
        cairo_paint_with_alpha(cr, np_alpha)
    end

    -- 2. Draw Cava Equalizer Bars
    if max_val >= 0.8 then
        local gap = 5
        local total_gap = gap * (BARS - 1)
        local bar_w = math.floor((W - 20 - total_gap) / BARS)
        if bar_w < 4 then bar_w = 4 end
        local used_w = bar_w * BARS + total_gap
        local start_x = math.floor((W - used_w) / 2)
        local max_h = H - 78
        local base_y = H - 6

        local pat = cairo_pattern_create_linear(0, base_y, 0, base_y - max_h)
        cairo_pattern_add_color_stop_rgba(pat, 0.00, 0.54, 0.71, 0.98, 0.78) -- #89B4FA Blue
        cairo_pattern_add_color_stop_rgba(pat, 0.55, 0.71, 0.75, 1.00, 0.88) -- #B4BEFE Lavender
        cairo_pattern_add_color_stop_rgba(pat, 1.00, 0.80, 0.65, 0.97, 0.96) -- #CBA6F7 Mauve

        cairo_set_source(cr, pat)

        for i = 1, BARS do
            local v = smooth[i]
            if v >= 0.8 then
                local h = (v / 100.0) * max_h
                local x = start_x + (i - 1) * (bar_w + gap)
                local y = base_y - h
                draw_rounded_bar(cr, x, y, bar_w, h, bar_w / 2)
                cairo_fill(cr)
            end
        end

        cairo_pattern_destroy(pat)
    end

    cairo_destroy(cr)
    cairo_surface_destroy(cs)
end
