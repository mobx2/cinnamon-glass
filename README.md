<div align="center">

# cinnamon-glass

**A dark glassmorphism desktop rice for Linux Mint Cinnamon (X11)**  
Adaptive top bar · Floating glass dock · Custom GJS extensions · Live Conky/Cava HUD · Rofi Spotlight

<p>
  <img src="https://img.shields.io/badge/OS-Linux%20Mint%2022.3-87CF3E?style=for-the-badge&logo=linuxmint&logoColor=white&labelColor=14161b" alt="Linux Mint 22.3" />
  <img src="https://img.shields.io/badge/DE-Cinnamon%20(X11)-DC682E?style=for-the-badge&logo=cinnamon&logoColor=white&labelColor=14161b" alt="Cinnamon X11" />
  <img src="https://img.shields.io/badge/Theme-Mint--Y--Dark--Grey--Clean-1e2028?style=for-the-badge&labelColor=14161b" alt="Theme" />
  <img src="https://img.shields.io/badge/Icons-kora-89B4FA?style=for-the-badge&labelColor=14161b" alt="Kora Icons" />
  <img src="https://img.shields.io/badge/License-MIT-CBA6F7?style=for-the-badge&labelColor=14161b" alt="MIT License" />
</p>

<br />

<img src="./screenshot.png" alt="cinnamon-glass desktop preview" width="100%" />

<details>
  <summary>Wallpaper preview (<code>wallpaper.jpg</code>)</summary>
  <br />
  <img src="./wallpaper.jpg" alt="cinnamon-glass wallpaper" width="100%" />
</details>

</div>

> [!WARNING]
> **AI-Assisted Configuration — Install with Care**
>
> All scripts, custom Cinnamon extensions, applets, themes, and Conky/Rofi configurations in this repository were built and tuned **with AI assistance** for a **Linux Mint 22.3 Cinnamon (X11)** setup.
>
> - **Be cautious before running automated scripts:** review `install.sh` and `extras/setup_login_screen.sh` first so you do not accidentally break your panels, GTK settings, display manager, or workflow.
> - **Ask an AI assistant for help during setup:** if you are on a different distro, Cinnamon version, monitor layout, or audio/network setup, paste the relevant files or errors into an AI coding assistant to adapt them safely before applying (and keep the automatic `~/.dotfiles-backup/` snapshot in case you need `./uninstall.sh`).

---

## Features

- **Adaptive Glass Top Bar (`adaptive-topbar@local`)** — Blends smoothly with the wallpaper on an empty desktop, transitions cleanly to `#222226` when a window maximizes, fades smoothly in Overview/Expo, and keeps Desktop Peek instant without Chromium/Electron resize flicker.
- **GLSL Rounded Corners (`rounded-corners@local`)** — Uniform soft corners for non-maximized windows on the primary monitor plus an opacity mask during unminimize so Electron/GTK frame extents stay glitch-free.
- **macOS-Inspired Menubar & Control Center** — Custom Cinnamon applets (`macos-menubar@local`, `control-center@local`) paired with fluid hover-switching panel menus (`panel-fluid-menus@local`).
- **Floating Glass Dock & GTK Styling** — Customized `Mint-Y-Dark-Grey-Clean` theme, clean Nemo sidebar spacing (`themes/gtk-3.0/gtk.css`), `kora` icons, `Bibata-Modern-Classic` cursors, and custom notification sound.
- **Rofi Spotlight (`Alt + Space`)** — Compact dark glass launcher (`-normal-window`) so native `Super + Space` keyboard layout switching works inside the search bar, plus auto-close on focus loss.
- **4-Widget Conky HUD (`systemd --user` managed)**:
  - **Top-Left (`ascii-fetch`):** Catppuccin Mocha ASCII Fetch card auto-detecting OS, user, kernel, shell, terminal, CPU, GPU, RAM, and packages.
  - **Bottom-Left (`matrix-rain`):** Live Katakana Matrix Rain in Lua Cairo.
  - **Bottom-Center (`cava-bar`):** 48-bar Cava audio visualizer + PangoCairo MPRIS2 *Now Playing* HUD (supports English & Arabic RTL text shaping; stays hidden when silent).
  - **Right (`panel`):** Live system, per-core CPU, memory, top processes, and network monitor (auto-adapted to your network interface, sensors, and thread count during install).

---

## Requirements

- **OS / Session:** Linux Mint 21/22+ with **Cinnamon on X11** (custom GJS shaders, `wmctrl`, `xprop`, and Rofi focus tracking require X11).
- **Packages** (installed automatically by `./install.sh` unless `--no-deps` is passed):
  - Core: `git`, `curl`, `unzip`, `x11-utils`, `wmctrl`, `bibata-cursor-theme`, `fonts-noto-kufi-arabic`, `fonts-ubuntu`
  - Launcher: `rofi`
  - Conky / Visualizer: `conky-all`, `cava`, `lm-sensors`, `fonts-noto-cjk`, `python3-gi`, `python3-gi-cairo`, `gir1.2-pango-1.0`

---

## Installation

### Quick Setup (Interactive)

```bash
git clone https://github.com/mobx2/cinnamon-glass.git
cd cinnamon-glass
./install.sh
```

> **Safe by design:** Before applying changes, `install.sh` saves a full timestamped snapshot (`dconf dump /org/cinnamon/`, `gtk.css`, `rofi`, `conky`, `spices`) inside `~/.dotfiles-backup/`. Your existing `pinned-apps` on the dock are also preserved automatically.

### Modular CLI Flags

Install everything at once or pick only the pieces you want:

```bash
# Full setup (Desktop + Rofi + Conky HUD)
./install.sh --all

# Individual modules
./install.sh --desktop       # Theme, GTK CSS, fonts, icons, extensions, applets & panels
./install.sh --rofi          # Rofi Spotlight theme + Alt+Space binding
./install.sh --conky         # All 4 Conky widgets + Cava/MPRIS bridge + autostart

# Optional: LightDM Slick Greeter + centered Lock Screen clock (requires sudo)
./install.sh --login

# Skip apt calls if dependencies are already installed
./install.sh --all --no-deps -y
```

### Optional: Dual-Monitor LightDM Alignment

If you use two monitors and want LightDM to keep a specific primary/left and secondary/right order before login:

```bash
sudo bash extras/setup_login_screen.sh --dual-monitor HDMI-1 eDP-1
```

---

## How to Run & Manage

### 1. Desktop & Extensions
After `--desktop`, log out and back in once (or press `Alt + F2`, type `r`, and press `Enter`) so Cinnamon loads all newly installed extensions and GTK styles cleanly.

To reload individual extensions manually:

```bash
dbus-send --session --dest=org.Cinnamon --type=method_call /org/Cinnamon org.Cinnamon.ReloadXlet string:'adaptive-topbar@local' string:'EXTENSION'
```

### 2. Rofi Spotlight Launcher
- Press **`Alt + Space`** to open or close Spotlight.
- Type directly to search apps (`Apps`), run commands (`Run`), switch windows (`Windows`), or browse files (`Files`).
- Press **`Super + Space`** at any time inside Rofi to switch keyboard layouts, or click outside the launcher to dismiss it.
- To test manually from terminal:

```bash
~/.config/rofi/launch.sh
```

### 3. Conky, Matrix Rain & Cava Visualizer
The installer sets up autostart (`~/.config/autostart/conky.desktop`) pointing to `~/.conky/conky-startup.sh`, which starts the right-side monitor panel plus three user systemd units cleanly after login:

```bash
# Start or restart all widgets + right panel
~/.conky/conky-startup.sh

# Check status of the 3 widget services
systemctl --user status dotfiles-conky-ascii.service dotfiles-conky-matrix.service dotfiles-conky-cava.service

# Stop or restart a single widget (e.g. Cava / Now Playing)
systemctl --user restart dotfiles-conky-cava.service
systemctl --user stop dotfiles-conky-matrix.service
```

> **Audio note:** Cava reads from PulseAudio/PipeWire (`method = pulse`, `source = auto` in `~/.conky/cava-bar/cava.conf`). Make sure audio is playing (Spotify or any MPRIS2 player) to see the bars and track title appear above the dock.

---

## Shortcuts

| Shortcut | Action |
| :--- | :--- |
| `Alt + Space` | Toggle Rofi Spotlight launcher |
| `Super + Space` | Switch keyboard layout (including inside Rofi) |
| `Super + D` / Bottom-Right Hot Corner | Smooth Desktop Peek / Restore |

---

## Repository Layout

```text
cinnamon-glass/
├── install.sh           # Modular installer with auto-detection & backup
├── uninstall.sh         # Clean rollback to last ~/.dotfiles-backup/
├── assets/              # Barlow, JetBrains Mono, Hack, Conky fonts + notification sound
├── themes/              # Mint-Y-Dark-Grey-Clean Cinnamon theme + gtk-3.0/gtk.css
├── cinnamon/            # Extensions, applets & spice configs
├── rofi/                # Spotlight .rasi theme + focus-aware wrapper
├── conky/               # ASCII Fetch, Matrix Rain, Cava/MPRIS HUD, Panel & systemd units
└── extras/              # Optional LightDM / Lock Screen setup
```

---

## Uninstall / Rollback

To remove `cinnamon-glass` widgets, strip the tagged `gtk.css` block, and restore your previous desktop backup:

```bash
./uninstall.sh
```

---

## License

This project is licensed under the **MIT License** — see [`LICENSE`](./LICENSE) for details.

---

<div align="center">
  <sub>Crafted by <a href="https://github.com/mobx2">@mobx2</a></sub>
</div>
