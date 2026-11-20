const Cinnamon = imports.gi.Cinnamon;
const Clutter = imports.gi.Clutter;
const GObject = imports.gi.GObject;
const Meta = imports.gi.Meta;
const Main = imports.ui.main;
const Mainloop = imports.mainloop;

const EFFECT_NAME = "rounded-corners-local-effect";
const CORNER_RADIUS = 16.0;

const SHADER_DECL = `
uniform vec4 bounds;
uniform vec2 tex_size;
uniform float radius;
`;

const SHADER_CODE = `
vec2 p = cogl_tex_coord_in[0].xy * tex_size;
if (p.x >= bounds.x && p.x <= bounds.z && p.y >= bounds.y && p.y <= bounds.w) {
    vec2 center = (bounds.xy + bounds.zw) * 0.5;
    vec2 half_size = (bounds.zw - bounds.xy) * 0.5;
    vec2 q = abs(p - center) - (half_size - vec2(radius));
    float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
    float mask = 1.0 - smoothstep(-0.75, 0.75, d);
    // Crisp 1.5px border all around the 4 sides and corners
    float border = smoothstep(-2.3, -0.8, d) * mask;
    cogl_color_out.rgb = mix(cogl_color_out.rgb, vec3(1.0, 1.0, 1.0) * cogl_color_out.a, border * 0.16);
    cogl_color_out *= mask;
}
`;

var RoundedCornersEffect = GObject.registerClass(
    { GTypeName: `Cjs_RoundedCornersLocalEffect_${Math.floor(Math.random() * 1000000) + 1}` },
    class RoundedCornersEffect extends Cinnamon.GLSLEffect {
        _init() {
            super._init();
            this._boundsLoc = this.get_uniform_location("bounds");
            this._texSizeLoc = this.get_uniform_location("tex_size");
            this._radiusLoc = this.get_uniform_location("radius");
            this.set_uniform_float(this._radiusLoc, 1, [CORNER_RADIUS]);
        }

        vfunc_build_pipeline() {
            this.add_glsl_snippet(Cinnamon.SnippetHook.FRAGMENT, SHADER_DECL, SHADER_CODE, false);
        }

        updateBounds(x1, y1, x2, y2, w, h) {
            this.set_uniform_float(this._boundsLoc, 4, [x1, y1, x2, y2]);
            this.set_uniform_float(this._texSizeLoc, 2, [Math.max(1.0, w), Math.max(1.0, h)]);
            this.queue_repaint();
        }
    }
);

let _tracked = new Map();
let _wmSignals = [];
let _displaySignals = [];

function _isRofi(metaWindow) {
    return Boolean(metaWindow && (metaWindow.get_wm_class() || "").toLowerCase() === "rofi");
}

function _shouldRound(metaWindow) {
    if (!metaWindow || _isRofi(metaWindow)) return false;
    let type = metaWindow.get_window_type();
    return (
        type === Meta.WindowType.NORMAL ||
        type === Meta.WindowType.DIALOG ||
        type === Meta.WindowType.MODAL_DIALOG ||
        type === Meta.WindowType.UTILITY
    );
}

function _centerRofiWindow(metaWindow, actor) {
    if (!metaWindow) return;
    let primaryIdx = Main.layoutManager.primaryIndex;
    let mon = Main.layoutManager.primaryMonitor;
    if (!mon) return;

    let rect = metaWindow.get_frame_rect();
    let w = rect.width > 0 ? rect.width : 640;
    let h = rect.height > 0 ? rect.height : 460;
    let x = mon.x + Math.round((mon.width - w) / 2);
    let y = mon.y + Math.round((mon.height - h) / 2);

    try {
        if (metaWindow.get_monitor() !== primaryIdx) {
            metaWindow.move_to_monitor(primaryIdx);
        }
        metaWindow.move_frame(false, x, y);
        metaWindow.make_above();
    } catch (e) {}

    if (actor && !actor.is_finalized()) {
        actor.remove_all_transitions();
        actor.set_translation(0, 0, 0);
        actor.set_scale(1, 1);
        actor.set_pivot_point(0, 0);
        actor.opacity = 255;
    }
}

function _getTarget(actor) {
    if (!actor || actor.is_finalized()) return null;
    let surface = actor.get_first_child();
    return (surface && !surface.is_finalized()) ? surface : actor;
}

function _updateActor(actor) {
    if (!actor || actor.is_finalized()) return;
    let entry = _tracked.get(actor);
    if (!entry) return;

    let metaWindow = actor.meta_window;
    if (!metaWindow) return;

    let target = entry.target;
    if (!target || target.is_finalized()) return;

    let effect = target.get_effect(EFFECT_NAME);
    if (!effect) return;

    // Apply ONLY on the primary monitor and ONLY for non-maximized/non-fullscreen windows
    // so maximized apps merge seamlessly into the adaptive top bar!
    if (
        metaWindow.get_monitor() !== Main.layoutManager.primaryIndex ||
        metaWindow.get_maximized() === Meta.MaximizeFlags.BOTH ||
        metaWindow.is_fullscreen()
    ) {
        let key = "off";
        if (entry.lastKey === key) return;
        entry.lastKey = key;
        effect.enabled = false;
        return;
    }

    let buf = metaWindow.get_buffer_rect();
    let frame = metaWindow.get_frame_rect();
    if (buf.width <= 0 || buf.height <= 0 || frame.width <= 0 || frame.height <= 0) {
        let key = "off";
        if (entry.lastKey === key) return;
        entry.lastKey = key;
        effect.enabled = false;
        return;
    }

    let x1 = frame.x - buf.x;
    let y1 = frame.y - buf.y;
    let x2 = x1 + frame.width;
    let y2 = y1 + frame.height;
    let key = `on|${x1}|${y1}|${x2}|${y2}|${buf.width}|${buf.height}`;
    if (entry.lastKey === key) return;
    entry.lastKey = key;

    effect.enabled = true;
    effect.updateBounds(x1, y1, x2, y2, buf.width, buf.height);
}

function _attach(actor) {
    if (!actor || _tracked.has(actor)) return;
    let metaWindow = actor.meta_window;
    if (!_shouldRound(metaWindow)) return;

    let target = _getTarget(actor);
    if (!target) return;

    let effect = new RoundedCornersEffect();
    target.add_effect_with_name(EFFECT_NAME, effect);

    let winSignals = [
        metaWindow.connect("size-changed", () => _updateActor(actor)),
        metaWindow.connect("position-changed", () => _updateActor(actor)),
        metaWindow.connect("notify::maximized-horizontally", () => _updateActor(actor)),
        metaWindow.connect("notify::maximized-vertically", () => _updateActor(actor)),
        metaWindow.connect("notify::fullscreen", () => _updateActor(actor)),
    ];

    let actorDestroyId = actor.connect("destroy", () => _detach(actor));

    _tracked.set(actor, { metaWindow, target, winSignals, actorDestroyId, lastKey: null });
    _updateActor(actor);
}

function _detach(actor) {
    let entry = _tracked.get(actor);
    if (!entry) return;
    _tracked.delete(actor);

    try {
        for (let id of entry.winSignals) {
            entry.metaWindow.disconnect(id);
        }
    } catch (e) {}

    try {
        if (entry.target && !entry.target.is_finalized()) {
            let effect = entry.target.get_effect(EFFECT_NAME);
            if (effect) {
                entry.target.remove_effect(effect);
            }
        }
    } catch (e) {}

    try {
        if (!actor.is_finalized()) {
            actor.disconnect(entry.actorDestroyId);
        }
    } catch (e) {}
}

function init() {}

function enable() {
    global.get_window_actors().forEach((actor) => _attach(actor));

    _wmSignals.push(
        global.window_manager.connect("map", (wm, actor) => _attach(actor)),
        global.window_manager.connect_after("map", (wm, actor) => {
            if (actor && !actor.is_finalized() && _isRofi(actor.meta_window)) {
                _centerRofiWindow(actor.meta_window, actor);
                Mainloop.idle_add(() => {
                    if (!actor.is_finalized() && actor.meta_window) {
                        _centerRofiWindow(actor.meta_window, actor);
                    }
                    return false;
                });
            }
        }),
        global.window_manager.connect("unminimize", (wm, actor) => {
            if (!actor || actor.is_finalized()) return;
            // Hide the 80ms Chromium/Electron _GTK_FRAME_EXTENTS resize jump,
            // then smoothly reveal the window at its final settled dimensions.
            actor.remove_all_transitions();
            actor.set_pivot_point(0.5, 0.5);
            actor.set_scale(0.96, 0.96);
            actor.opacity = 0;
            Mainloop.timeout_add(95, () => {
                if (actor.is_finalized()) return false;
                _updateActor(actor);
                actor.ease({
                    opacity: 255,
                    scale_x: 1.0,
                    scale_y: 1.0,
                    duration: 150,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                    onComplete: () => {
                        if (!actor.is_finalized()) {
                            actor.set_pivot_point(0, 0);
                        }
                    },
                });
                return false;
            });
        }),
        global.window_manager.connect("size-changed", (wm, actor) => _updateActor(actor))
    );

    _displaySignals.push(
        global.display.connect("window-created", (display, metaWindow) => {
            let actor = metaWindow.get_compositor_private();
            if (_isRofi(metaWindow)) {
                _centerRofiWindow(metaWindow, actor);
            }
            if (actor) _attach(actor);
        })
    );
}

function disable() {
    for (let id of _wmSignals) {
        global.window_manager.disconnect(id);
    }
    _wmSignals = [];

    for (let id of _displaySignals) {
        global.display.disconnect(id);
    }
    _displaySignals = [];

    Array.from(_tracked.keys()).forEach((actor) => _detach(actor));
    _tracked.clear();
}
