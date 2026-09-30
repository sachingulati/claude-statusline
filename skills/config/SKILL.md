---
description: Show or change SLine settings - accounts, what each line shows and in what order, colours and when they change, clock, work-week pace, refresh timing, hidden marker.
argument-hint: "[what to change, in plain words]"
disable-model-invocation: true
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/cli/sl.js" *)
---

Show or change SLine settings. **Only change settings through the CLI below. Never edit config.json or settings.json yourself.**

The CLI is `node "${CLAUDE_PLUGIN_ROOT}/cli/sl.js"`. Add `--json` to every call and read `ok`, `result`, `error` and `fix` from the output. Most values take **one argument in single quotes**, e.g. `config set display.thresholds.ctx '30,75'`.

For **templates, the separator and the hidden marker**, pass the value through stdin with a quoted heredoc instead — on Windows, Git Bash rewrites an argument that starts with `/` into a Windows path before node ever sees it, and a quoted heredoc passes `'`, brackets and spaces exactly (backslashes: see the check below):

    node "${CLAUDE_PLUGIN_ROOT}/cli/sl.js" config set display.line1 --stdin --json <<'EOF'
    {model}{sep}{dir}[ ({branch})]
    EOF

After **every** `config set`, compare `result.value` with the value you meant, character for character (spaces and backslashes included). On some setups the shell tool turns `\\` into `\` before bash runs, even inside a quoted heredoc. If backslashes are missing, set it again with every backslash in the heredoc doubled (`\\` → `\\\\`, `\[` → `\\[`) and compare again. If it still differs, tell the user exactly what was stored.

## No arguments

Run `config show --json`. Show the settings as a short table (setting, value, where it comes from), the accounts list, and `result.sample` (how the status line looks with these settings), then ask what the user wants to change.

## With arguments: $ARGUMENTS

Map the request to one or more of these calls, run them, then show the result:

| Request | Call |
|---|---|
| rename an account | `config account rename <label> <new label>` |
| remove / forget an account | `config account forget <label>` |
| add a login folder that hasn't had a session yet | `config account add <label> <credsDir>` |
| show only the active account / hide other accounts | tell the user `/sline:usage active` does this; or `config set display.otherAccounts false` |
| show all accounts again | `/sline:usage all`; or `config set display.otherAccounts true` |
| what line 1 shows, or its order | `config set display.line1 --stdin` (heredoc) |
| what each account line shows, or its order | `config set display.account --stdin` (heredoc) |
| how the account label looks | `config set display.label --stdin` (heredoc) |
| what each subagent row shows, or its order | `config set display.subagent --stdin` (heredoc) |
| the separator between parts | `config set display.separator --stdin` (heredoc) |
| when a figure turns yellow / orange | `config set display.thresholds.<ctx\|5h\|7d\|spend> <low>,<high>` (0-100) |
| 7d orange when ahead of pace, on/off | `config set display.thresholds.7dPace true\|false` |
| 5h orange when ahead of the 5-hour window's pace, on/off (default off) | `config set display.thresholds.5hPace true\|false` |
| 5h reset time green in its last N minutes | `config set display.thresholds.5hResetSoon <minutes>` (0 = off) |
| 7d reset time orange in its last N hours | `config set display.thresholds.7dResetSoon <hours>` (0 = off) |
| colours | `config set display.colors.<ok\|warn\|high\|dim> <name\|0-255\|#rrggbb\|none>` — `ok` green, `warn` yellow, `high` orange, `dim` faint text |
| fit lines to the terminal width (`auto` uses COLUMNS minus 2; `off`; or a whole number of at least 20) | `config set display.width auto\|off\|<columns>` |
| 12- or 24-hour clock | `config set display.clock 12h\|24h` |
| the default look back | `config reset display` |
| work week, e.g. Mon-Fri | `config set pace.workingDays mon-fri` (also takes names like `mon,wed,fri`, or numbers 0 = Sunday … 6 = Saturday) |
| all seven days | `config set pace.workingDays 0,1,2,3,4,5,6` |
| how often idle sessions refresh | `config set refreshInterval <seconds>` (minimum 5) |
| stop or allow background checks of other accounts (also the per-model check of the active one) | `config set fetch.otherAccounts false` / `true` |
| text shown while usage is hidden | `config set hidden.marker --stdin` (heredoc) |

### Templates

- `{field}` is a value; only the value is coloured. `[ … ]` is dropped when any field inside it is empty. `{sep}` prints the separator when something was printed before it and the part right after it is non-empty (not allowed inside `[ ]`); a `{sep}` whose next part is empty is dropped, so put each `{sep}` directly before a `[ … ]` group. `\[ \] \{ \} \\` print the character.
- Line 1 fields: `dir` (`~/projects/app`), `dir.full`, `dir.name` (`app`), `branch`, `model` (`claude-opus-5-5`), `model.name` (`Opus 5.5`), `effort`, `ctx`, `session`.
- Label field: `label` (the whole label template is left out when only one account line shows).
- Account fields: `5h`, `5h.reset`, `5h.pace`, `7d`, `7d.pace`, `7d.reset`, `7d.model` (per-model weekly rows such as `Fable 42%`, from background checks; empty on plans without them), `7d.model.reset` (the earliest of their resets), `spend`, `spend.reset`, `age`, `status`.
- Subagent row fields (the rows under the prompt while subagents run): `type` (`general-purpose`), `activity` (the live text, e.g. `Reading fsutil.js`), `model` (`claude-haiku-4-5-20251001`), `model.name` (`Haiku 4.5`), `effort` (only when the subagent sets its own), `ctx`, `tokens`, `elapsed` (only while running). The sample's last line, starting `○`, is a subagent row.
- Change the **current** template minimally: read it from `config show`, then e.g. to drop effort remove `{sep}[effort:{effort}]`; to put the model first move `[model:{model.name}]{sep}` to the front.
- Before a template change, show the current template and `result.sample` from `config show`; after `config set`, show the new template and the new `result.sample`.

Rules:
- **Accounts add themselves.** Starting a session with a new login folder (e.g. through a `CLAUDE_SECURESTORAGE_CONFIG_DIR` alias) adds it under the next letter. If the user asks to "add" an account they have already used here, tell them it's added automatically and show the list. Use `account add` only for a folder that hasn't had a session yet.
- **Forget, not delete.** A forgotten account's folder is remembered so it doesn't come back next session; adding it again with `account add` undoes that.
- A `warning` in the result of `account add` means that folder has no login yet. Tell the user how to log in, using the command in the warning.
- If a call returns `"ok": false`, tell the user the `error` and the `fix` and do not retry with guessed values.
- If the request is ambiguous (e.g. a label or folder is missing), ask before running anything.

## Claude Code fields on line 1

Line 1 can also show **any field of Claude Code's status line JSON, by Claude Code's own name**, e.g. `{session_name}`, `{output_style.name}`, `{vim.mode}`, `{prompt_cache.expires_at}`, `{rate_limits.spend_limit.used_usd}`. Run `node "${CLAUDE_PLUGIN_ROOT}/cli/sl.js" fields --json` for the list, and map the user's words onto a name from it. SLine's own fields win a name clash.

The name's ending sets the format: `_at` → a clock time (`14:32`, or `Mon 17:29` on another day), `_ms` → a duration (`1m42s`), `_usd` → dollars (`$12.40`), `_percentage` → a whole percent (rounded, capped at 100%; nonsense values show nothing). Other text shows as is; `true` shows `on` and `false` nothing. Empty or missing values drop their `[ … ]` group, so wrap each Claude Code field in its own `[ … ]` group together with its label, and put `{sep}` directly before the group, e.g. `{sep}[{session_name}]` or `{sep}[cache until {prompt_cache.expires_at}]`. (`{sep}` is not allowed inside `[ ]`; to use literal separator text inside a group, write it as plain text, e.g. `[ · {session_name}]`.)

If `config set` returns `warnings`, tell the user the name isn't a documented Claude Code field and will show nothing unless Claude Code sends it.
