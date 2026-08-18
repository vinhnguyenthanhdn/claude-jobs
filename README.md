# claude-jobs

Scheduled, unattended [Claude Code](https://claude.com/claude-code) runs — driven by the CLI you already have logged in, so **no `ANTHROPIC_API_KEY` is involved**.

One command scaffolds the whole thing: a prompt, a hardened runner script, and a real scheduler entry (launchd, systemd or cron).

```bash
npx claude-jobs init morning-report \
  --skill ./playbooks/morning-report.md \
  --at 09:30 \
  --notify 'echo "$CLAUDE_JOB_MESSAGE" | mail -s "morning report" me@example.com'

npx claude-jobs run morning-report --dry-run   # see exactly what will happen
npx claude-jobs install morning-report          # hand it to the OS scheduler
```

If you have ever written the same `claude -p` wrapper script for the third time — the one with the explicit `PATH`, the random start delay, the summary file, the notifier — this is that script, generalized and tested.

## Why

Claude Code is a real product with a real login. On the machine where you are already signed in, `claude -p` is a legitimate, non-interactive way to run work on your subscription. What that leaves you missing is everything *around* the call: schedulers start with an empty environment, unattended agents must never stop to ask a question, and a run nobody watches needs to report its own outcome.

`claude-jobs` is the boring wrapper that gets those details right, so the interesting part stays in your prompt.

**Non-goals:** this does not proxy, resell or wrap your subscription as an API for other tools. It runs the official CLI, as you, on your own machine. See [docs/policy.md](docs/policy.md).

Claude Code also schedules work by itself now, in three different places. Read [Do you need this?](#do-you-need-this) before installing — for a good share of daily jobs the built-in answer is the better one.

## Install

```bash
npm install -g claude-jobs   # or just use npx claude-jobs
claude-jobs doctor           # checks the binary, the login, and your scheduler
```

Requires Node 18.17+, Claude Code installed and logged in (`claude auth login`) **as the same user that will run the jobs**.

## Commands

| Command | What it does |
| --- | --- |
| `init <name>` | Scaffold prompt + runner + scheduler unit |
| `list` | Every job and whether it is actually scheduled |
| `run <name> [--now\|--dry-run]` | Run by hand — `--dry-run` prints the plan and the prompt |
| `install` / `uninstall <name>` | Register / unregister with launchd, systemd or cron |
| `logs <name> [--lines N]` | Tail the job log |
| `status <name>` | Schedule, paths, and the last summary the agent wrote |
| `doctor` | Binary, login, API-key leakage, scheduler detection |

Useful `init` flags: `--skill`, `--task`, `--prompt-file`, `--at HH:MM`, `--jitter`, `--workdir`, `--scheduler`, `--model`, `--precheck`, `--notify`, `--permission-mode`. Run `claude-jobs help` for the full list.

## What people run

A job earns its place when the work repeats, needs judgement rather than just a command, and produces something short enough to read over coffee. The five that pay off fastest:

- **Dependency and CVE triage.** Run the audit, then separate what actually reaches your code from what sits in a devDependency nothing calls, and open a PR for the safe patch bumps. The sorting is the value — listing every advisory is what you already ignore.
- **Morning error triage.** Read overnight errors, group them, and say which ones deserve attention. A dashboard counts them; this one interprets them.
- **CI flake triage.** Read the day's failed runs, group by cause, name the tests that failed for reasons unrelated to the change. A week of this gives you a ranked flake list instead of a feeling.
- **Docs drift.** Compare the docs against the code and open a PR for what diverged — renamed flags, examples that no longer run. Nobody wants this job; an agent never gets bored of it.
- **A digest with your taste in it.** Read the sources you chose and keep only what touches what you are working on now. The filter is what makes it different from an RSS reader.

```bash
claude-jobs init dep-triage --skill ~/playbooks/deps.md --at 02:30 \
  --workdir ~/src/api \
  --precheck 'git -C ~/src/api fetch --quiet' \
  --notify 'gh issue comment 42 --body "$CLAUDE_JOB_MESSAGE"'
```

More ideas — release notes, issue triage, cost anomalies, backup verification, competitor watch — plus the jobs that are a bad fit and why: [docs/use-case-ideas.md](docs/use-case-ideas.md).

## What a job looks like on disk

```
~/.claude-jobs/
├── jobs/<name>/job.json      # the declaration
├── jobs/<name>/prompt.md     # what the agent is told — edit this freely
├── jobs/<name>/run.sh        # generated runner, yours to modify
├── logs/<name>.log           # stream-json, every step as it happens
└── state/<name>-summary.md   # the agent's own report, written last
```

Nothing is hidden in a database. Delete the directory and the job is gone.

## The decisions baked into the runner

These are the parts that are easy to get wrong once and then debug for a week:

- **Explicit environment.** Schedulers do not load your shell profile. `PATH`, `HOME` and the absolute path to `claude` are written into the script.
- **The prompt is a pointer.** It names a skill or runbook file rather than embedding the logic, so behaviour changes without touching the scheduler.
- **Unattended means unattended.** The prompt tells the agent never to wait for an answer, and to park human decisions in writing instead of blocking.
- **`--permission-mode bypassPermissions`.** A headless run cannot approve anything. Override with `--permission-mode` if you want a stricter mode.
- **`--output-format stream-json --verbose`.** Steps land in the log as they happen instead of buffering until the end.
- **Preconditions before spending a session.** `--precheck` runs a cheap command first; if it fails, the run is skipped and reported rather than started into a broken environment.
- **Random start jitter.** Firing at the same second every day is a machine rhythm, and staggering also keeps several jobs off the same usage-limit cliff.
- **Delivery is separate from logging.** The agent writes a summary file as its last step; the runner delivers that file through `--notify`. No summary means the run is reported as failed, with the exit code.
- **State lives in files.** Each run is a fresh process; continuity comes from whatever the skill writes down.

Details and the reasoning behind each one: [docs/design.md](docs/design.md).

## Beyond a laptop

The same "subscription instead of API key" idea shows up in a few officially supported places — GitHub Actions with `claude_code_oauth_token`, the Agent SDK authenticating as your account, and chat gateways that execute turns through the local CLI. Where each one fits, and where the line is: [docs/use-cases.md](docs/use-cases.md).

### Answering a chat message instead of a schedule

A scheduled job and a chat bot are the same substrate with a different trigger. [OpenClaw](https://docs.openclaw.ai) is a self-hosted gateway that connects Zalo, Telegram, Slack and friends to an agent, and it can run every turn through your logged-in CLI — no API key in the config at all:

```json
{
  "agents": {
    "defaults": {
      "model": { "primary": "claude-cli/claude-sonnet-5" },
      "cliBackends": { "claude-cli": { "command": "/opt/homebrew/bin/claude" } },
      "agentRuntime": { "id": "claude-cli" }
    }
  }
}
```

A ready-to-run script that merges this into an existing gateway config, with a backup and a dry run, is in [examples/openclaw/](examples/openclaw/):

```bash
node examples/openclaw/apply-claude-cli-backend.mjs            # show the diff
node examples/openclaw/apply-claude-cli-backend.mjs --write    # apply it
```

The full walkthrough — how a turn executes, why the model list must not contain a direct-API model, and what a long-running gateway does differently from a one-shot job — is in [docs/openclaw.md](docs/openclaw.md).

Run both and you cover the two halves: the gateway answers when someone asks, `claude-jobs` acts when nobody does.

## Do you need this?

Often not. Claude Code ships three ways to schedule work, and they cover most of what people reach for a wrapper script to do. Checked against the docs on 2026-08-18:

| Option | Runs on | Needs | Reach for it when |
|---|---|---|---|
| [Routines](https://code.claude.com/docs/en/routines) | Anthropic's cloud | Nothing of yours running | The work must happen whether or not your machine is on, or a GitHub event / API call is the trigger |
| [Desktop scheduled tasks](https://code.claude.com/docs/en/desktop-scheduled-tasks) | Your machine | Claude Code Desktop open, computer awake | You want local files plus a UI: run history, a notification per fire, and a permission prompt you can answer later |
| [`/loop`](https://code.claude.com/docs/en/scheduled-tasks) | Your machine | An open session | Polling something for the next few minutes or hours, inside the session you are already in |
| `claude-jobs` (this repo) | Your machine | An OS scheduler and a valid CLI login | The schedule has to be an OS-level unit and the outcome has to leave the machine on its own |

The differences that actually decide it:

- **Cloud routines clone your repo fresh.** No uncommitted work, no local database, no file outside the repo, no tool that only exists on your laptop. That rules out a whole class of jobs, and rules *in* every job that should survive a closed lid.
- **A Desktop task fires only while the app is open and the machine is awake**, and it can stall mid-run waiting for a permission you have not granted yet. Both are fine at a desk. Neither is fine on a box you SSH into.
- **`claude-jobs` has no UI at all**, and that is the point: the schedule is a launchd/systemd/cron unit, the job is three files you can read and commit, and `--notify` hands the agent's summary to any command — `mail`, `gh issue comment`, a Slack webhook — so the result reaches you without a screen to look at.
- **Routines draw on the same subscription** and are capped per day by plan (5 on Pro, 15 on Max, 25 on Team/Enterprise at the time of writing). Jobs here are capped by nothing but your own usage limits, because they are ordinary CLI sessions.

If your job is "review yesterday's commits at 9am and tell me", start with a Desktop task — it is one form, it keeps its own history, and nothing here beats it. Come back when the job needs to run under an OS scheduler, report through a command, or live in version control next to the code it reads.

### What the third bullet looks like when it fires

A job installed from the published package, scheduled at a fixed minute, delivering through `gh gist create`:

```bash
claude-jobs init ci-watch --at 09:40 --jitter 0 \
  --task 'read the latest CI conclusion on main and the count of open external PRs for five repos, report one line each' \
  --notify 'printf "%s\n" "$CLAUDE_JOB_MESSAGE" | gh gist create -p -f ci-watch.md -'
claude-jobs install ci-watch
```

launchd fired it with nobody at the keyboard, and the log of that run reads:

```
[2026-08-18 09:40:05] === session start ===
[2026-08-18 09:41:00] === session end, exit=0 ===
✓ Created public gist ci-watch.md
https://gist.github.com/vinhnguyenthanhdn/09b7430e84ddf0fdc31acf3c578ed4b5
```

The [gist](https://gist.github.com/vinhnguyenthanhdn/09b7430e84ddf0fdc31acf3c578ed4b5) is the whole point: 55 seconds after the unit fired, the agent's report was readable by someone who has no access to that machine. What this does *not* show is a host nobody has ever logged into — the run used the CLI login of the user who installed it, which is the dependency named under Limitations.

## Limitations

- **One daily time per job.** `--at` takes `HH:MM` and schedules that job once a day. Several times a day, weekdays only, or a full cron expression means several jobs, or editing the generated scheduler unit by hand.
- **No retries and no catch-up.** A failed run is reported, not repeated, and a run whose scheduled minute passed while the machine was asleep or off is handled by whatever the scheduler does — this tool adds no logic of its own on top.
- **macOS, Linux, and any Unix with cron.** The scheduler is launchd on macOS, systemd user timers on Linux, and cron where either is missing. Windows Task Scheduler is not supported.
- **The login is the dependency.** Jobs run through the Claude Code CLI as the user who installed them, so the machine needs an interactive login that is still valid. There is no API-key path by design, and no way to run this on a host nobody has ever logged into. `claude-jobs doctor` checks that before a schedule silently starts failing.
- **`bypassPermissions` by default.** An unattended run cannot approve a tool call, so it starts with permissions bypassed in the working directory given to it. That is a trust decision about that directory, not a detail — `--permission-mode` makes it stricter.
- **The agent's report is the only outcome.** Delivery is driven by the summary file the agent writes last. A run that ends without one is reported as failed, even if useful work happened before it stopped.
- **One log per job, rotated once.** Every run appends to `~/.claude-jobs/logs/<name>.log`, and the session is written there in `stream-json`, so a single short run is tens of kilobytes. At the start of a run the runner moves the log to `<name>.log.1` if it has reached **5 MiB** (`--log-max-bytes`, default `5242880`), replacing any older `.1`. That bounds a job at two files and keeps the previous run available for a post-mortem; it is not a full log-rotation policy, and nothing prunes the `.1`. `--log-max-bytes 0` turns rotation off and restores append-forever behaviour. The value is written into the generated runner as `LOG_MAX_BYTES`, so an existing job can be changed by editing its `run.sh` rather than re-creating it.

## Related tools

Two separate concerns around the same CLI; either works on its own.

| Tool | What it does |
|---|---|
| `claude-jobs` (this repo) | Runs Claude Code on a schedule, unattended, and reports the outcome |
| [`claude-router`](https://github.com/vinhnguyenthanhdn/claude-router) | Points Claude Code at a 9Router provider instead of Anthropic, per process in the terminal or per machine in VSCode (Windows) |

## Contributing

Issues and PRs are welcome — especially scheduler support beyond launchd/systemd/cron, notifier recipes, and prompt templates that survive real unattended use. Start with [CONTRIBUTING.md](CONTRIBUTING.md).

If this saved you an afternoon, a ⭐ helps other people find it.

## License

MIT
