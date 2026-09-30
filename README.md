# SLine — Claude status line

A [Claude Code](https://claude.com/claude-code) plugin that shows **rate limits for every Claude
account you use** in the status line: live for this session's account, and as last recorded or
checked for your others, a pace-aware weekly figure, and one command to show or hide the usage
numbers.

```
dir:~/projects/app (main) · model:Opus 5.5 · effort:high · ctx: 12% · session:340.0ktk
[A] 5h: 52%, 23:49 · 7d: 38% / 61%, Mon 17:29
[B] 5h: 0%, --:-- · 7d: 81% / 58%, Mon 23:29  (3m ago)
```

- **Line 1**: folder and git branch, model, effort, context used, this session's tokens.
- **Line 2**: the account this session uses, live from Claude Code.
- **Line 3+**: your other accounts, as last recorded by their own sessions on this machine, or
  checked through Claude Code in the background when those numbers are more than 30 minutes old.

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
- Other accounts appear once a Claude Code session has run as that account on this machine, or
  once a background check through Claude Code (`claude` on `PATH`) succeeds; until then their
  line shows `usage:--`.

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
| Account lines | `5h`, `5h.reset`, `5h.pace`, `7d`, `7d.pace`, `7d.reset`, `7d.model`, `7d.model.reset`, `spend`, `spend.reset`, `age`, `status` |
| Subagent rows | `type`, `activity`, `model`, `model.name`, `effort`, `ctx`, `tokens`, `elapsed` |

Line 1 also takes any field of Claude Code's status line JSON by its own name, e.g.
`{session_name}`, `{output_style.name}`, `{vim.mode}`. `node cli/sl.js fields` lists the
documented ones. SLine's own fields win a name clash. The ending of the name sets the format:

| Ending | Shown as |
|---|---|
| `_at` | a clock time: `14:32`, or `Mon 17:29` on another day |
| `_ms` | a duration: `1m42s` |
| `_usd` | dollars: `$12.40` |
| `_percentage` | a whole percent: `12%` (rounded, capped at 100%; nonsense values show nothing) |
| other text or number | as is |
| `true` / `false` | `on` / nothing |

Empty or missing values show nothing and drop their `[ … ]` group, so give each one its own group:

```
[ · {session_name}]
[ · cache until {prompt_cache.expires_at}]
```

The defaults:

```
line1:   dir:{dir}[ ({branch})]{sep}[model:{model.name}]{sep}[effort:{effort}]{sep}[ctx: {ctx}]{sep}[session:{session}]
label:   \[{label}\] 
account: [5h: {5h}, {5h.reset}]{sep}[7d: {7d} / {7d.pace}, {7d.reset}]{sep}[spend: {spend}, {spend.reset}][{status}][  {age}]
subagent: [{type}  ]{activity}{sep}[model:{model.name}]{sep}[effort:{effort}]{sep}[ctx: {ctx}]{sep}[tokens:{tokens}]{sep}[{elapsed}]
```

Thresholds (`ctx 30,65`, `5h`, `7d` and `spend 30,75`), the 7d pace rule, the 5h pace rule
(`display.thresholds.5hPace`, off by default: the 5h value turns orange when it is ahead of the
share of the 5-hour window that has passed), the "reset soon"
windows (5h: 60 minutes, 7d: 48 hours), the colours (`ok`, `warn`, `high`, `dim`: a name, a
0-255 number, `#rrggbb` or `none`) and the clock (`24h`/`12h`) are settings too. `NO_COLOR`
turns colour off. A template that doesn't parse is refused; if one is edited into `config.json`
by hand, that line falls back to its default and says so, and `/sline:doctor` explains.

### Fitting the terminal width

`display.width` is `auto` (the default: the terminal's `COLUMNS` minus 2), `off`, or a whole
number of at least 20. When a line is too wide, SLine first shortens the folder
(`~/…/claude-statusline`), then drops `[ … ]` groups from the right, then cuts the end with `…`.
Account lines drop the same groups together so they stay aligned. A line that would
be left empty keeps more groups and is cut instead. A number is used as the width as is (no
margin), with or without `COLUMNS`; with `auto` and no `COLUMNS`, nothing is fitted.

### Per-model weekly limit

Max plans may spend part of the weekly limit on Fable. Claude Code's status line JSON doesn't
carry it, so `{7d.model}` (e.g. `Fable 42%`) and `{7d.model.reset}` come from the background
checks. Using either in the account template also makes SLine check the **active** account every
30 minutes (with `fetch.otherAccounts` on, like every background check). Pro plans have no such row, so the field stays empty and its group drops.

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
- **`(3h ago)`**: when that account's numbers were last recorded by its own session or checked
  through Claude Code. After a reset time passes the line shows the reset (5h back to 0% with
  `--:--`, 7d to 0% with the next weekly reset).

### Work-week pace

If you only use an account on working days, "Mon-Fri work week" in `/sline:config` spreads
the weekly quota over those days. Weekends then accrue nothing, so the pace holds still and any
weekend use shows as over pace. Anthropic's real limit is always a rolling 7 days; this only
changes the expected burn-down.

## Privacy and security

- SLine reads no credentials and makes no network calls itself. The status line uses the data
  Claude Code hands it and saves percentages and reset times per account under
  `~/.claude/sline/`.
- For background checks it runs Claude Code's `/usage` under your other logins (and under the
  active one when the account template shows `{7d.model}`), and Claude
  Code contacts Anthropic as it always does. A check is `claude -p /usage
  --no-session-persistence`, with a config folder of its own under `~/.claude/sline/accounts/`.
  It uses no model turns and no quota, and runs at most once per account every 30 minutes.
  `/sline:config fetch.otherAccounts false` turns that off.
- `/sline:init` writes to `~/.claude/settings.json`: it sets `statusLine` and
  `subagentStatusLine`, after backing the file up. `/sline:uninstall` puts your previous
  values back.

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
