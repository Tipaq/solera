# Windows (WSL2)

Solera runs on Windows inside WSL2, the Linux virtual machine built into Windows.
The server, the agents and your projects live in a Linux distribution; you use
Solera from your usual Windows browser at `http://localhost:7517`.

The same installer as on Linux does the work. Under WSL it also enables systemd
when needed, and adds a **Solera** entry to the Start menu.

## Requirements

- Windows 11, or Windows 10 22H2, with WSL from the Microsoft Store (what
  `wsl --install` sets up). `wsl --version` must print a version: if it does not,
  run `wsl --update`. Tested with Windows 11 26H2, WSL 3.0.1, Ubuntu 26.04 and
  24.04.
- Hardware virtualization enabled in the firmware. It almost always is; WSL says so
  when it is not.
- About 1 GB of disk for Solera and its private Node, plus your projects.

Node.js is not required: when the distribution has no Node 22+, the installer
downloads a private copy used by Solera alone.

## Install

**1. WSL and Ubuntu.** In PowerShell, as administrator:

```powershell
wsl --install
```

Restart Windows when asked. Ubuntu then opens and asks for a Linux user name and
password: this is the account Solera and the agents will run under, and the
password is the one `sudo` asks for.

Already have WSL? Check that your distribution runs under WSL 2 with
`wsl --list --verbose` (`VERSION` column). WSL 1 is not supported.

**2. Solera.** In the Ubuntu terminal:

```bash
curl -fsSL https://raw.githubusercontent.com/Tipaq/solera/main/install.sh | bash
```

The installer:

1. checks that systemd runs in the distribution. Recent Ubuntu images enable it;
   on an older one the installer offers to enable it (`sudo` asks for your
   password), then asks you to restart WSL (`wsl --shutdown` in PowerShell) and run
   the same command again;
2. downloads Node.js under `~/.local/share/solera/node` when none is installed;
3. installs Solera under `~/.local/share/solera` as a systemd user service, and
   enables lingering so it starts with the distribution;
4. creates the first account, which gets admin rights;
5. asks whether Solera should start when you sign in to Windows, adds the
   **Solera** Start menu entry, and opens Solera in your browser.

**3. The agents.** Solera drives the `claude`, `codex` and `opencode` CLIs of the Linux
distribution, not the Windows ones. Install and sign in to at least one, in the
Ubuntu terminal or in a Solera terminal.

Claude Code, with its native installer:

```bash
curl -fsSL https://claude.ai/install.sh | bash
claude                                            # sign in, then /exit
```

Codex: let Solera install it, which it offers when Codex is missing, then sign
in once:

```bash
~/.local/share/solera/agents/bin/codex login
```

If no browser opens, open the link it prints in your Windows browser: the sign-in
comes back to WSL through `localhost`.

OpenCode: let Solera install it the same way. Its free models work without an
account; to use a provider of yours, sign in once:

```bash
~/.local/share/solera/agents/bin/opencode auth login
```

## Everyday use

- **Open Solera** from the Start menu, or at `http://localhost:7517`. The Start
  menu entry also starts WSL and Solera when they are stopped.
- **Keep projects in the Linux file system**, for example `~/projects`, not under
  `/mnt/c`. Windows drives are reached through a network file system: git and the
  agents are several times slower there, and file watching does not work. From
  Windows, the Linux files are in File Explorer under **Linux**, or at
  `\\wsl.localhost\Ubuntu\home\<you>`.
- **Update** from Settings > About, or by running the install command again.
- **Logs**: `journalctl --user -u solera -f` in the Ubuntu terminal.
- **Stop** Solera with `systemctl --user stop solera`, or all of WSL with
  `wsl --shutdown` in PowerShell.

## How it stays running

WSL stops a distribution about 15 seconds after the last program started from
Windows exits, and running systemd services do not count. Closing the Ubuntu
terminal would take Solera down.

So both shortcuts run a small keeper, `~/.local/share/solera/wsl/keepalive`,
through `wslg.exe`, which starts it without opening a window. As long as the
keeper runs, the distribution stays up and so does Solera. Only one keeper runs
at a time.

| Shortcut | Location | Does |
|---|---|---|
| Solera | Start menu | starts the keeper, waits for Solera, opens the browser |
| Solera | Startup folder (`shell:startup`) | starts the keeper when you sign in to Windows |

The second one exists only if you answered yes during the installation. To change
your mind later, toggle **Solera** in Task Manager > Startup apps, or run the
installer again with the answer given in advance:

```bash
curl -fsSL https://raw.githubusercontent.com/Tipaq/solera/main/install.sh | SOLERA_WSL_AUTOSTART=no bash
```

The shortcuts start the distribution the installer last ran in. All WSL 2
distributions share one network, so only one of them can run Solera on port 7517
at a time.

By default the WSL virtual machine may use up to half of the RAM. Cap it with
`memory=` in the `[wsl2]` section of `%UserProfile%\.wslconfig` if needed.

## Troubleshooting

**`http://localhost:7517` does not answer from Windows.** In the Ubuntu terminal,
`curl -s http://127.0.0.1:7517/api/health` tells which side fails. If Solera
answers inside WSL, Windows reaches it through WSL's localhost forwarding: check
that `%UserProfile%\.wslconfig` does not set `localhostForwarding=false`, and that
no Windows program already listens on port 7517. `wsl --shutdown` then reopening
Ubuntu resets the forwarding.

**Solera stops a few seconds after closing the terminal.** The keeper is not
running: open Solera from the Start menu once. If it keeps happening, check that
`wsl --version` reports a recent WSL and run the installer again.

**`systemd user session unreachable`.** The installer runs as your regular user,
not `root`. If the distribution starts as `root` by default, set your user with
`[user] default=<you>` in `/etc/wsl.conf` and restart WSL.

**The agents cannot reach the network on a VPN.** This is a WSL networking issue,
not a Solera one: `networkingMode=mirrored` in the `[wsl2]` section of
`.wslconfig` usually solves it.

## Uninstall

In the Ubuntu terminal:

```bash
systemctl --user disable --now solera
rm -rf ~/.local/share/solera ~/.config/systemd/user/solera.service ~/.config/solera
```

Then delete the two shortcuts and the icon from Windows, in PowerShell:

```powershell
Remove-Item "$([Environment]::GetFolderPath('Programs'))\Solera.lnk", "$([Environment]::GetFolderPath('Startup'))\Solera.lnk", "$env:LOCALAPPDATA\Solera" -Recurse -ErrorAction SilentlyContinue
```

`wsl --shutdown` stops the keeper if it still runs. Your projects and the agents'
credentials (`~/.claude`, `~/.codex`, `~/.local/share/opencode`) are left in place.

## Accès depuis un autre appareil

Pour retrouver Solera sur un téléphone, Windows et WSL doivent rester actifs.
Le [guide d’accès distant](remote-access.md) décrit Tailscale côté Windows, HTTPS
et les consignes à donner aux agents pour partager des prévisualisations accessibles
par le VPN. Installer Solera ne configure pas cet accès automatiquement.
