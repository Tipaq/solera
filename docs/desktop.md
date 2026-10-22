# Solera Desktop

Solera Desktop is the edition for your workstation: an app for macOS (Apple Silicon)
and Linux (x64 and arm64). It bundles the server of the release and its own Node,
starts them when you open it, and shows the interface in its own window. There is no
server to set up, no account to create and no password.

It is the simplest way to try Solera, or to use it on the machine where you code.
To follow your agents from a phone or another computer and leave them working,
install the server instead ([compare the two](../README.md#server-or-desktop)).

On Windows, use the server edition under WSL2 for now ([Windows](windows.md)).

## Download

Every release ships the app next to the server archives. Each link downloads the
package of the [latest release](https://github.com/Tipaq/solera/releases/latest)
directly:

| System | Package |
|---|---|
| macOS, Apple Silicon | [Solera-mac-arm64.dmg](https://github.com/Tipaq/solera/releases/latest/download/Solera-mac-arm64.dmg) (or the [`.zip`](https://github.com/Tipaq/solera/releases/latest/download/Solera-mac-arm64.zip)) |
| Debian, Ubuntu | [x64 `.deb`](https://github.com/Tipaq/solera/releases/latest/download/Solera-linux-amd64.deb) or [arm64 `.deb`](https://github.com/Tipaq/solera/releases/latest/download/Solera-linux-arm64.deb) |
| Other Linux | [x64 AppImage](https://github.com/Tipaq/solera/releases/latest/download/Solera-linux-x86_64.AppImage) or [arm64 AppImage](https://github.com/Tipaq/solera/releases/latest/download/Solera-linux-arm64.AppImage) |

### macOS

Open the `.dmg` and drag Solera into Applications. The app is not notarized by
Apple yet, so the first launch is refused: open **System Settings > Privacy &
Security** and click **Open Anyway**. From Terminal, this does the same:

```bash
xattr -dr com.apple.quarantine /Applications/Solera.app
```

Solera needs git: run `xcode-select --install` first if the Command Line Tools are
missing.

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

Install Claude Code, Codex or OpenCode the usual way, or from the app, which brings
its own npm. At launch, the app reads the environment of your login shell: CLIs
installed with Homebrew, npm, nvm or their own installers are found as they are in
your terminal.

The agents use your own sign-ins and settings (`~/.claude`, `~/.codex`, …). A session
started in Solera can be resumed in the terminal and the other way round; do not
drive the same session from both at once.

## What differs from the server

- **No sign-in.** The app opens your session when it starts. Its server listens on
  `127.0.0.1` and serves only the app's window: no other page on the machine, opened
  in your browser or served by another program, can use your session.
- **Your data stays with the app**, in `~/Library/Application Support/Solera` on
  macOS and `~/.config/Solera` on Linux: projects, conversations and settings in
  `data/`, the server log in `logs/server.log`. A server install on the same machine
  keeps its own data, port and session cookie: both can run side by side.
- **One account.** Projects have no private or shared setting: nobody else can see
  them.
- **Agents run while the app runs.** On macOS, closing the window leaves the app and
  its sessions running; quit with ⌘Q. On Linux, closing the last window quits.
  Nothing runs while the computer sleeps.
- **Updates.** The app tells you when a release is out (Settings > About). Download
  the new version and replace the app; there is no automatic update yet.
- **Not available:** access from other devices and push notifications. Settings hide
  the password, logout, push notifications and user accounts.

## Uninstall

- **macOS:** quit Solera, then delete `/Applications/Solera.app` and
  `~/Library/Application Support/Solera`.
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
