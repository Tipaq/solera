# Services

The **Services** entry opens `/services`: what is running because of this Solera
server, refreshed every five seconds: the execution environments, then three lists.

1. **Permanent apps**: systemd user units named `solera-app-*`, which agents create
   for what must stay online (see below).
2. **Agents and terminals**: every agent CLI and terminal shell the server has
   spawned, each with the commands it started. A command is one entry with its whole
   process tree folded in: process count and names, the union of their listening
   ports, the sum of their resident memory. `npm run dev` and its ten workers make
   one line. Under an agent, MCP servers are *tools*: counted in the group header,
   never listed as commands, never stoppable here.
3. **Detached processes**: entries whose launcher has exited but which the Solera
   service still holds (cgroup rule below).

Each entry shows its shortened command line, PID, elapsed time, memory, ports, and
the project and conversation it belongs to when known. A command whose attribution
differs from its launcher's (a terminal command carrying an agent's marker, say)
repeats it on its own line.

## Environments

Above the three lists, **Environments** shows the execution environments of sessions
(ADR 0001): each project's dev container, and the sandbox of every confined session
or terminal (one each). The confined container (#145) will join as a third kind;
the DTO (`ServiceEnvironmentDto`) already carries a `kind` and an `engine`.

For each: type, project, the sessions and terminals running in it, state (starting,
running, stopped, failed with its cause), CPU, memory, disk and listening ports.
Sessions and terminals are folded under their environment instead of *Agents and
terminals*: their launcher on the host is only the `docker exec` or bwrap client.
Usage is displayed, never capped.

Where the numbers come from (`services/environments.ts`):

- **Dev container**: Docker owns its processes, so `/proc` cannot see them. A project's
  container is the one whose `devcontainer.local_folder` label is its workspace (the
  one Solera started first, else a running one); its docker-compose companions count
  in its usage. `docker stats --no-stream` gives CPU and memory, `docker ps -s` the
  written layer and the image (re-read once a minute, it walks the layer), the
  container's own `/proc/net/tcp*` its listening ports, and `docker top` whether a
  VS Code server is attached. The ports Solera serves on the host for the web
  preview (#141) show next to them, as `5173 → localhost:5174` when the host port
  differs, in red with the cause when the port could not be served. The state merges Docker's with what Solera knows:
  a `devcontainer up` in progress is *starting*, a failed one is *failed* with its
  message even when no container exists. A container that exited on `docker stop`
  (137, 143) is *stopped*, not failed.
- **Sandbox**: its processes are children of Solera, so its usage is the sum of the
  process entries rooted at the pids `ConfinedEnvironment` launched. Disk is the
  size of its private home and tmp.

Actions (`POST /api/services/environments/:id/stop|restart|rebuild`): a dev
container can be stopped, restarted (`docker stop`/`restart`, compose companions
included) and rebuilt (`devcontainer up --remove-existing-container`, in the
background; the row shows *starting*). Its log (`GET …/log`) is the last
`devcontainer up` Solera ran, then the tail of `docker logs`. Before any of these,
the sessions running in it are terminated and its terminals' shells killed (their
tabs stay): a session restarts on its next message, and Solera re-runs `up` for it.
Stopping a sandbox stops its session or terminal. The page asks for confirmation
when someone uses the environment (Solera sessions and terminals, VS Code if
attached), and always before a rebuild.

From a session, the environment pill in the header links to
`/services?environment=<id>&session=<id>`, which scrolls to and highlights the row.

## Command lines

A list of `node` and `zsh` says nothing, so the command line is shown, reduced on
the server (`services/command-line.ts`): the executable's directory is dropped, the
home directory becomes `~`, Claude Code's shell wrapping (`zsh -c "source snapshot
&& … && eval '<command>' && pwd …"`) is unwrapped to the command the agent asked
for, whitespace is collapsed, the result is capped at 160 characters, and values
that look like secrets are masked: URL passwords, `Authorization` headers, `Bearer`
tokens, and `token=`, `secret=`, `password=`, `api_key=`, `credential=` style
arguments. Raw arguments and environment values never leave the server. The same
reduction applies to a permanent app's `ExecStart`; the description `systemd-run`
derives from the command line is dropped because it is not masked.

## What belongs in this view

On Linux, the server reads `/proc` for processes owned by its Unix user. A process
must descend from the current Solera process. The entire tmux or screen branch
is excluded, even if it inherited Solera's environment. Other systemd units are
also excluded, apart from the permanent apps below. A matching project directory
never qualifies a process.

There is one additional case: a shell may exit after starting a background job,
leaving an orphan. When Solera is the main process of a dedicated systemd service
with `KillMode=control-group` or `mixed`, a process remaining in that same cgroup
still depends on the service and is included. A shared SSH/session/test cgroup is
not sufficient. Without this evidence, detached processes are omitted.

Linked processes are then folded (`foldProcesses` in `services/processes.ts`): a
direct child of the server is a *launcher* (agent or terminal); a launcher's child
is a *command*, or a *tool* when the launcher is an agent and the child is not a
`shell -c` and mentions MCP; a linked process whose parent is not linked is
*detached*; everything else folds into the entry it descends from.

Closing the browser does not stop any of these processes. The UI only promises
shutdown with Solera when the verified systemd configuration guarantees it.
Parenthood alone does not guarantee that a Unix child dies with its parent.

## Attribution and stopping

The inherited `SOLERA_PROCESS_ORIGIN` marker, resolved through the registry in
`<data>/process-origins/`, supplies project/conversation attribution *after* the
execution link has been verified. If a command clears its environment, its live
ancestors can supply that attribution. A stale marker on an independent service
never includes it in this view. Unknown-project entries are admin-only;
private-project visibility is enforced for everyone, including administrators.

`POST /api/services/:id/stop` rescans, checks project visibility, then revalidates
boot ID, PID, start time, origin and current execution link of the entry's root
immediately before signalling. SIGTERM then goes to every process of the tree seen
at scan time, each re-checked by PID and start time: a non-interactive shell does
not relay the signal to its children, which would otherwise linger as detached
processes. No process-group signal or forced kill is sent. Launchers, tools, the
daemon itself and independent processes cannot be stopped here. A process ignoring
SIGTERM stays visible; a watcher may restart its child.

## Permanent apps

A command an agent starts in the background is temporary: Claude Code stops it once
its timeout expires (30 minutes by default, 2 hours at most), and it dies with the
session anyway. What must stay online goes into a systemd user unit whose name
starts with `solera-app-`, as the global SOLERA.md tells agents to do:

```bash
systemd-run --user --unit=solera-app-weather --working-directory="$PWD" \
  --setenv=PATH --setenv=SOLERA_PROCESS_ORIGIN -p Restart=on-failure npm run dev
```

Such a unit leaves the Solera service on purpose, to outlive it, so the process
view above cannot see it. The page lists these units separately, through
`systemctl --user`: state (running, starting, failed with its cause, stopped), the
shortened command line, the listening ports of every process in the unit's cgroup,
working directory, memory, start time, and whether the unit is enabled (it comes
back after a reboot even if stopped here).

Attribution follows the rule above. `--setenv=SOLERA_PROCESS_ORIGIN` hands the
agent's marker to the unit (`Environment=` in a unit file does the same), and that
marker alone ties the app to a project and conversation, readable even when the
unit is stopped. Project members can stop, restart or start an attributed app, and
dismiss a failed one (`reset-failed`). Without a marker, the app is admin-only, as
an unknown-origin process is, but the admin may still manage it: the
`solera-app-` prefix itself declares that Solera may stop it.

`POST /api/services/apps/:id/:action` (`stop`, `restart`, `reset`) rescans,
checks visibility and the action against the unit's state, then calls `systemctl
--user` without a shell, on a name that must match `solera-app-*.service`. The
id includes systemd's invocation id: an app restarted since the list was loaded
is a different target, and the request is refused. Stop and restart do not wait
for the job to finish (`--no-block`); the next refresh shows the outcome.

Ports are information only: detection does not expose or proxy them. Other hosts,
other containers and processes inaccessible to Solera are outside this view.

Validation: `pnpm test`, `pnpm typecheck`, `pnpm build` and
`node scripts/services-ui-check.mjs`. The UI check launches real processes through
a Solera terminal, verifies that they are listed under that terminal with their
command lines, and that an independent process with the same directory and origin
marker is excluded. It also starts a real `solera-app-*` unit carrying the
project's marker, then stops it from the page. Tests also cover command-line
reduction and masking, tree folding, commands without ports, tmux, orphan cgroup
membership, project permissions and targeted stopping.
