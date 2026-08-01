# claude-statusline

A [Claude Code](https://claude.com/claude-code) status line that shows **live rate-limit
usage for every account you're logged into — at once**, not just the one you're currently
using. Built for people who juggle **multiple Claude subscriptions** (personal + work, two
Max plans, a team spare) and want to see, at a glance, which account still has headroom —
plus a one-key **toggle** to show or hide the usage numbers.

```
dir:~/projects/app (main) · model:claude-opus-4-8 · effort:high · ctx: 12% · session:340.0ktk
[A] 5h: 52%, 23:49 · 7d: 38% / 61%, Mon 17:29
[B] 5h: 0%, --:-- · 7d: 81% / 58%, Mon 23:29  (3m ago)
```

- **Line 1** — working directory + git branch, model, effort/thinking level, context-window
  usage, and this session's token total.
- **Line 2** — the **active** account's 5h and 7d rate limits, taken live and free from the
  data Claude Code already hands the status line.
- **Line 3+** — every **other** logged-in account's 5h / 7d, fetched in the background and
  cached, with a freshness tag. The `[A]` / `[B]` label only appears when you have more than
  one account.

---

## Table of contents

- [Why this exists](#why-this-exists)
- [Features](#features)
- [Reading the status line](#reading-the-status-line)
- [Requirements & platform support](#requirements--platform-support)
- [Install](#install)
- [Configuration](#configuration)
  - [Accounts](#accounts)
  - [7-day pace & the work-week mode](#7-day-pace--the-work-week-mode)
  - [Refresh cadence](#refresh-cadence)
  - [Hidden marker](#hidden-marker)
- [The `ut` hide toggle](#the-ut-hide-toggle)
- [Updating, re-linking, uninstalling](#updating-re-linking-uninstalling)
- [How it works](#how-it-works)
- [Privacy & security](#privacy--security)
- [Troubleshooting](#troubleshooting)
- [License](#license)

---

## Why this exists

Each Claude Code session only ever receives **its own** account's rate limits — a session
signed into account A physically never sees account B's numbers. So if you run more than one
subscription, the built-in status line can only ever tell you about the one you happen to be
in. The moment you want to answer *"which of my accounts should I run this big job on?"* you're
blind to all the others.

This tool closes that gap. It reads each account's usage from Claude's own usage endpoint and
shows them side by side, so you always know where every account stands without switching into
it. The active account stays **live and free** (its numbers come straight from the session);
the others are polled gently in the background and cached.

## Features

- **All accounts at a glance** — 5h and 7d rate limits for every logged-in account, on their
  own line, colour-coded by headroom.
- **Active account is always live** — its quota comes from the status-line payload Claude Code
  already provides, so it's instant and costs nothing.
- **Background, non-blocking refresh** — other accounts are fetched with a detached process
  (stale-while-revalidate); the status line never waits on the network.
- **Pace-aware 7-day figure** — shows used % *against* how much of the week has elapsed
  (`38% / 61%`), so "am I burning too fast?" is obvious. Optional **work-week mode** spreads
  the weekly quota over just your working days (e.g. Mon–Fri) — see [below](#7-day-pace--the-work-week-mode).
- **One-key hide toggle (`ut`)** — instantly switches *every* usage number off or on;
  also pauses background API calls while hidden.
- **Interactive setup** — a first-run questionnaire (and a `usage-config` command) writes your
  config for you; no hand-editing required.
- **Run-in-place / `git pull` to update** — the code lives in the repo and `settings.json`
  points at it, so updating is just a pull. Nothing is copied into `~/.claude`.
- **Portable & self-contained** — pure Node + bash, no dependencies to install. One config file
  travels with you; add or remove machines freely.
- **Zero-config fallback** — with no config file it runs as a normal single-account status line.

## Reading the status line

Colours (all thresholds are in the config-free defaults):

| Colour | Meaning |
|---|---|
| **green** | comfortable |
| **yellow** | watch it |
| **orange** | over pace / near the cap |

Field by field:

- **`5h: 52%, 23:49`** — 52% of the rolling 5-hour limit used; that window resets at 23:49.
  The reset time turns **green** in its final hour (the wait's nearly over) and shows `--:--`
  once there's no active window.
- **`7d: 38% / 61%, Mon 17:29`** — 38% of the weekly limit used, versus **61% of the week
  elapsed** (the "pace"), resetting Mon 17:29. Used < pace ⇒ you're under budget. Used > pace
  ⇒ **orange** (burning too fast). The reset turns orange in its last 48 h.
- **`(3m ago)`** — how old a background-fetched account line is. It stays dim while healthy; it
  gains a yellow **`stale`** flag only when refreshes are actually *failing* (not merely old).

## Requirements & platform support

- **Node.js** and **bash** on `PATH`. No npm install — there are no dependencies.
- Claude Code storing its OAuth token as **plaintext JSON** at
  `<creds-dir>/.credentials.json`.

| Platform | Status |
|---|---|
| **Windows** (Git Bash) | ✅ supported |
| **Linux / WSL** | ✅ supported |
| **macOS** | ⚠️ not yet — macOS keychains the token instead of writing `.credentials.json`, so the reader finds nothing. The extension point is a `security find-generic-password` branch in `src/usage-refresh.js`; PRs welcome. |

## Install

Run-in-place: clone anywhere, and `settings.json` will point at that clone.

```bash
git clone <repo-url> ~/projects/claude-statusline
cd ~/projects/claude-statusline
node install.js          # or: ./install.sh   |   pwsh ./install.ps1
```

The installer:

1. Points `~/.claude/settings.json`'s `statusLine` at `src/statusline-command.sh` (saving the
   previous value so `--uninstall` can restore it).
2. **Runs the interactive setup** (first time, in a terminal) to write
   `~/.claude/statusline-accounts.json` — or seeds it from the example if run non-interactively.
3. Adds `ut` and `usage-config` aliases to your `~/.bashrc` / `~/.zshrc` in a managed block
   (skip with `--no-alias`).

Then start a new session — or press a key in an open one — to see it.

## Configuration

Everything lives in **`~/.claude/statusline-accounts.json`** — personal, per-machine, and
**never committed** (the repo ships `statusline-accounts.example.json`). Edit it directly, or
re-run the questionnaire any time with **`usage-config`** (alias) / `node configure.js` /
`node install.js --configure`.

```json
{
  "accounts": [
    { "label": "A", "credsDir": "~/.claude" },
    { "label": "B", "credsDir": "~/.creds-b" }
  ],
  "pace":   { "workingDays": [1, 2, 3, 4, 5] },
  "refresh": {
    "okSeconds": 1800,
    "idleSeconds": 3600,
    "errorSeconds": 240,
    "rateLimitedSeconds": 1800
  },
  "hidden": { "marker": "hidden" }
}
```

### Accounts

One entry per login:

- **`label`** — the prefix shown (`[A]`). Also names the cache file.
- **`credsDir`** — that account's credentials directory (`~` expands to home). An account whose
  `.credentials.json` is missing is silently skipped, so it's safe to list accounts that only
  exist on some machines.

Omit the file entirely and it falls back to a single default account (`~/.claude`, no label) —
a normal single-account status line with zero config.

**How multiple accounts work.** Claude Code keeps each login's credentials in a directory chosen
by the `CLAUDE_SECURESTORAGE_CONFIG_DIR` environment variable (default `~/.claude`). To run a
second account you point that variable at a different dir and log in:

```bash
# log a second account into its own creds dir
CLAUDE_SECURESTORAGE_CONFIG_DIR="$HOME/.creds-b" claude   # then /login

# a launcher alias to start it easily
alias claudeb='CLAUDE_SECURESTORAGE_CONFIG_DIR="$HOME/.creds-b" command claude'
```

Then add `{ "label": "B", "credsDir": "~/.creds-b" }` to the config (or run `usage-config`). The
status line detects which account is active from that same variable and marks it on line 2.

### 7-day pace & the work-week mode

The **pace** is the `/ NN%` figure next to your 7-day usage: how much of the weekly quota you'd
have spent *by now* if you burned it evenly. It's what turns raw usage into "am I ahead or
behind?".

By default the quota is spread over **all 7 calendar days**. But if you only use an account on
working days — e.g. a work laptop you don't touch on weekends — an even 7-day spread understates
your workday budget and makes Friday look alarming. **Work-week mode** fixes this:

```json
"pace": { "workingDays": [1, 2, 3, 4, 5] }
```

`workingDays` are day numbers, **0 = Sunday … 6 = Saturday**. With Mon–Fri set:

- The weekly quota is spread across **working days only**, so on a workday you're "allowed" to
  burn proportionally faster (5 days of budget instead of 7).
- **Weekends accrue no allocation** — the pace holds *flat* across Sat/Sun. If you don't use the
  account then, nothing changes; if you do, it reads as **over pace** (a nudge that you're
  dipping into budget you didn't plan for).

Anthropic's actual 7-day limit is always a rolling 7 calendar days — this setting only changes
how the *expected* burn-down is drawn, never the real limit. Set all seven days (or omit `pace`)
for the classic even spread. Non-Mon–Fri weeks are fully supported — e.g. `[0,1,2,3,4]` for a
Sunday–Thursday week.

### Refresh cadence

How often inactive accounts are polled in the background, in seconds. The active account is
never polled (it's live from the session), so these only govern the *other* lines.

| Key | Default | When it applies |
|---|---|---|
| `okSeconds` | 1800 (30 min) | normal cadence |
| `idleSeconds` | 3600 (1 h) | account reading exactly 0% — nothing to watch |
| `errorSeconds` | 240 (4 min) | after a transient failure, to recover quickly |
| `rateLimitedSeconds` | 1800 | after a 429 (keep ≥ `okSeconds`) |

Defaults are deliberately relaxed: normally only one account is active at a time, so the others'
quota is essentially frozen. A window whose reset time has passed always forces an early refresh
regardless, so staleness stays bounded.

### Hidden marker

`hidden.marker` is the dim text shown on line 1 while usage is hidden (see below). Set it to
`""` to show nothing at all.

## The `ut` hide toggle

A flag file `~/.claude/statusline-hidden` suppresses **everything numeric** —
context %, session tokens, all rate limits, and even the fact that multiple accounts exist. Only
`dir / model / effort` remain (plus the dim marker), and **no background API calls fire** while
hidden. It takes effect on the next render, across every open session at once.

The installer adds a **`ut`** alias that flips it either way and prints the new state:

```bash
ut               # -> "usage: HIDDEN"  /  "usage: visible"
node toggle.js   # the same toggle for PowerShell / other shells
```

`ut` is self-contained (just the flag file — no Node, survives moving the repo). The managed rc
block also defines **`usage-config`** to re-run the config questionnaire.

## Updating, re-linking, uninstalling

- **Update:** `git pull` in the repo. Live immediately — nothing to re-run, because
  `settings.json` points at the repo rather than a copy.
- **Moved the clone?** `node install.js` (a.k.a. `--relink`) re-points the path and refreshes
  the rc aliases.
- **Change config:** `usage-config` (or `node install.js --configure`).
- **Uninstall:** `node install.js --uninstall` restores the previous `statusLine` and removes
  the rc alias block. Your config, cache, and credentials are left untouched.

## How it works

- **Data source.** For non-active accounts, `src/usage-refresh.js` calls
  `GET /api/oauth/usage` — the same endpoint the `/usage` command reads — using each account's
  OAuth token. It's a plain read that **does not consume model quota**.
- **Stale-while-revalidate.** `src/statusline-render.js` reads the per-account cache instantly
  and, when an entry is due, spawns the refresher **detached** so the render never blocks. The
  next render picks up the fresh value.
- **Active vs. others.** The active account (detected from `CLAUDE_SECURESTORAGE_CONFIG_DIR`)
  takes its numbers straight from the status-line payload — free and instant. Only the others
  hit the endpoint.
- **The active account writes its own cache.** Those free live figures are also saved back to
  its cache entry (throttled to at most once a minute). So the moment you switch accounts, the
  one you just left shows the quota it *really* ended on, instead of a snapshot frozen at
  whenever it was last polled — which, for a long session, could be an hour stale.
- **`stale` means failing, not old.** Because refresh intervals vary and an idle machine simply
  doesn't re-render, "old" data is normal. The `stale` flag appears only when the *last attempt
  failed* (`status !== ok`) — a precise signal that something's actually wrong.

### Files

| In the repo (shared, versioned) | |
|---|---|
| `src/statusline-command.sh` | bash entry point wired into `settings.json` |
| `src/statusline-render.js` | renders the lines; reads cache, spawns refreshes |
| `src/usage-refresh.js` | fetches one account's quota into the cache |
| `src/config.js` | shared config + path resolution |
| `install.js` · `configure.js` · `toggle.js` | installer, config questionnaire, hide toggle |

| On each machine (personal, not committed) | |
|---|---|
| `~/.claude/statusline-accounts.json` | your accounts + tuning |
| `~/.claude/usage-cache/*.json` | background-fetched quota |
| `~/.claude/statusline-hidden` | presence = usage hidden |

## Privacy & security

- **Tokens never leave your machine** except in the `Authorization` header of the request to
  Anthropic's own API — the same place Claude Code already sends them.
- The tool **only reads** credential files; it never writes or refreshes them. An expired token
  shows `[X] auth?` and is left for a real Claude session to re-authenticate, so this tool can
  never race or corrupt your login.
- Cache files hold only utilization percentages and reset times — no tokens.
- `GET /api/oauth/usage` is **undocumented / internal** and may change or disappear in a future
  Claude Code release. If it does, the affected line degrades to `usage:--` or a stale marker —
  the status line never breaks.

## Troubleshooting

- **`[B] auth?`** — that account's token is expired. Start a session as that account and
  `/login`.
- **`[B] usage:--`** — no cache yet (first run) or the fetch is failing. Check that
  `<credsDir>/.credentials.json` exists and Node is on `PATH`.
- **A second account never shows** — its `.credentials.json` is missing, or `credsDir` doesn't
  match where you logged it in.
- **Nothing changed after `git pull`** — the status line only re-renders on activity; press a
  key in an open session or start a new one.
- **`ut` says "command not found"** — open a new shell or `source ~/.bashrc` so the alias loads.

## License

MIT — see [LICENSE](LICENSE). (Swap the copyright holder if you fork it.)
