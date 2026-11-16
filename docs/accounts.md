# Extra accounts

Each CLI keeps a single sign-in: Claude Code in its configuration directory, Codex in
the `auth.json` of its home. Solera lets a user register **extra accounts** for each
of them, then pick one per conversation. Accounts belong to the Solera user who
created them, like git access tokens: another member of a shared project cannot run
a session on your subscription.

The choice lives in the conversation's configuration, under **Account** in the
composer, in **Settings › CLI defaults**, and in a project's presets. Changing it on a
running conversation restarts the session, as the permission mode does. When the
chosen account no longer exists, the session starts on the CLI's own sign-in and says
so in the thread.

On the new-session screen, an **Account** choice sits right under the CLI choice as
soon as an extra account exists. Each option shows where its account stands: the two
most loaded usage windows for the CLI's own sign-in and for Codex subscriptions, or a
sentence for the accounts that have no gauge (a subscription token, an API key). It
sets the same field as the composer's **Account** setting.

## Claude Code

Settings › **Claude accounts**. An account is one of two things:

- **A subscription** (Pro, Max, Team), reached through the long-lived token that
  `claude setup-token` prints. Solera hands it to the session in
  `CLAUDE_CODE_OAUTH_TOKEN`, which Claude Code takes ahead of its stored `/login`
  (probed on 2.1.296: a bogus token fails with 401, a valid one answers). The token
  lasts a year; replace it from the account's card when it expires.
- **A Console API key** (`sk-ant-api03-…`), billed per use on the key's organization.
  Handed to the session in `ANTHROPIC_API_KEY`; in non-interactive mode the CLI takes
  it without asking. The conversation header then shows the computed cost, which has
  a meaning here that it lacks on a subscription.

The kind is read from the secret's prefix. Secrets are encrypted at rest with the
same key as git access tokens and never returned by the API.

### Adding a subscription without a terminal

Choose **Sign in with a subscription**. Solera runs `claude setup-token` in a
pseudo-terminal, inside a throwaway configuration directory so the host's own
sign-in is neither read nor touched, and follows the dialogue the command expects:

1. it shows the authorization page the CLI printed; open it, signed in to the Claude
   account you want, and authorize Claude Code;
2. the page then shows a code; paste it back in Solera;
3. the CLI prints the token, Solera encrypts it, and the account appears.

A refused code can be retried without starting over. The CLI waits fifteen minutes
for the code, then the attempt is dropped. This is the same flow as
`claude setup-token` in SSH, where the browser cannot reach the CLI's local callback:
the page shows the code instead.

### Adding a token or a key by hand

Choose **Paste a token or an API key**. To mint a subscription token yourself, from a
terminal signed in to that subscription:

```bash
# keep the host's sign-in untouched: a separate configuration directory
CLAUDE_CONFIG_DIR=~/.claude-work claude auth login
CLAUDE_CONFIG_DIR=~/.claude-work claude setup-token
```

### Usage gauge

A subscription token cannot read plan limits: `setup-token` only asks for the
`user:inference` scope (read in its authorization URL, 2.1.296), and without
`user:profile` the CLI does not read them. Each subscription can therefore get a
**gauge**: a second, full sign-in (`claude auth login`), run by Solera the same guided
way, and kept in `<data>/claude-accounts/<id>` (`.credentials.json` and `.claude.json`
only, mode `0600`). Sessions never use it; usage reads run the CLI with
`CLAUDE_CONFIG_DIR` pointing there, and the CLI renews that sign-in by itself.

Solera offers the gauge right after a subscription is added, and on every
subscription card (**Enable the gauge**, **Sign in again**, **Remove the gauge**). The
card shows the e-mail the gauge is signed in as: it should be the same account as the
token. A refused code makes `auth login` exit (« Login failed: … »), unlike
`setup-token` which waits for another; Solera then starts a fresh one under the same
sign-in and shows its new link. An API key has no plan, so no gauge.

### Limits

- A token cannot open Remote Control sessions nor fetch claude.ai connectors. Local
  MCP servers work.
- Nothing checks a secret when it is saved beyond its prefix: checking would cost a
  model request. A wrong one shows up on the first message, as a 401 in the thread.

## Codex

Settings › **Codex accounts**. Codex keeps its sign-in in `$CODEX_HOME/auth.json`, so
each account gets its own home under Solera's data directory (`codex-accounts/<id>`),
with no link to the user's `~/.codex` (or `$CODEX_HOME`), so that an isolated
environment only ever sees that account (ADR 0001). At every launch Solera copies in
the user's `config.toml` stripped of anything that may hold a secret (an MCP server
that held one is dropped whole), `AGENTS.md`, `AGENTS.override.md`, `rules/` and
`skills/` (except `.system`). Sign-in and memories belong to the account.

A thread follows the conversation from one account to another by copy: before a
resume or a fork, Solera copies its file to the same relative path
(`sessions/YYYY/MM/DD/rollout-…-<id>.jsonl`) from whichever of the user's homes has the
newest version (probed on codex-cli 0.167.0, see `docs/CODEX.md`). Deleting an account
first moves its threads to `codex-accounts/_conserve/<user>`, which is searched too.

A conversation that names no account starts on the first signed-in account of the
list, as for Claude; one whose account was deleted or signed out falls back the same
way, and the thread says so. A session never runs on the CLI's own sign-in (#147): a
conversation that still names it (`account: null`, an older choice) starts on the first
signed-in account without a notice, and with no signed-in account at all the launch is
refused (`agent_account_required`) and the draft asks to connect one. A thread born on
the CLI's sign-in before that is copied into the account's home on its next resume.

The session gets `CODEX_HOME` pointing at the account's home. Solera stores no
secret: Codex writes and refreshes `auth.json` itself. The account's card only keeps
what `account/read` said, the e-mail and plan of a ChatGPT sign-in.

### Signing in

An account is created with a name, then signed in from its card:

- **Device code**, for a ChatGPT subscription. Solera starts `codex app-server` in
  the account's home, asks for `account/login/start` with `chatgptDeviceCode`, and
  shows the verification URL and the one-time code. Open the page with the ChatGPT
  account you want and enter the code; Codex reports completion and the card turns to
  *Signed in*. Device-code sign-in is a beta at OpenAI and must be allowed in the
  ChatGPT security settings of that account.
- **API key**, handed to Codex, which stores it in that home.

The classic browser flow is deliberately absent: its callback lands on
`localhost:1455` *of the server*, which the user's browser cannot reach.

**Sign out of this account** removes the home's `auth.json`; deleting the account
keeps its threads aside, then removes the home. Only signed-in accounts appear in the composer's selector: a home
without `auth.json` would refuse the turn.

### Limits

- Moving a thread by copy is a bet on Codex's layout: it relies on the rollout's
  file name and path, which Codex checks.
- Usage is read per account through the same `account/rateLimits/read`, in the
  account's home.

## OpenCode

Not covered: OpenCode has no account notion in Solera.

## Grok Build

Same design as Codex: Grok Build keeps one sign-in per `GROK_HOME`, in its `auth.json`.

- Each account gets its own home under `<data>/grok-accounts/<id>`, with no link to
  the user's `~/.grok`. Solera copies in `config.toml` without secrets, `rules/` and
  `skills/`; sign-in, its caches and memory (`memory-v2/`) belong to the account. A
  session moves between accounts by copy of its folder
  (`sessions/<encoded folder>/<id>/`), not yet probed with a signed-in account, and is
  kept aside under `grok-accounts/_conserve/<user>` when its account is deleted. The
  fallback to the first signed-in account, and the refusal without one, are the same
  as Codex's.
- Sign-in is run by Grok in that home: `grok login --device-auth` for a SuperGrok or
  X Premium subscription (Solera reads the URL and code it prints), or the ACP
  `xai.api_key` method with `XAI_API_KEY` for an xAI API key, which Grok stores in the
  home's `auth.json`. Solera keeps no secret.
- Sign-out runs `grok logout` in the home, then removes its `auth.json`.
- The session receives `GROK_HOME`. Changing the account restarts the process.
- Usage is read per account through Grok's `_x.ai/billing` extension: the share of the
  weekly or monthly credit allowance, the on-demand cap and the prepaid balance.
- Probed on Grok Build 1.0.62.
