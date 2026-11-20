const Clutter = imports.gi.Clutter;
const Main = imports.ui.main;
const Mainloop = imports.mainloop;
const PopupMenu = imports.ui.popupMenu;

let _origOnEventCapture = null;
let _origUngrab = null;

function _isInAnyPanel(actor) {
    if (!actor || actor.is_finalized() || !Main.panelManager || !Main.panelManager.panels) {
        return false;
    }
    for (let panel of Main.panelManager.panels) {
        if (panel && panel.actor && !panel.actor.is_finalized() && panel.actor.contains(actor)) {
            return true;
        }
    }
    return false;
}

function init() {}

function enable() {
    if (_origOnEventCapture) return;

    _origOnEventCapture = PopupMenu.PopupMenuManager.prototype._onEventCapture;
    _origUngrab = PopupMenu.PopupMenuManager.prototype._ungrab;

    // Always re-sync pointer hover state after releasing a menu modal grab
    // so you NEVER have to move the mouse out of the panel and back in!
    PopupMenu.PopupMenuManager.prototype._ungrab = function () {
        _origUngrab.call(this);
        Mainloop.idle_add(() => {
            try {
                global.sync_pointer();
            } catch (e) {}
            return false;
        });
    };

    PopupMenu.PopupMenuManager.prototype._onEventCapture = function (actor, event) {
        if (!this.grabbed) {
            return false;
        }

        let src = event.get_source();
        if (src && !this._eventIsOnActiveMenu(event) && _isInAnyPanel(src)) {
            let type = event.type();
            if (
                type === Clutter.EventType.ENTER ||
                type === Clutter.EventType.LEAVE ||
                type === Clutter.EventType.MOTION
            ) {
                return Clutter.EVENT_PROPAGATE;
            }
            if (type === Clutter.EventType.BUTTON_PRESS) {
                if (this._activeMenu) {
                    this._activeMenu.close(false);
                }
                return Clutter.EVENT_PROPAGATE;
            }
            if (type === Clutter.EventType.BUTTON_RELEASE) {
                return Clutter.EVENT_PROPAGATE;
            }
        }

        return _origOnEventCapture.call(this, actor, event);
    };
}

function disable() {
    if (_origOnEventCapture) {
        PopupMenu.PopupMenuManager.prototype._onEventCapture = _origOnEventCapture;
        _origOnEventCapture = null;
    }
    if (_origUngrab) {
        PopupMenu.PopupMenuManager.prototype._ungrab = _origUngrab;
        _origUngrab = null;
    }
}
