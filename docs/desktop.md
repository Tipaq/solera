# Solera Desktop

Solera Desktop is the edition for your workstation: an app for macOS (Apple Silicon),
Windows (x64) and Linux (x64 and arm64). It bundles the server of the release and its own Node,
starts them when you open it, and shows the interface in its own window. There is no
server to set up, no account to create and no password.

It is the simplest way to try Solera, or to use it on the machine where you code.
To follow your agents from a phone or another computer and leave them working,
install the server instead ([compare the two](../README.md#server-or-desktop)).

## Download

Every release ships the app next to the server archives. Each link downloads the
package of the [latest release](https://github.com/Tipaq/solera/releases/latest)
directly:

| System | Package |
|---|---|
| macOS, Apple Silicon | [Solera-mac-arm64.dmg](https://github.com/Tipaq/solera/releases/latest/download/Solera-mac-arm64.dmg) (or the [`.zip`](https://github.com/Tipaq/solera/releases/latest/download/Solera-mac-arm64.zip)) |
| Windows | [Solera-win-x64.exe](https://github.com/Tipaq/solera/releases/latest/download/Solera-win-x64.exe) |
| Debian, Ubuntu | [x64 `.deb`](https://github.com/Tipaq/solera/releases/latest/download/Solera-linux-amd64.deb) or [arm64 `.deb`](https://github.com/Tipaq/solera/releases/latest/download/Solera-linux-arm64.deb) |
| Other Linux | [x64 AppImage](https://github.com/Tipaq/solera/releases/latest/download/Solera-linux-x86_64.AppImage) or [arm64 AppImage](https://github.com/Tipaq/solera/releases/latest/download/Solera-linux-arm64.AppImage) |

### macOS

Open the `.dmg` and drag Solera into Applications, and keep it there: that is where
it can update itself. The app is not notarized by Apple yet, so the first launch is
refused: open **System Settings > Privacy &
Security** and click **Open Anyway**. From Terminal, this does the same:

```bash
xattr -dr com.apple.quarantine /Applications/Solera.app
```

Solera needs git: run `xcode-select --install` first if the Command Line Tools are
missing.

### Windows

Run the `.exe`: it installs Solera for your user, without administrator rights. The
app is not signed yet, so SmartScreen warns on the first run: click **More info**, then
**Run anyway**.

Solera needs [Git for Windows](https://git-scm.com/download/win): for git itself, and
for its bash, which runs the check scripts of scheduled tasks, written in `sh` syntax.
Claude Code needs it on Windows too. Terminals open in PowerShell (PowerShell 7 when
it is installed).

To keep Solera running when your computer is off, or to reach it from your phone, use
the server edition under WSL2 instead ([Windows](windows.md)).

### Linux

On Debian and Ubuntu, prefer the `.deb`:

```bash
sudo apt install ./Solera-linux-amd64.deb
```

It pulls in git, and installs an AppArmor profile that Ubuntu 24.04 and later
require before Chromium, which draws the window, may start its sandbox. The AppImage
suits other distributions; on Ubuntu 24.04 and later it does not start without such a
profile.

## Agents

Install Claude Code, Codex, OpenCode or Grok Build the usual way, or from the app,
which brings its own npm. At launch, the app reads the environment of your login
shell (on Windows, your user environment): CLIs installed with Homebrew, npm, nvm or
their own installers are found as they are in your terminal.

The agents use your own sign-ins and settings (`~/.claude`, `~/.codex`, …). A session
started in Solera can be resumed in the terminal and the other way round; do not
drive the same session from both at once.

## What differs from the server

- **No sign-in.** The app opens your session when it starts. Its server listens on
  `127.0.0.1` and serves only the app's window: no other page on the machine, opened
  in your browser or served by another program, can use your session.
- **Your data stays with the app**, in `~/Library/Application Support/Solera` on
  macOS, `%LOCALAPPDATA%\Solera` on Windows and `~/.config/Solera` on Linux:
  projects, conversations and settings in `data/`, the server log in
  `logs/server.log`. A server install on the same machine
  keeps its own data, port and session cookie: both can run side by side.
- **One account.** Projects have no private or shared setting: nobody else can see
  them.
- **Agents run while the app runs.** On macOS, closing the window leaves the app and
  its sessions running; quit with ⌘Q. On Windows and Linux, closing the last window
  quits.
  Nothing runs while the computer sleeps.
- **Updates** are automatic: see [below](#updates).
- **Not available:** access from other devices and push notifications. Settings hide
  the password, logout, push notifications and user accounts.

## Updates

The app updates itself from the GitHub releases. It checks when it starts, then every
four hours, downloads a new version in the background and installs it when you quit
Solera; Settings > About shows the download, then the version that is ready. To
install it right away, click **Restart and update** there: Solera closes, installs the
new version and reopens. Running conversations are interrupted and resume with the next
message. Your data stays where it is.

- **Windows:** the installer runs silently, for your user, as on the first install.
- **macOS:** Solera replaces its own app in the Applications folder. Run from the disk
  image, or from a folder where macOS isolates it, it cannot, and About says so. Should
  macOS refuse the replacement, About tells you to allow Solera under System Settings >
  Privacy & Security > App Management.
- **Linux:** the AppImage is replaced in place. The `.deb` is installed only when you
  click **Restart and update**, since it asks for your administrator password.

The updater keeps its log in `logs/updater.log`, next to the server's. It reads the
releases of `Tipaq/solera` anonymously: while that repository is private, every check
fails, quietly, and only this log says so.

## Window

The window has no native title or menu bar: a single bar at the top, in the colours of
the current theme, holds the window controls of the system (on the left on macOS, on
the right elsewhere). Drag it to move the window. On Windows and Linux, its menu button opens
the application menu.

## Uninstall

- **macOS:** quit Solera, then delete `/Applications/Solera.app` and
  `~/Library/Application Support/Solera`.
- **Windows:** uninstall Solera from Settings > Apps, then delete
  `%LOCALAPPDATA%\Solera`.
- **Linux:** `sudo apt remove solera`, or delete the AppImage, then delete
  `~/.config/Solera`.

## Building it

The [`Desktop` workflow](../.github/workflows/desktop.yml) is the reference recipe:
it assembles the release runtime (`.github/actions/runtime-archive`), adds the Node
that built it (`scripts/desktop-stage.mjs`), then packages with electron-builder in
`apps/desktop`. `pnpm test:desktop-ui` launches the packaged app and checks it: the
server answers, the window opens without sign-in, other origins are refused, a
terminal runs, and quitting stops the server. On Linux it needs a display:
`xvfb-run`, or WSLg's (`DISPLAY=:0`) under WSL.

`pnpm test:desktop-update --app <installed app> --feed <folder>` checks the update end
to end: an installed version finds a newer one in a folder served over HTTP
(`SOLERA_DESKTOP_UPDATE_FEED`), downloads it, then replaces and relaunches itself. The
workflow runs it with `update-check`, on two versions it packages for the purpose
(0.0.1 and 0.0.2); the CI does so on Linux and Windows.
