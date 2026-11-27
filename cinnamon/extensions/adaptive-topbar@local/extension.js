const Clutter = imports.gi.Clutter;
const GLib = imports.gi.GLib;
const Meta = imports.gi.Meta;
const Main = imports.ui.main;
const Mainloop = imports.mainloop;
const Panel = imports.ui.panel;
const St = imports.gi.St;

// Exact Mint-Y-Dark-Grey headerbar / titlebar color (#222226)
const THEME_BG_COLOR = new Clutter.Color({ red: 0x22, green: 0x22, blue: 0x26, alpha: 255 });
const ANIM_MS = 150;
const OVERVIEW_FADE_MS = 160;

let _topPanel = null;
let _container = null;
let _fadeActor = null;
let _bgActor = null;
let _panelSizeIds = [];
let _signals = [];
let _winSignals = new Map();
let _isMaximizedActive = false;
let _inOverviewFade = false;
let _verifyTimerId = 0;
let _initRetryId = 0;
let _initRetries = 0;

// Animated Show Desktop / Peek Desktop state (uses native minimize/unminimize!)
let _hotCornerProto = null;
let _origRunAction = null;
let _peekMinimizedWindows = [];
let _inPeekToggle = false;

// Smart Dock Intellihide (checks ALL visible windows on primary monitor against the actual centered dock pill)
let _bottomPanel = null;
let _origDockUpdateVisibility = null;

function _findBottomPanel() {
    if (!Main.panelManager || !Main.panelManager.panels) return null;
    let primary = Main.layoutManager.primaryIndex;
    for (let p of Main.panelManager.panels) {
        if (p && p.panelPosition === Panel.PanelLoc.bottom && p.monitorIndex === primary) {
            return p;
        }
    }
    return null;
}

function _isRofiWindow(w) {
    if (!w) return false;
    try {
        let cls = (w.get_wm_class() || "").toLowerCase();
        let inst = (w.get_wm_class_instance() || "").toLowerCase();
        return cls.indexOf("rofi") !== -1 || inst.indexOf("rofi") !== -1;
    } catch (e) {
        return false;
    }
}

function _dockHasOverlappingWindow(panel) {
    if (!panel || !panel.monitor || !panel.actor || panel.actor.is_finalized()) return false;
    if (_isInOverviewOrExpo() || _inOverviewFade) return false;

    let ws = global.workspace_manager.get_active_workspace();
    if (!ws) return false;

    let mon = panel.monitor;
    let dockH = panel.actor.height > 0 ? panel.actor.height : 68;
    let dockY = mon.y + mon.height - dockH;

    let pillW = (panel._centerBox && !panel._centerBox.is_finalized() && panel._centerBox.width > 40)
        ? panel._centerBox.width + 16
        : mon.width;
    let dockX = mon.x + Math.round((mon.width - pillW) / 2);

    let windows = ws.list_windows();
    for (let w of windows) {
        if (!w || w.minimized) continue;
        if (w.get_monitor() !== panel.monitorIndex) continue;
        if (_isRofiWindow(w)) continue;

        let type = w.get_window_type();
        if (
            type !== Meta.WindowType.NORMAL &&
            type !== Meta.WindowType.DIALOG &&
            type !== Meta.WindowType.MODAL_DIALOG
        ) continue;

        let actor = w.get_compositor_private();
        if (!actor || actor.is_finalized() || !actor.visible) continue;

        if (w.is_fullscreen()) return true;

        let r = w.get_frame_rect();
        if (
            Math.max(dockX, r.x) < Math.min(dockX + pillW, r.x + r.width) &&
            Math.max(dockY, r.y) < Math.min(dockY + dockH, r.y + r.height)
        ) {
            return true;
        }
    }
    return false;
}

function _installSmartDockIntellihide() {
    _bottomPanel = _findBottomPanel();
    if (!_bottomPanel || _origDockUpdateVisibility) return;

    _origDockUpdateVisibility = _bottomPanel._updatePanelVisibility;
    _bottomPanel._updatePanelVisibility = function() {
        if (this._autohideSettings !== "intel") {
            return _origDockUpdateVisibility.call(this);
        }

        this._mouseEntered = this._mouseOnPanel();
        if (this._panelEditMode || this._highlighted || this._peeking || this._panelHasOpenMenus() || this._mouseEntered) {
            this._shouldShow = true;
        } else {
            this._shouldShow = !_dockHasOverlappingWindow(this);
        }
        this._queueShowHidePanel();
    };
}

function _uninstallSmartDockIntellihide() {
    if (_bottomPanel && _origDockUpdateVisibility) {
        _bottomPanel._updatePanelVisibility = _origDockUpdateVisibility;
        try { _bottomPanel._updatePanelVisibility(); } catch (e) {}
    }
    _origDockUpdateVisibility = null;
    _bottomPanel = null;
}

function _refreshDockVisibility() {
    if (_bottomPanel && _origDockUpdateVisibility) {
        try { _bottomPanel._updatePanelVisibility(); } catch (e) {}
    }
}

function _findTopPanel() {
    if (!Main.panelManager || !Main.panelManager.panels) return null;
    let primary = Main.layoutManager.primaryIndex;
    for (let p of Main.panelManager.panels) {
        if (p && p.panelPosition === Panel.PanelLoc.top && p.monitorIndex === primary) {
            return p;
        }
    }
    return null;
}

function _isInOverviewOrExpo() {
    return Boolean(
        (Main.overview && Main.overview.visible) ||
        (Main.expo && Main.expo.visible)
    );
}

function _isMaximizedOnPrimary(w, forceIncludeWin, excludeWin) {
    if (!w || w === excludeWin) return false;
    if (w !== forceIncludeWin && w.minimized) return false;
    if (w.is_fullscreen()) return false;
    if (w.get_window_type() !== Meta.WindowType.NORMAL) return false;
    if (w.get_monitor() !== Main.layoutManager.primaryIndex) return false;
    if (w.get_maximized() !== Meta.MaximizeFlags.BOTH) return false;

    if (w === forceIncludeWin) return true;

    let actor = w.get_compositor_private();
    if (!actor || actor.is_finalized()) return false;
    // Allow opacity 0 during unminimize animation; only reject explicitly hidden actors
    if (!actor.visible) return false;
    return true;
}

function _hasMaximizedWindowOnPrimary(forceIncludeWin, excludeWin) {
    if (_isInOverviewOrExpo() || _inOverviewFade) return false;

    let ws = global.workspace_manager.get_active_workspace();
    if (!ws) return false;

    let windows = ws.list_windows();
    // If a fullscreen window is active on primary, don't force solid panel
    let primary = Main.layoutManager.primaryIndex;
    for (let w of windows) {
        if (w && !w.minimized && w.get_monitor() === primary && w.is_fullscreen()) {
            return false;
        }
    }

    if (forceIncludeWin && _isMaximizedOnPrimary(forceIncludeWin, forceIncludeWin, excludeWin)) {
        return true;
    }

    for (let w of windows) {
        if (_isMaximizedOnPrimary(w, forceIncludeWin, excludeWin)) {
            return true;
        }
    }
    return false;
}

let _conkyPaused = false;

function _setConkyPaused(paused) {
    if (paused === _conkyPaused) return;
    _conkyPaused = paused;
    try {
        GLib.spawn_command_line_async(
            paused
                ? "sh -c \"pkill -STOP -f '[c]ava-bar/conkyrc.conf'; pkill -STOP -f '[m]atrix-rain/conkyrc.conf'\""
                : "sh -c \"pkill -CONT -f '[c]ava-bar/conkyrc.conf'; pkill -CONT -f '[m]atrix-rain/conkyrc.conf'\""
        );
    } catch (e) {}
}

function _setSolid(instant) {
    if (!_bgActor || _bgActor.is_finalized() || !_fadeActor || _fadeActor.is_finalized()) return;
    if (_isMaximizedActive && !instant) return;
    _isMaximizedActive = true;
    _setConkyPaused(true);

    if (instant) {
        _bgActor.remove_all_transitions();
        _fadeActor.remove_all_transitions();
        _bgActor.opacity = 255;
        _fadeActor.opacity = 0;
    } else {
        _bgActor.ease({
            opacity: 255,
            duration: ANIM_MS,
            mode: Clutter.AnimationMode.EASE_IN_OUT_QUAD,
        });
        _fadeActor.ease({
            opacity: 0,
            duration: ANIM_MS,
            mode: Clutter.AnimationMode.EASE_IN_OUT_QUAD,
        });
    }
}

function _setTransparent(instant) {
    if (!_bgActor || _bgActor.is_finalized() || !_fadeActor || _fadeActor.is_finalized()) return;
    if (!_isMaximizedActive && !instant) return;
    _isMaximizedActive = false;
    _setConkyPaused(false);

    if (instant) {
        _bgActor.remove_all_transitions();
        _fadeActor.remove_all_transitions();
        _bgActor.opacity = 0;
        _fadeActor.opacity = 255;
    } else {
        _bgActor.ease({
            opacity: 0,
            duration: ANIM_MS,
            mode: Clutter.AnimationMode.EASE_IN_OUT_QUAD,
        });
        _fadeActor.ease({
            opacity: 255,
            duration: ANIM_MS,
            mode: Clutter.AnimationMode.EASE_IN_OUT_QUAD,
        });
    }
}

function _scheduleVerify() {
    if (_verifyTimerId) {
        Mainloop.source_remove(_verifyTimerId);
        _verifyTimerId = 0;
    }
    _verifyTimerId = Mainloop.timeout_add(180, () => {
        _verifyTimerId = 0;
        if (_inOverviewFade || _isInOverviewOrExpo() || _inPeekToggle) return false;
        if (_hasMaximizedWindowOnPrimary(null, null)) {
            _setSolid(false);
        } else {
            _setTransparent(false);
        }
        _refreshDockVisibility();
        return false;
    });
}

function _update(instant, forceIncludeWin, excludeWin) {
    if (_inOverviewFade || _isInOverviewOrExpo() || _inPeekToggle) return;
    if (_hasMaximizedWindowOnPrimary(forceIncludeWin || null, excludeWin || null)) {
        _setSolid(Boolean(instant));
    } else {
        _setTransparent(Boolean(instant));
    }
    _refreshDockVisibility();
    if (!instant) _scheduleVerify();
}

function _getVisibleWorkspaceWindows() {
    let ws = global.workspace_manager.get_active_workspace();
    if (!ws) return [];
    let ordered = global.display.sort_windows_by_stacking(ws.list_windows());
    let wins = [];
    for (let w of ordered) {
        if (!w || w.minimized) continue;
        let type = w.get_window_type();
        if (
            type !== Meta.WindowType.NORMAL &&
            type !== Meta.WindowType.DIALOG &&
            type !== Meta.WindowType.MODAL_DIALOG
        ) continue;
        let actor = w.get_compositor_private();
        if (actor && !actor.is_finalized() && actor.visible) {
            wins.push(w);
        }
    }
    return wins;
}

function _animatedToggleDesktop(timestamp) {
    let ts = timestamp || global.get_current_time();
    let visibleWins = _getVisibleWorkspaceWindows();

    if (visibleWins.length > 0) {
        // Minimize all visible windows natively -> exact same minimize animation!
        _inPeekToggle = true;
        _peekMinimizedWindows = visibleWins.slice();
        _setTransparent(true);

        for (let w of visibleWins) {
            try { w.minimize(); } catch (e) {}
        }

        _inPeekToggle = false;
    } else if (_peekMinimizedWindows.length > 0) {
        // Restore previously peek-minimized windows natively -> exact same unminimize animation & 95ms fix!
        _inPeekToggle = true;
        let toRestore = _peekMinimizedWindows.slice();
        _peekMinimizedWindows = [];

        let primary = Main.layoutManager.primaryIndex;
        let hasMax = false;
        let topWin = null;

        for (let w of toRestore) {
            try {
                if (!w || w.get_workspace() !== global.workspace_manager.get_active_workspace()) continue;
                w.unminimize();
                topWin = w;
                if (
                    w.get_monitor() === primary &&
                    !w.is_fullscreen() &&
                    w.get_maximized() === Meta.MaximizeFlags.BOTH &&
                    w.get_window_type() === Meta.WindowType.NORMAL
                ) {
                    hasMax = true;
                }
            } catch (e) {}
        }

        if (topWin) {
            try { topWin.activate(ts); } catch (e) {}
        }

        if (hasMax) _setSolid(true);
        else _setTransparent(true);

        _inPeekToggle = false;
    } else {
        global.workspace_manager.toggle_desktop(ts);
        _scheduleVerify();
    }
}

function _installDesktopPeekAnimation() {
    if (Main.layoutManager && Main.layoutManager.hotCornerManager && Main.layoutManager.hotCornerManager.corners) {
        let corners = Main.layoutManager.hotCornerManager.corners;
        for (let k of Object.keys(corners)) {
            if (corners[k]) {
                _hotCornerProto = Object.getPrototypeOf(corners[k]);
                break;
            }
        }
    }
    if (_hotCornerProto && typeof _hotCornerProto.runAction === "function" && !_origRunAction) {
        _origRunAction = _hotCornerProto.runAction;
        _hotCornerProto.runAction = function (timestamp) {
            if (this.action === "desktop") {
                _animatedToggleDesktop(timestamp);
                return;
            }
            return _origRunAction.call(this, timestamp);
        };
    }

    try {
        Meta.keybindings_set_custom_handler("show-desktop", () => {
            _animatedToggleDesktop(global.get_current_time());
        });
    } catch (e) {}
}

function _uninstallDesktopPeekAnimation() {
    _peekMinimizedWindows = [];
    _inPeekToggle = false;

    if (_hotCornerProto && _origRunAction) {
        _hotCornerProto.runAction = _origRunAction;
    }
    _hotCornerProto = null;
    _origRunAction = null;

    try {
        Meta.keybindings_set_custom_handler("show-desktop", null);
    } catch (e) {}
}

function _trackWindow(win) {
    if (!win || _winSignals.has(win)) return;
    if (win.get_window_type() !== Meta.WindowType.NORMAL) return;

    let ids = [
        win.connect("notify::maximized-horizontally", () => _update(false)),
        win.connect("notify::maximized-vertically", () => _update(false)),
        win.connect("notify::fullscreen", () => _update(false)),
        win.connect("notify::minimized", () => {
            if (_inPeekToggle) return;
            _update(false);
        }),
        win.connect("position-changed", () => { _refreshDockVisibility(); _scheduleVerify(); }),
        win.connect("size-changed", () => { _refreshDockVisibility(); _scheduleVerify(); }),
        win.connect("unmanaged", () => {
            _untrackWindow(win);
            _update(false, null, win);
        }),
    ];
    _winSignals.set(win, ids);
}

function _untrackWindow(win) {
    let ids = _winSignals.get(win);
    if (ids) {
        _winSignals.delete(win);
        try {
            for (let id of ids) win.disconnect(id);
        } catch (e) {}
    }
}

function _syncBgGeometry() {
    if (!_topPanel || !_topPanel.actor || !_container || _container.is_finalized()) return;
    let [x, y] = _topPanel.actor.get_transformed_position();
    let w = _topPanel.actor.width;
    let h = _topPanel.actor.height;
    _container.set_position(x, y);
    _container.set_size(w, h);
    if (_fadeActor && !_fadeActor.is_finalized()) {
        _fadeActor.set_position(0, 0);
        _fadeActor.set_size(w, h);
    }
    if (_bgActor && !_bgActor.is_finalized()) {
        _bgActor.set_position(0, 0);
        _bgActor.set_size(w, h);
    }
}

function _syncBgVisibility() {
    if (!_topPanel || !_topPanel.actor || _topPanel.actor.is_finalized()) return;
    if (!_container || _container.is_finalized()) return;
    if (_inOverviewFade || _isInOverviewOrExpo()) return;
    _container.visible = _topPanel.actor.visible;
}

function _onOverviewOrExpoShowing() {
    _inOverviewFade = true;
    _setConkyPaused(false);
    if (!_container || _container.is_finalized()) return;
    _container.visible = true;
    _container.remove_all_transitions();
    _container.ease({
        opacity: 0,
        duration: OVERVIEW_FADE_MS,
        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
    });
}

function _onOverviewOrExpoHiding() {
    if (!_container || _container.is_finalized()) return;
    _container.visible = true;
    _container.remove_all_transitions();
    _container.ease({
        opacity: 255,
        duration: OVERVIEW_FADE_MS,
        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
    });
}

function _onOverviewOrExpoHidden() {
    _inOverviewFade = false;
    if (_container && !_container.is_finalized()) {
        _container.visible = _topPanel && _topPanel.actor ? _topPanel.actor.visible : true;
        _container.opacity = 255;
    }
    _update(false);
}

function init() {}

function enable() {
    if (_initRetryId) {
        Mainloop.source_remove(_initRetryId);
        _initRetryId = 0;
    }
    _topPanel = _findTopPanel();
    if (!_topPanel || !_topPanel.actor || !_topPanel.actor.get_parent()) {
        if (_initRetries < 15) {
            _initRetries++;
            _initRetryId = Mainloop.timeout_add(300, () => {
                _initRetryId = 0;
                enable();
                return false;
            });
        }
        return;
    }
    _initRetries = 0;

    let parent = _topPanel.actor.get_parent();

    _container = new Clutter.Actor({
        reactive: false,
        opacity: 255,
    });

    // Layer 1: Seamless macOS gradient backdrop
    _fadeActor = new St.Widget({
        reactive: false,
        opacity: 255,
        style: "background-gradient-direction: vertical; background-gradient-start: rgba(8, 10, 14, 0.58); background-gradient-end: rgba(8, 10, 14, 0.0);",
    });
    // Layer 2: Solid Mint-Y-Dark-Grey headerbar color (#222226)
    _bgActor = new Clutter.Actor({
        background_color: THEME_BG_COLOR,
        opacity: 0,
        reactive: false,
    });

    _container.add_child(_fadeActor);
    _container.add_child(_bgActor);

    parent.insert_child_below(_container, _topPanel.actor);
    _topPanel.actor.style = "border-image: none; background-color: transparent;";
    _syncBgGeometry();
    _syncBgVisibility();

    _panelSizeIds.push(
        _topPanel.actor.connect("notify::width", _syncBgGeometry),
        _topPanel.actor.connect("notify::height", _syncBgGeometry),
        _topPanel.actor.connect("notify::allocation", _syncBgGeometry),
        _topPanel.actor.connect("notify::visible", _syncBgVisibility)
    );

    global.get_window_actors().forEach((a) => {
        if (a && a.meta_window) _trackWindow(a.meta_window);
    });

    _signals.push(
        [global.display, global.display.connect("window-created", (d, w) => { _trackWindow(w); _update(false); })],
        [global.display, global.display.connect("notify::focus-window", () => _update(false))],
        [global.display, global.display.connect("window-entered-monitor", () => _update(false))],
        [global.display, global.display.connect("window-left-monitor", () => _update(false))],
        [global.window_manager, global.window_manager.connect("map", (wm, actor) => {
            _peekMinimizedWindows = [];
            _update(false, actor ? actor.meta_window : null, null);
        })],
        [global.window_manager, global.window_manager.connect("minimize", (wm, actor) => {
            if (_inPeekToggle) return;
            _update(false, null, actor ? actor.meta_window : null);
        })],
        [global.window_manager, global.window_manager.connect("unminimize", (wm, actor) => {
            if (_inPeekToggle) return;
            _peekMinimizedWindows = [];
            _update(false, actor ? actor.meta_window : null, null);
        })],
        [global.window_manager, global.window_manager.connect("switch-workspace", () => _update(false))],
        [Main.overview, Main.overview.connect("showing", _onOverviewOrExpoShowing)],
        [Main.overview, Main.overview.connect("hiding", _onOverviewOrExpoHiding)],
        [Main.overview, Main.overview.connect("hidden", _onOverviewOrExpoHidden)]
    );

    if (Main.expo) {
        _signals.push(
            [Main.expo, Main.expo.connect("showing", _onOverviewOrExpoShowing)],
            [Main.expo, Main.expo.connect("hiding", _onOverviewOrExpoHiding)],
            [Main.expo, Main.expo.connect("hidden", _onOverviewOrExpoHidden)]
        );
    }

    _installDesktopPeekAnimation();
    _installSmartDockIntellihide();
    _update(true);
}

function disable() {
    if (_initRetryId) {
        Mainloop.source_remove(_initRetryId);
        _initRetryId = 0;
    }
    _initRetries = 0;
    if (_verifyTimerId) {
        Mainloop.source_remove(_verifyTimerId);
        _verifyTimerId = 0;
    }
    _setConkyPaused(false);
    _uninstallSmartDockIntellihide();
    _uninstallDesktopPeekAnimation();

    for (let [obj, id] of _signals) {
        try { obj.disconnect(id); } catch (e) {}
    }
    _signals = [];

    Array.from(_winSignals.keys()).forEach((w) => _untrackWindow(w));
    _winSignals.clear();

    if (_topPanel && _topPanel.actor && !_topPanel.actor.is_finalized()) {
        for (let id of _panelSizeIds) {
            try { _topPanel.actor.disconnect(id); } catch (e) {}
        }
        _topPanel.actor.style = null;
    }
    _panelSizeIds = [];

    if (_container && !_container.is_finalized()) {
        let p = _container.get_parent();
        if (p) p.remove_child(_container);
        _container.destroy();
    }
    _container = null;
    _bgActor = null;
    _fadeActor = null;
    _topPanel = null;
    _isMaximizedActive = false;
    _inOverviewFade = false;
}
