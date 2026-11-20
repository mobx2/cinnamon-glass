const Applet = imports.ui.applet;
const PopupMenu = imports.ui.popupMenu;
const St = imports.gi.St;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Clutter = imports.gi.Clutter;
const Cvc = imports.gi.Cvc;
const Mainloop = imports.mainloop;
const Util = imports.misc.util;
const ByteArray = imports.byteArray;

function readSysfs(path) {
    try {
        let [ok, bytes] = GLib.file_get_contents(path);
        if (ok) {
            return ByteArray.toString(bytes).trim();
        }
    } catch (e) {}
    return "";
}

function runAsync(argv, callback) {
    try {
        let proc = new Gio.Subprocess({
            argv: argv,
            flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE,
        });
        proc.init(null);
        proc.communicate_utf8_async(null, null, (p, res) => {
            try {
                let [, stdout] = p.communicate_utf8_finish(res);
                if (callback) callback(stdout ? stdout.trim() : "");
            } catch (e) {
                if (callback) callback("");
            }
        });
    } catch (e) {
        if (callback) callback("");
    }
}

class ControlCenterApplet extends Applet.Applet {
    constructor(orientation, panel_height, instance_id) {
        super(orientation, panel_height, instance_id);

        this.setAllowedLayout(Applet.AllowedLayout.HORIZONTAL);
        this.actor.add_style_class_name("cc-panel-box");

        this._panelWifi = new St.Icon({
            icon_name: "network-wireless-signal-excellent-symbolic",
            icon_type: St.IconType.SYMBOLIC,
            icon_size: 16,
            style_class: "cc-panel-icon",
        });
        this._panelVol = new St.Icon({
            icon_name: "audio-volume-high-symbolic",
            icon_type: St.IconType.SYMBOLIC,
            icon_size: 16,
            style_class: "cc-panel-icon",
        });
        this._panelBat = new St.Icon({
            icon_name: "battery-good-symbolic",
            icon_type: St.IconType.SYMBOLIC,
            icon_size: 16,
            style_class: "cc-panel-icon",
        });

        this.actor.add(this._panelWifi);
        this.actor.add(this._panelVol);
        this.actor.add(this._panelBat);

        this.set_applet_tooltip("Control Center");

        this.menuManager = new PopupMenu.PopupMenuManager(this);
        this.menu = new Applet.AppletPopupMenu(this, orientation);
        this.menuManager.addMenu(this.menu);

        this._notifSettings = new Gio.Settings({ schema_id: "org.cinnamon.desktop.notifications" });
        this._soundSettings = new Gio.Settings({ schema_id: "org.cinnamon.desktop.sound" });
        this._maxVolPct = this._soundSettings.get_boolean("allow-amplified-volume") ? 150 : 100;

        this._ampSignalId = this._soundSettings.connect("changed::allow-amplified-volume", () => {
            this._maxVolPct = this._soundSettings.get_boolean("allow-amplified-volume") ? 150 : 100;
            this._syncVolumeFromSink();
        });

        this._updatingSliders = false;
        this._wifiEnabled = true;
        this._btEnabled = false;
        this._openRefreshId = 0;
        this._briThrottleId = 0;
        this._pendingBriPct = null;

        this._sink = null;
        this._sinkVolId = 0;
        this._sinkMuteId = 0;
        this._mediaBusName = null;
        this._mediaPlaying = false;

        this._buildMenu();
        this._initMixer();

        // Initial background populate (non-blocking)
        this._refreshBattery();
        this._refreshDnd();
        this._refreshWifiAsync();
        this._refreshBluetoothAsync();
        this._refreshBrightnessAsync();
        this._refreshMediaAsync();

        // Infrequent lightweight background sync
        this._pollId = Mainloop.timeout_add_seconds(20, () => {
            this._refreshBattery();
            this._refreshWifiAsync();
            return true;
        });

        // CRITICAL FOR ZERO OPEN/CLOSE LAG:
        // Do NOTHING during the open/close animation frames; refresh quietly 220ms AFTER opening completes!
        this.menu.connect("open-state-changed", (menu, isOpen) => {
            if (this._openRefreshId) {
                Mainloop.source_remove(this._openRefreshId);
                this._openRefreshId = 0;
            }
            if (isOpen) {
                this._openRefreshId = Mainloop.timeout_add(220, () => {
                    this._openRefreshId = 0;
                    this._refreshBattery();
                    this._refreshDnd();
                    this._refreshWifiAsync();
                    this._refreshBluetoothAsync();
                    this._refreshBrightnessAsync();
                    this._refreshMediaAsync();
                    return false;
                });
            }
        });
    }

    _initMixer() {
        this._mixer = new Cvc.MixerControl({ name: "Control Center" });
        this._mixerSignals = [
            this._mixer.connect("state-changed", () => this._onMixerReady()),
            this._mixer.connect("default-sink-changed", () => this._bindDefaultSink()),
        ];
        this._mixer.open();
        this._onMixerReady();
    }

    _onMixerReady() {
        if (this._mixer.get_state() === Cvc.MixerControlState.READY) {
            this._volNorm = this._mixer.get_vol_max_norm();
            this._bindDefaultSink();
        }
    }

    _unbindSink() {
        if (this._sink) {
            if (this._sinkVolId) {
                this._sink.disconnect(this._sinkVolId);
                this._sinkVolId = 0;
            }
            if (this._sinkMuteId) {
                this._sink.disconnect(this._sinkMuteId);
                this._sinkMuteId = 0;
            }
            this._sink = null;
        }
    }

    _bindDefaultSink() {
        this._unbindSink();
        if (!this._mixer) return;
        let sink = this._mixer.get_default_sink();
        if (!sink) return;
        this._sink = sink;
        this._sinkVolId = sink.connect("notify::volume", () => this._syncVolumeFromSink());
        this._sinkMuteId = sink.connect("notify::is-muted", () => this._syncVolumeFromSink());
        this._syncVolumeFromSink();
    }

    _syncVolumeFromSink() {
        if (!this._sink || !this._volNorm) return;
        let muted = this._sink.is_muted;
        let pct = Math.round((this._sink.volume / this._volNorm) * 100);
        let maxPct = this._maxVolPct;
        let sliderVal = Math.min(1.0, Math.max(0.0, pct / maxPct));

        let iconName = muted || pct === 0
            ? "audio-volume-muted-symbolic"
            : (pct < 35 ? "audio-volume-low-symbolic" : (pct < 70 ? "audio-volume-medium-symbolic" : "audio-volume-high-symbolic"));

        if (this._panelVol.icon_name !== iconName) this._panelVol.icon_name = iconName;
        if (this._volIcon.icon_name !== iconName) this._volIcon.icon_name = iconName;

        let newText = muted ? "Mute" : (pct + "%");
        if (this._volLabel.text !== newText) this._volLabel.text = newText;

        this._updatingSliders = true;
        this._volSlider.setValue(sliderVal);
        this._updatingSliders = false;
    }

    _buildMenu() {
        let container = new St.BoxLayout({ vertical: true, style_class: "cc-container" });

        // Header Row
        let header = new St.BoxLayout({ style_class: "cc-header" });

        let batPill = new St.BoxLayout({ style_class: "cc-bat-pill" });
        this._hdrBatIcon = new St.Icon({
            icon_name: "battery-good-symbolic",
            icon_type: St.IconType.SYMBOLIC,
            icon_size: 16,
        });
        this._hdrBatLabel = new St.Label({ text: "100%", style_class: "cc-bat-label", y_align: Clutter.ActorAlign.CENTER });
        batPill.add(this._hdrBatIcon);
        batPill.add(this._hdrBatLabel);
        header.add(batPill, { expand: false });

        header.add(new St.Widget(), { expand: true });

        header.add(this._makeRoundBtn("emblem-system-symbolic", () => {
            this.menu.close();
            Util.spawnCommandLine("cinnamon-settings");
        }));
        header.add(this._makeRoundBtn("system-lock-screen-symbolic", () => {
            this.menu.close();
            Util.spawnCommandLine("cinnamon-screensaver-command -l");
        }));
        header.add(this._makeRoundBtn("system-shutdown-symbolic", () => {
            this.menu.close();
            Util.spawnCommandLine("cinnamon-session-quit --power-off");
        }));

        container.add(header);

        // 2x2 Quick Toggle Tiles
        let row1 = new St.BoxLayout({ style_class: "cc-grid-row" });
        this._wifiTile = this._makeTile("network-wireless-signal-excellent-symbolic", "Wi-Fi", "On", () => this._toggleWifi());
        this._btTile = this._makeTile("bluetooth-active-symbolic", "Bluetooth", "Off", () => this._toggleBluetooth());
        row1.add(this._wifiTile.btn, { expand: true });
        row1.add(this._btTile.btn, { expand: true });
        container.add(row1);

        let row2 = new St.BoxLayout({ style_class: "cc-grid-row" });
        this._dndTile = this._makeTile("notifications-disabled-symbolic", "Do Not Disturb", "Off", () => this._toggleDnd());
        this._netTile = this._makeTile("preferences-system-network-symbolic", "Networks", "Manage", () => {
            this.menu.close();
            Util.spawnCommandLine("cinnamon-settings network");
        });
        row2.add(this._dndTile.btn, { expand: true });
        row2.add(this._netTile.btn, { expand: true });
        container.add(row2);

        // Sliders Card
        let slidersCard = new St.BoxLayout({ vertical: true, style_class: "cc-sliders-card" });

        // Volume Slider (100% native Cvc — 0ms in-memory, respects 100% vs 150% amplified setting!)
        let volRow = new St.BoxLayout({ style_class: "cc-slider-row" });
        this._volIcon = new St.Icon({ icon_name: "audio-volume-high-symbolic", icon_type: St.IconType.SYMBOLIC, icon_size: 16 });
        let volBtn = new St.Button({ child: this._volIcon, style_class: "cc-slider-icon-btn", reactive: true, can_focus: true });
        volBtn.connect("clicked", () => {
            if (this._sink) {
                this._sink.change_is_muted(!this._sink.is_muted);
            }
        });
        this._volSlider = new PopupMenu.PopupSliderMenuItem(0.5);
        this._volSlider.actor.style = "padding: 4px 2px; min-width: 195px;";
        this._volSlider.connect("value-changed", (slider, val) => {
            if (this._updatingSliders || !this._sink || !this._volNorm) return;
            let pct = Math.round(val * this._maxVolPct);
            let newVol = Math.round((pct / 100.0) * this._volNorm);
            if (this._sink.is_muted && newVol > 0) {
                this._sink.change_is_muted(false);
            }
            this._sink.volume = newVol;
            this._sink.push_volume();
            this._volLabel.text = pct + "%";
        });
        this._volLabel = new St.Label({ text: "50%", style_class: "cc-slider-val", y_align: Clutter.ActorAlign.CENTER });
        volRow.add(volBtn, { y_align: St.Align.MIDDLE });
        volRow.add(this._volSlider.actor, { expand: true, y_align: St.Align.MIDDLE });
        volRow.add(this._volLabel, { y_align: St.Align.MIDDLE });
        slidersCard.add(volRow);

        // Brightness Slider (direct async Gio.DBus, throttled)
        let briRow = new St.BoxLayout({ style_class: "cc-slider-row" });
        let briIcon = new St.Icon({ icon_name: "display-brightness-symbolic", icon_type: St.IconType.SYMBOLIC, icon_size: 16 });
        let briBtn = new St.Button({ child: briIcon, style_class: "cc-slider-icon-btn", reactive: false });
        this._briSlider = new PopupMenu.PopupSliderMenuItem(0.7);
        this._briSlider.actor.style = "padding: 4px 2px; min-width: 195px;";
        this._briSlider.connect("value-changed", (slider, val) => {
            if (this._updatingSliders) return;
            let pct = Math.max(5, Math.round(val * 100));
            this._briLabel.text = pct + "%";
            this._pendingBriPct = pct;
            if (!this._briThrottleId) {
                this._flushBrightness();
                this._briThrottleId = Mainloop.timeout_add(35, () => {
                    this._briThrottleId = 0;
                    if (this._pendingBriPct !== null) {
                        this._flushBrightness();
                    }
                    return false;
                });
            }
        });
        this._briLabel = new St.Label({ text: "70%", style_class: "cc-slider-val", y_align: Clutter.ActorAlign.CENTER });
        briRow.add(briBtn, { y_align: St.Align.MIDDLE });
        briRow.add(this._briSlider.actor, { expand: true, y_align: St.Align.MIDDLE });
        briRow.add(this._briLabel, { y_align: St.Align.MIDDLE });
        slidersCard.add(briRow);

        container.add(slidersCard);

        // --- Now Playing Media Card (MPRIS2, auto-hides when no player is active) ---
        this._mediaCard = new St.BoxLayout({ style_class: "cc-media-card", visible: false });

        let mediaInfo = new St.BoxLayout({ vertical: true, y_align: Clutter.ActorAlign.CENTER });
        this._mediaTitle = new St.Label({ text: "Nothing Playing", style_class: "cc-media-title" });
        this._mediaArtist = new St.Label({ text: "", style_class: "cc-media-artist" });
        mediaInfo.add(this._mediaTitle);
        mediaInfo.add(this._mediaArtist);
        this._mediaCard.add(mediaInfo, { expand: true });

        let mediaCtrls = new St.BoxLayout({ style_class: "cc-media-controls", y_align: Clutter.ActorAlign.CENTER });
        let prevBtn = new St.Button({
            child: new St.Icon({ icon_name: "media-skip-backward-symbolic", icon_type: St.IconType.SYMBOLIC, icon_size: 14 }),
            style_class: "cc-media-btn",
            reactive: true,
            can_focus: true,
        });
        prevBtn.connect("clicked", () => this._mediaCommand("Previous"));

        this._mediaPlayIcon = new St.Icon({ icon_name: "media-playback-start-symbolic", icon_type: St.IconType.SYMBOLIC, icon_size: 16 });
        let playBtn = new St.Button({
            child: this._mediaPlayIcon,
            style_class: "cc-media-play-btn",
            reactive: true,
            can_focus: true,
        });
        playBtn.connect("clicked", () => this._mediaCommand("PlayPause"));

        let nextBtn = new St.Button({
            child: new St.Icon({ icon_name: "media-skip-forward-symbolic", icon_type: St.IconType.SYMBOLIC, icon_size: 14 }),
            style_class: "cc-media-btn",
            reactive: true,
            can_focus: true,
        });
        nextBtn.connect("clicked", () => this._mediaCommand("Next"));

        mediaCtrls.add(prevBtn, { y_align: St.Align.MIDDLE });
        mediaCtrls.add(playBtn, { y_align: St.Align.MIDDLE });
        mediaCtrls.add(nextBtn, { y_align: St.Align.MIDDLE });
        this._mediaCard.add(mediaCtrls);

        container.add(this._mediaCard);

        let item = new PopupMenu.PopupBaseMenuItem({ reactive: false, activate: false });
        item.actor.style = "padding: 0px;";
        item.addActor(container, { expand: true });
        this.menu.addMenuItem(item);
    }

    _flushBrightness() {
        let pct = this._pendingBriPct;
        this._pendingBriPct = null;
        if (pct === null) return;
        Gio.DBus.session.call(
            "org.cinnamon.SettingsDaemon.Power",
            "/org/cinnamon/SettingsDaemon/Power",
            "org.cinnamon.SettingsDaemon.Power.Screen",
            "SetPercentage",
            new GLib.Variant("(u)", [pct]),
            null,
            Gio.DBusCallFlags.NONE,
            -1,
            null,
            null
        );
    }

    _makeRoundBtn(iconName, onClick) {
        let icon = new St.Icon({ icon_name: iconName, icon_type: St.IconType.SYMBOLIC, icon_size: 16 });
        let btn = new St.Button({ child: icon, style_class: "cc-round-btn", reactive: true, can_focus: true });
        btn.connect("clicked", onClick);
        return btn;
    }

    _makeTile(iconName, titleText, subText, onClick) {
        let box = new St.BoxLayout({ style_class: "cc-tile-box", y_align: Clutter.ActorAlign.CENTER });
        let icon = new St.Icon({ icon_name: iconName, icon_type: St.IconType.SYMBOLIC, icon_size: 18, y_align: Clutter.ActorAlign.CENTER });
        let textCol = new St.BoxLayout({ vertical: true, y_align: Clutter.ActorAlign.CENTER });
        let title = new St.Label({ text: titleText, style_class: "cc-tile-title" });
        let sub = new St.Label({ text: subText, style_class: "cc-tile-sub" });
        textCol.add(title);
        textCol.add(sub);
        box.add(icon);
        box.add(textCol, { expand: true });

        let btn = new St.Button({ child: box, style_class: "cc-tile", reactive: true, can_focus: true, x_align: St.Align.START });
        btn.connect("clicked", onClick);
        return { btn, icon, title, sub };
    }

    _setTileActive(tile, active, subText) {
        let has = tile.btn.has_style_class_name("cc-tile-active");
        if (active && !has) {
            tile.btn.add_style_class_name("cc-tile-active");
        } else if (!active && has) {
            tile.btn.remove_style_class_name("cc-tile-active");
        }
        if (subText !== undefined && tile.sub.text !== subText) {
            tile.sub.text = subText;
        }
    }

    _toggleWifi() {
        let next = this._wifiEnabled ? "off" : "on";
        this._wifiEnabled = !this._wifiEnabled;
        this._setTileActive(this._wifiTile, this._wifiEnabled, this._wifiEnabled ? "Connecting..." : "Off");
        runAsync(["nmcli", "radio", "wifi", next], () => {
            Mainloop.timeout_add(500, () => { this._refreshWifiAsync(); return false; });
        });
    }

    _toggleBluetooth() {
        let next = this._btEnabled ? "block" : "unblock";
        this._btEnabled = !this._btEnabled;
        this._setTileActive(this._btTile, this._btEnabled, this._btEnabled ? "On" : "Off");
        runAsync(["rfkill", next, "bluetooth"], () => {
            Mainloop.timeout_add(300, () => { this._refreshBluetoothAsync(); return false; });
        });
    }

    _toggleDnd() {
        let showNotif = this._notifSettings.get_boolean("display-notifications");
        this._notifSettings.set_boolean("display-notifications", !showNotif);
        this._refreshDnd();
    }

    _refreshWifiAsync() {
        runAsync(["nmcli", "radio", "wifi"], (state) => {
            let enabled = (state === "enabled");
            this._wifiEnabled = enabled;
            if (!enabled) {
                if (this._panelWifi.icon_name !== "network-wireless-disabled-symbolic") {
                    this._panelWifi.icon_name = "network-wireless-disabled-symbolic";
                }
                this._setTileActive(this._wifiTile, false, "Off");
                return;
            }
            runAsync(["nmcli", "-t", "-f", "NAME,TYPE", "connection", "show", "--active"], (out) => {
                let ssid = "";
                for (let line of out.split("\n")) {
                    if (line.endsWith(":802-11-wireless")) {
                        ssid = line.slice(0, -16);
                        break;
                    }
                }
                let iconName = ssid
                    ? "network-wireless-signal-excellent-symbolic"
                    : "network-wireless-offline-symbolic";
                if (this._panelWifi.icon_name !== iconName) this._panelWifi.icon_name = iconName;
                this._setTileActive(this._wifiTile, true, ssid || "On");
            });
        });
    }

    _refreshBluetoothAsync() {
        runAsync(["rfkill", "list", "bluetooth"], (out) => {
            let on = out.length > 0 && out.indexOf("Soft blocked: yes") === -1;
            this._btEnabled = on;
            this._setTileActive(this._btTile, on, on ? "On" : "Off");
        });
    }

    _refreshDnd() {
        let dndOn = !this._notifSettings.get_boolean("display-notifications");
        this._setTileActive(this._dndTile, dndOn, dndOn ? "On" : "Off");
    }

    _refreshBrightnessAsync() {
        Gio.DBus.session.call(
            "org.cinnamon.SettingsDaemon.Power",
            "/org/cinnamon/SettingsDaemon/Power",
            "org.cinnamon.SettingsDaemon.Power.Screen",
            "GetPercentage",
            null,
            null,
            Gio.DBusCallFlags.NONE,
            -1,
            null,
            (conn, res) => {
                try {
                    let result = conn.call_finish(res);
                    let [pct] = result.deep_unpack();
                    pct = Math.min(100, Math.max(0, pct));
                    let newText = pct + "%";
                    if (this._briLabel.text !== newText) this._briLabel.text = newText;
                    this._updatingSliders = true;
                    this._briSlider.setValue(pct / 100.0);
                    this._updatingSliders = false;
                } catch (e) {}
            }
        );
    }

    _refreshBattery() {
        let cap = readSysfs("/sys/class/power_supply/BAT0/capacity");
        let status = readSysfs("/sys/class/power_supply/BAT0/status");
        let pct = cap ? parseInt(cap, 10) : 100;
        let charging = (status === "Charging" || status === "Full");

        let lvl = pct >= 85 ? "full" : (pct >= 55 ? "good" : (pct >= 25 ? "low" : "caution"));
        let iconName = charging ? `battery-${lvl}-charging-symbolic` : `battery-${lvl}-symbolic`;
        if (this._panelBat.icon_name !== iconName) this._panelBat.icon_name = iconName;
        if (this._hdrBatIcon.icon_name !== iconName) this._hdrBatIcon.icon_name = iconName;
        let txt = pct + "%" + (status === "Charging" ? " · Charging" : "");
        if (this._hdrBatLabel.text !== txt) this._hdrBatLabel.text = txt;
    }

    _mediaCommand(method) {
        if (!this._mediaBusName) return;
        if (method === "PlayPause") {
            this._mediaPlaying = !this._mediaPlaying;
            this._mediaPlayIcon.icon_name = this._mediaPlaying
                ? "media-playback-pause-symbolic"
                : "media-playback-start-symbolic";
        }
        Gio.DBus.session.call(
            this._mediaBusName,
            "/org/mpris/MediaPlayer2",
            "org.mpris.MediaPlayer2.Player",
            method,
            null,
            null,
            Gio.DBusCallFlags.NONE,
            -1,
            null,
            () => {
                Mainloop.timeout_add(200, () => { this._refreshMediaAsync(); return false; });
            }
        );
    }

    _refreshMediaAsync() {
        Gio.DBus.session.call(
            "org.freedesktop.DBus",
            "/org/freedesktop/DBus",
            "org.freedesktop.DBus",
            "ListNames",
            null,
            null,
            Gio.DBusCallFlags.NONE,
            -1,
            null,
            (conn, res) => {
                try {
                    let [names] = conn.call_finish(res).deep_unpack();
                    let players = names.filter((n) => n.startsWith("org.mpris.MediaPlayer2."));
                    if (players.length === 0) {
                        this._mediaBusName = null;
                        this._mediaCard.visible = false;
                        return;
                    }
                    // Pick first player (prefer Spotify/Chromium/Brave if active)
                    let busName = players[0];
                    this._mediaBusName = busName;
                    Gio.DBus.session.call(
                        busName,
                        "/org/mpris/MediaPlayer2",
                        "org.freedesktop.DBus.Properties",
                        "GetAll",
                        new GLib.Variant("(s)", ["org.mpris.MediaPlayer2.Player"]),
                        null,
                        Gio.DBusCallFlags.NONE,
                        -1,
                        null,
                        (c2, r2) => {
                            try {
                                let [props] = c2.call_finish(r2).deep_unpack();
                                let status = props.PlaybackStatus ? props.PlaybackStatus.deep_unpack() : "Stopped";
                                let meta = props.Metadata ? props.Metadata.deep_unpack() : {};
                                let title = meta["xesam:title"] ? meta["xesam:title"].deep_unpack() : "";
                                let artistArr = meta["xesam:artist"] ? meta["xesam:artist"].deep_unpack() : [];
                                let artist = Array.isArray(artistArr) ? artistArr.join(", ") : String(artistArr || "");
                                if (!title) {
                                    title = busName.replace("org.mpris.MediaPlayer2.", "").split(".")[0];
                                    title = title.charAt(0).toUpperCase() + title.slice(1);
                                }
                                if (title.length > 22) title = title.slice(0, 21) + "…";
                                if (artist.length > 24) artist = artist.slice(0, 23) + "…";

                                this._mediaPlaying = (status === "Playing");
                                this._mediaTitle.text = title;
                                this._mediaArtist.text = artist || (this._mediaPlaying ? "Playing" : "Paused");
                                this._mediaPlayIcon.icon_name = this._mediaPlaying
                                    ? "media-playback-pause-symbolic"
                                    : "media-playback-start-symbolic";
                                this._mediaCard.visible = true;
                            } catch (e) {
                                this._mediaCard.visible = false;
                            }
                        }
                    );
                } catch (e) {
                    this._mediaCard.visible = false;
                }
            }
        );
    }

    on_applet_clicked() {
        this.menu.toggle();
    }

    on_applet_removed_from_panel() {
        if (this._pollId) { Mainloop.source_remove(this._pollId); this._pollId = 0; }
        if (this._openRefreshId) { Mainloop.source_remove(this._openRefreshId); this._openRefreshId = 0; }
        if (this._briThrottleId) { Mainloop.source_remove(this._briThrottleId); this._briThrottleId = 0; }
        if (this._ampSignalId) { this._soundSettings.disconnect(this._ampSignalId); this._ampSignalId = 0; }
        this._unbindSink();
        if (this._mixer && this._mixerSignals) {
            for (let id of this._mixerSignals) this._mixer.disconnect(id);
            this._mixer.close();
            this._mixer = null;
        }
    }
}

function main(metadata, orientation, panel_height, instance_id) {
    return new ControlCenterApplet(orientation, panel_height, instance_id);
}
