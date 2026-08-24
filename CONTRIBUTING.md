# Contributing

Thanks for looking. This project is small on purpose, and the bar for a change is simply: does it make an unattended run more likely to succeed, or easier to debug when it does not?

## Getting set up

```bash
git clone https://github.com/vinhnguyenthanhdn/claude-jobs
cd claude-jobs
npm test          # no dependencies to install — Node's built-in test runner
npm run check     # the syntax gate CI runs; every tracked .js and .mjs must parse
node bin/claude-jobs.js help
```

Both commands run in CI on every push, so a green pair here is a green pair there. `npm test` alone is not enough: `npm run check` is the gate a newly added script trips first, and it is discovered from `git ls-files` rather than a list, so a file added today is covered today.

Try your change end to end without touching your real jobs:

```bash
CLAUDE_JOBS_HOME=/tmp/cj-scratch node bin/claude-jobs.js init demo --task "say hi" --jitter 0
CLAUDE_JOBS_HOME=/tmp/cj-scratch node bin/claude-jobs.js run demo --dry-run
```

`CLAUDE_JOBS_HOME` relocates all state; `CLAUDE_JOBS_SCHEDULER` forces a scheduler. Both exist so tests and experiments never write to a real crontab or LaunchAgents directory.

## Ground rules for the code

- **No runtime dependencies.** This runs unattended on other people's machines; a supply chain is a liability here. Dev-only tooling is fine to discuss in an issue first.
- **Node 18.17+, ESM, no build step.** What you read is what ships.
- **Generated scripts are readable.** Someone will open `run.sh` at 3am. Keep the comments that explain *why* a line exists.
- **Fail at generation time, not at runtime.** An unknown template placeholder or a malformed time should throw during `init`, not silently produce a broken unit.
- **Never touch credentials.** The CLI owns its own auth. This package must not read, store or forward tokens.
- **Stay inside the change you are describing.** `src/index.js` is what `npm install claude-jobs` resolves to, so removing an export from `src/` breaks somebody's script. You may still do it — but the PR description has to name each export that goes away and say why. CI enforces this: the `scope-guard` job compares the exports of every changed `src/*.js` between the base and your branch and fails on a removal the description does not mention. Rewriting a file wholesale usually trips it, and that is the intent.

## Especially welcome

- Scheduler backends beyond launchd, systemd and cron (Task Scheduler, Kubernetes CronJob, …).
- Notifier recipes in `examples/` — chat platforms, webhooks, desktop notifications.
- Prompt templates that have survived real unattended use, with a note on what failure they prevent.
- Documentation fixes, especially anything that was wrong or has changed.

## Ways to contribute that aren't code

This package generates files that then run unattended on machines nobody here can see. Reports from those machines are the scarce thing, not patches:

- **Tell us what a generated unit did on your platform.** `launchd.plist`, the systemd pair and the crontab line are rendered from templates; only the cron path is exercised on the maintainer's machine. A paste of the unit your install produced, plus what the scheduler said about it, is a bug report nobody else can write.
- **Report a job that ran but did the wrong thing.** Empty `PATH` under cron, a login session that had expired, a summary that never arrived — the failure modes worth fixing are the ones that only appear at 3am on a machine in another timezone.
- **Reproduce an open issue, or say that you could not.** Both outcomes move it; "not reproducible on Node 22 / macOS 15" is a result.
- **Review an open pull request**, especially one that changes a template. A rendered file that looks right and is rejected by the scheduler is the expensive kind of mistake.

`CHANGELOG.md` credits the person whose report or review caused a change, not only whoever wrote the commit.

## Pull requests

1. One change per PR, with a title that says what it does.
2. `npm test` passes, and new behaviour comes with a test.
3. If the change alters a generated file, paste a before/after of the relevant lines in the description.
4. Anything a user of the CLI would notice gets a line under `## [Unreleased]` in
   [`CHANGELOG.md`](CHANGELOG.md). Write what it means for someone running a job, not the file
   names. Pure refactors, typo fixes and internal test additions do not need one.
5. Describe the failure mode it fixes. "Fixes the empty PATH under cron" is a better PR body than "improves reliability".

Behaviour is covered by the [Code of Conduct](CODE_OF_CONDUCT.md).
