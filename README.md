# sline — Claude status line

A [Claude Code](https://claude.com/claude-code) plugin that shows **live rate limits for every
Claude account you use** in the status line, a pace-aware weekly figure, and one command to show or
hide the usage numbers.

```
dir:~/projects/app (main) · model:Opus 5.5 · effort:high · ctx: 12% · session:340.0ktk
[A] 5h: 52%, 23:49 · 7d: 38% / 61%, Mon 17:29
[B] 5h: 0%, --:-- · 7d: 81% / 58%, Mon 23:29  (3m ago)
```

- **Line 1**: folder and git branch, model, effort, context used, this session's tokens.
- **Line 2**: the account this session uses, live from Claude Code.
- **Line 3+**: your other accounts, fetched in the background and cached.

The `[A]` / `[B]` labels appear only when more than one account line is on screen. Hiding usage
(`/sline:usage hide`) replaces lines 2+ with a dim `hidden`; line 1 stays as it is.

While subagents run, each of their rows under the prompt shows its type and what it's doing,
then its own stats:

```
○ general-purpose  Reading fsutil.js · model:Haiku 4.5 · ctx: 16% · tokens:32.4k · 1m42s
```

## Requirements

- Claude Code with a claude.ai Pro or Max login (rate limits only exist for subscriptions).
- **Node.js 18 or later** on `PATH`. Nothing else: no bash, git or npm packages.
- Other accounts are read from `<login folder>/.credentials.json`, which Claude Code writes on
  Windows and Linux. On macOS the token lives in the Keychain, so only the active account shows.

## Install

```
/plugin marketplace add sachingulati/claude-plugins
/plugin install sline@sachingulati
/sline:init
```

Installing changes nothing by itself: run `/sline:init` once. It points `statusLine` and
`subagentStatusLine` in `~/.claude/settings.json` at a small launcher in `~/.claude/sline/`, after backing up
settings.json. The status line appears with the next reply. Plugin updates need nothing: open
sessions switch to the new version within one refresh.

## Commands

| Command | Does |
|---|---|
| `/sline:init` | Set up the status line (safe to rerun). `--refresh <seconds>` sets how often idle sessions redraw (default 30). |
| `/sline:config` | Show settings, or change them in plain words: "rename B to Work", "Mon-Fri work week", "hide other accounts". |
| `/sline:usage` | `hide` / `show` every account's usage numbers (line 1 stays); `active` / `all` to show only this session's account or every account; `reset` for both defaults. Bare, it reports the current state. |
| `/sline:doctor` | Check the setup and explain any fix. |
| `/sline:uninstall` | Put back your previous status line before removing the plugin. |

Claude can also answer "which account has the most 5h left?" or "when does my weekly limit
reset?" on its own, from the same data.

## Customising the display

Every line is a template you can change with `/sline:config` in plain words ("put the model
first", "drop effort", "red instead of orange", "12-hour clock"), or reset with
"back to the default look".

- `{field}` shows a value; only the value is coloured.
- `[ … ]` is left out when any field inside it is empty.
- `{sep}` prints the separator (` · ` by default) when something was printed before it and the
  part right after it is non-empty; a `{sep}` whose next part is empty is dropped. Put each
  `{sep}` directly before a `[ … ]` group.
- `\[ \] \{ \} \\` print the character itself.

| Line | Fields |
|---|---|
| Line 1 | `dir`, `dir.full`, `dir.name`, `branch`, `model`, `model.name`, `effort`, `ctx`, `session` |
| Account label | `label` (left out when only one account line shows) |
| Account lines | `5h`, `5h.reset`, `7d`, `7d.pace`, `7d.reset`, `spend`, `spend.reset`, `age`, `status` |
| Subagent rows | `type`, `activity`, `model`, `model.name`, `effort`, `ctx`, `tokens`, `elapsed` |

The defaults:

```
line1:   dir:{dir}[ ({branch})]{sep}[model:{model.name}]{sep}[effort:{effort}]{sep}[ctx: {ctx}]{sep}[session:{session}]
label:   \[{label}\] 
account: [5h: {5h}, {5h.reset}]{sep}[7d: {7d} / {7d.pace}, {7d.reset}]{sep}[spend: {spend}, {spend.reset}][{status}][  {age}]
subagent: [{type}  ]{activity}{sep}[model:{model.name}]{sep}[effort:{effort}]{sep}[ctx: {ctx}]{sep}[tokens:{tokens}]{sep}[{elapsed}]
```

Thresholds (`ctx 30,65`, `5h`, `7d` and `spend 30,75`), the 7d pace rule, the "reset soon"
windows (5h: 60 minutes, 7d: 48 hours), the colours (`ok`, `warn`, `high`, `dim`: a name, a
0-255 number, `#rrggbb` or `none`) and the clock (`24h`/`12h`) are settings too. `NO_COLOR`
turns colour off. A template that doesn't parse is refused; if one is edited into `config.json`
by hand, that line falls back to its default and says so, and `/sline:doctor` explains.

## Multiple accounts

Claude Code keeps each login in the folder named by `CLAUDE_SECURESTORAGE_CONFIG_DIR` (default
`~/.claude`). To use a second account, log it into its own folder:

```bash
CLAUDE_SECURESTORAGE_CONFIG_DIR="$HOME/.creds-b" claude   # then /login
alias claudeb='CLAUDE_SECURESTORAGE_CONFIG_DIR="$HOME/.creds-b" command claude'
```

Start one session with it (e.g. `claudeb`) and it appears as the next letter as soon as the status line draws; your default login
becomes `A`. Rename or forget accounts with `/sline:config`.
The status line detects which account a session uses from the same variable.

## Reading the status line

| Colour | Meaning |
|---|---|
| green | comfortable |
| yellow | watch it |
| orange | over pace or near the cap |

- **`5h: 52%, 23:49`**: 52% of the rolling 5-hour limit used; it resets at 23:49. The time turns
  green in its last hour, and shows `--:--` when no window is running.
- **`7d: 38% / 61%, Mon 17:29`**: 38% of the weekly limit used, against 61% of the week elapsed
  (the pace). Above pace turns orange. The reset time turns orange in its last 48 hours.
- **`spend: 64%, Thu 00:00`**: only behind a Claude apps gateway with a spend limit: how much of
  it is used and when it resets. Orange above 75%, and past 100% once exceeded.
- **`(3m ago)`**: age of a background-fetched line. A yellow `stale` means refreshes are failing,
  not merely old. `auth?` means that account needs a fresh `/login`.

### Work-week pace

If you only use an account on working days, "Mon-Fri work week" in `/sline:config` spreads
the weekly quota over those days. Weekends then accrue nothing, so the pace holds still and any
weekend use shows as over pace. Anthropic's real limit is always a rolling 7 days; this only
changes the expected burn-down.

## How it works

- Claude Code runs `node "<home>/.claude/sline/launch.js"` (a full path; `<home>` is your home
  folder). The launcher reads the current plugin folder from `~/.claude/sline/root` and renders
  from there. After a plugin update it finds
  the new folder in Claude Code's install record and repoints itself, so settings.json never goes
  stale. The plugin has no hooks; nothing runs when a session starts.
- Subagent rows come from Claude Code's `subagentStatusLine` setting, which runs the same
  launcher with a `subagents` argument once per refresh. Claude Code passes each session only its
  own rows. The agent type isn't in that data, so it's read from the small `agent-<id>.meta.json`
  Claude Code keeps next to the session transcript; if that file is missing, the row just has no
  type. If anything fails, Claude Code's own row stays.
- The active account's numbers come from the data Claude Code hands the status line: free and
  instant. They're also saved to its cache, so after you switch accounts it shows where it really
  ended.
- Other accounts are fetched from `GET /api/oauth/usage` (the endpoint `/usage` uses; it does not
  consume quota) by a detached background process. The status line never waits on the network.
- `refreshInterval` makes idle sessions redraw every 30 s. Without it Claude Code only redraws
  after a reply, and an idle session would keep showing other accounts' old numbers.

Files, all under `~/.claude/sline/` (or `$CLAUDE_CONFIG_DIR/sline/`):

| File | |
|---|---|
| `launch.js`, `root` | launcher and plugin pointer |
| `config.json` | accounts and settings |
| `cache/*.json` | usage per account (percentages and reset times only, no tokens) |
| `hidden` | present while usage is hidden |
| `install.json` | your previous status line and subagent rows, for uninstall |

## Privacy and security

- Tokens are read, never written or refreshed, and only sent to Anthropic's own API.
- `/api/oauth/usage` is undocumented and may change; if it does, the affected line shows
  `usage:--` and the rest keeps working.

## Development

```bash
node --test                          # all tests, no dependencies
claude plugin validate .             # plugin manifest and skills
claude --plugin-dir .                # run Claude Code with this checkout loaded in place
```

Use a throwaway `CLAUDE_CONFIG_DIR` when trying `/sline:init`, so your real settings.json
stays untouched.

## License

MIT, see [LICENSE](LICENSE).
