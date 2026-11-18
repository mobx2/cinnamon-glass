const Applet = imports.ui.applet;
const St = imports.gi.St;
const Cinnamon = imports.gi.Cinnamon;
const Clutter = imports.gi.Clutter;
const Main = imports.ui.main;
const Util = imports.misc.util;

class MacOSMenuBarApplet extends Applet.Applet {
    constructor(orientation, panel_height, instance_id) {
        super(orientation, panel_height, instance_id);

        this.setAllowedLayout(Applet.AllowedLayout.HORIZONTAL);
        this.actor.style = "spacing: 2px; padding: 0px 4px;";

        // Bold focused app name (like "Finder" / "VS Code" / "Brave" on macOS)
        this._appLabel = new St.Label({
            text: "Desktop",
            y_align: Clutter.ActorAlign.CENTER,
            style: "font-weight: bold; font-size: 0.94em; color: #f2f2f2; padding: 0px 8px;",
        });
        this.actor.add(this._appLabel);

        // Quick macOS-style menu bar items
        this._addItem("Files", () => Util.spawnCommandLine("nemo"));
        this._addItem("Terminal", () => Util.spawnCommandLine("gnome-terminal"));
        this._addItem("Settings", () => Util.spawnCommandLine("cinnamon-settings"));
        this._addItem("Overview", () => Main.overview.toggle());

        this._tracker = Cinnamon.WindowTracker.get_default();
        this._focusId = global.display.connect("notify::focus-window", () => this._updateAppName());
        this._updateAppName();
    }

    _addItem(labelText, onClick) {
        let lbl = new St.Label({
            text: labelText,
            y_align: Clutter.ActorAlign.CENTER,
            style: "font-size: 0.92em; font-weight: 500; color: rgba(240, 240, 245, 0.88);",
        });
        let btn = new St.Button({
            child: lbl,
            reactive: true,
            can_focus: true,
            style_class: "macos-menu-item",
        });
        btn.connect("clicked", onClick);
        this.actor.add(btn);
    }

    _updateAppName() {
        let win = global.display.focus_window;
        if (!win || win.get_window_type() === imports.gi.Meta.WindowType.DESKTOP) {
            this._appLabel.text = "Desktop";
            return;
        }
        let app = this._tracker.get_window_app(win);
        let name = app ? app.get_name() : (win.get_wm_class() || "Desktop");
        if (name.toLowerCase().indexOf("nemo-desktop") !== -1) {
            name = "Desktop";
        }
        if (name.length > 22) {
            name = name.slice(0, 21) + "…";
        }
        this._appLabel.text = name;
    }

    on_applet_removed_from_panel() {
        if (this._focusId) {
            global.display.disconnect(this._focusId);
            this._focusId = 0;
        }
    }
}

function main(metadata, orientation, panel_height, instance_id) {
    return new MacOSMenuBarApplet(orientation, panel_height, instance_id);
}
