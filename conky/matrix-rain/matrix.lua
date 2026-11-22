require 'cairo'

local COLS = 22
local ROWS = 29
local CELL_X = 13
local CELL_Y = 15
local FONT_NAME = "Noto Sans Mono CJK JP"
local FONT_SIZE = 12.2

local GLYPHS = {
    "ア","イ","ウ","エ","オ","カ","キ","ク","ケ","コ",
    "サ","シ","ス","セ","ソ","タ","チ","ツ","テ","ト",
    "ナ","ニ","ヌ","ネ","ノ","ハ","ヒ","フ","ヘ","ホ",
    "マ","ミ","ム","メ","モ","ヤ","ユ","ヨ","ラ","リ",
    "ル","レ","ロ","ワ","ン","0","1","2","3","4","5","6","7","8","9"
}

local initialized = false
local streams = {}
local grid = {}

local function rand_glyph()
    return GLYPHS[math.random(1, #GLYPHS)]
end

local function reset_stream(c, random_start)
    streams[c] = {
        y = random_start and (math.random() * (ROWS + 10) - 5) or (-math.random(0, 7)),
        speed = 0.25 + math.random() * 0.42,
        len = math.random(10, 22),
    }
end

local function init_matrix()
    math.randomseed(os.time() + 1337)
    for c = 1, COLS do
        grid[c] = {}
        for r = 1, ROWS do
            grid[c][r] = rand_glyph()
        end
        reset_stream(c, true)
    end
    initialized = true
end

function conky_draw_matrix()
    if conky_window == nil then return end
    if not initialized then init_matrix() end

    local cs = cairo_xlib_surface_create(
        conky_window.display,
        conky_window.drawable,
        conky_window.visual,
        conky_window.width,
        conky_window.height
    )
    local cr = cairo_create(cs)

    cairo_select_font_face(cr, FONT_NAME, CAIRO_FONT_SLANT_NORMAL, CAIRO_FONT_WEIGHT_BOLD)
    cairo_set_font_size(cr, FONT_SIZE)

    for c = 1, COLS do
        local s = streams[c]
        local prev_head = math.floor(s.y)
        s.y = s.y + s.speed
        local head = math.floor(s.y)

        if head ~= prev_head and head >= 1 and head <= ROWS then
            grid[c][head] = rand_glyph()
        end

        if math.random() < 0.16 then
            local mr = head - math.random(1, s.len)
            if mr >= 1 and mr <= ROWS then
                grid[c][mr] = rand_glyph()
            end
        end

        local x = (c - 1) * CELL_X + 4
        for d = 0, s.len do
            local r = head - d
            if r >= 1 and r <= ROWS then
                local edge = 1.0
                if r <= 2 then edge = r / 2.5
                elseif r >= ROWS - 1 then edge = (ROWS - r + 1) / 2.5 end

                if d == 0 then
                    cairo_set_source_rgba(cr, 0.90, 1.00, 0.94, 1.0 * edge)
                elseif d <= 3 then
                    local a = (0.95 - d * 0.05) * edge
                    cairo_set_source_rgba(cr, 0.18, 0.98, 0.44, a)
                else
                    local t = 1.0 - (d / (s.len + 1))
                    local a = (t ^ 1.45) * 0.88 * edge
                    cairo_set_source_rgba(cr, 0.08, 0.80, 0.34, a)
                end

                cairo_move_to(cr, x, r * CELL_Y)
                cairo_show_text(cr, grid[c][r])
            end
        end

        if head - s.len > ROWS + 1 then
            reset_stream(c, false)
        end
    end

    cairo_destroy(cr)
    cairo_surface_destroy(cs)
end
