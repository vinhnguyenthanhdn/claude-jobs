# Changelog

All notable changes to this project are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [SemVer](https://semver.org/).

## [Unreleased]

### Fixed

- `run`, `install`, `uninstall`, `logs` and `status` say what is missing when you leave the
  job name off. They used to pass `undefined` into path construction, so the CLI answered a
  question about arguments with a Node type error about the `path` argument. Thanks to
  @emre155 (#14).
- `init` refuses flag values it cannot use, before it writes anything. `--jitter abc` used to
  reach the generated runner as `JITTER=NaN`, `--jitter` with no value silently became `1`
  where the documented default is `900`, and `--skill ./missing.md` scheduled a job to read a
  file that does not exist — all three reported `Created job` and exited 0, so the failure
  surfaced days later in a run log. A rejected `init` now leaves no job directory behind.
  Thanks to @emre155 (#15).
- Every `init` flag documented as taking a value is rejected by name when the value is
  missing. #15 covered three of them; the parser still turned the other ten into the boolean
  `true`, and six of those exited 0 — `--claude` with no value produced a job whose Claude
  binary was `/usr/bin/true`, which the runner's "binary not found" guard accepts, so every
  scheduled session ran that and logged `exit=0` with no summary. `--scheduler` was checked
  after the job had been written, leaving a half-job that took `claude-jobs list` down for
  every job sorted after it. The scheduler name is now validated before the first write.
  Thanks to @rigel08 (#16).
- `uninstall --purge` now deletes the log and the last summary along with the job directory,
  not just the directory. `claude-jobs list` stops showing the job the moment it's gone, and
  `logs`/`status` both start with a lookup that throws for a name with no `job.json` — so the
  leftover log (often the largest of the three files) and summary became unreachable through
  the CLI, and a later `init` with the same name silently resumed appending to the old job's
  log. Purge is a no-op, not an error, for a file that was never created. Thanks to
  @vinhnguyenthanhdn (#22).
- `init` renders the prompt template before it writes anything. A `--prompt-file` holding a
  placeholder the renderer has no value for used to fail *between* the first write and the
  last, leaving a `job.json` with no `prompt.md` and no `run.sh` — a name taken by a job that
  cannot run, which `list` and `status` both reported as ordinary and exited 0 on. Under
  `--force` it was worse: the new `job.json` landed beside the old `prompt.md`, so the
  recorded task and the prompt disagreed. Rendering output for every valid invocation is
  unchanged. Thanks to @dchaudhari7177 (#19).

### Added

- The job log is rotated on size. Nothing used to trim it: the runner appends, the scheduler
  points `StandardOutPath` at the same file, and the session itself is written there in
  `stream-json`, so a single 55-second run with one tool call cost 32 KB and a daily job grew
  forever. At the start of a run the runner now moves the log to `<name>.log.1` once it has
  reached `--log-max-bytes` (default 5 MiB), replacing any older `.1` — one generation, so a
  job is bounded at two files and the previous run is still readable. `0` restores the old
  behaviour exactly. The cap is rendered into the generated runner beside `JITTER`, so an
  existing job is changed by editing its `run.sh`. Thanks to @dchaudhari7177 (#21).
- A `scope-guard` CI job (`scripts/scope-guard.mjs`): a pull request that removes an export
  from `src/` fails unless the description names that export. `src/index.js` is what
  `npm install claude-jobs` resolves to, so a removal there breaks installed code, and the
  rule was previously only prose. The scanner is covered by tests, including one that pins
  the current public surface of `src/index.js`.
- A `Do you need this?` section in the README comparing this tool with the three schedulers
  Claude Code now ships — cloud Routines, Desktop scheduled tasks and `/loop` — and saying
  plainly which jobs belong to each. The README previously described the gap this tool fills
  without mentioning that first-party answers to part of it exist.
- A test that ties the `package.json` version to the newest released heading in this file.
  Both are read as "the shipped version" — one by `npm install` and `claude-jobs --version`,
  the other by anyone reading the changelog — and nothing compared them, so a release could
  move one and leave the other behind with the suite still green.
- The README claim that a scheduled run reaches you without a screen is now shown as a run
  instead of asserted: the `init`/`install` pair, the log lines of a launchd fire, and the
  public gist the `--notify` command produced 55 seconds later. The paragraph also names
  what that run does not prove — the machine still needs a user with a valid CLI login.

## [0.1.5] — 2026-08-17

### Fixed

- Cron marker matching is exact: uninstalling `alpha` no longer removes `alpha-2`, and a
  marker followed by trailing spaces or tabs is still found. Thanks to @lakshanmuruganandam
  (#3) and @floze-the-genius (#5).
- `uninstall` leaves the rest of your crontab byte-identical. It used to collapse any run of
  blank lines anywhere in the file — including between your own unrelated sections — and it
  did so even when there was no job to remove. Thanks to @alexsmolya (#7).

### Changed

- The publish workflow reports why it did not publish: a release tag that disagrees with
  `package.json` is refused, a version already on the registry finishes without republishing,
  and a missing `NPM_TOKEN` fails on the first step naming the cause instead of after pack.
- The package no longer declares a `chatbot` keyword. claude-jobs schedules the Claude Code
  CLI; it does not implement a chat interface, so the keyword only put the package in
  searches where it was the wrong answer.

### Added

- The scheduler templates are covered by tests. `launchd.plist`, `systemd.service` and
  `systemd.timer` had never been rendered by the suite, so a typo in any of them would have
  shipped green and only failed on someone's machine at install time. Thanks to
  @kragent66-glitch (#9).
- README lists the related tool `claude-router`, so the two projects are reachable from each
  other.
- README has a `Limitations` section: one daily time per job, no retries and no catch-up,
  no Windows scheduler, the interactive login the jobs depend on, the default permission
  mode, and the fact that a run without a summary file is reported as failed.

## [0.1.4]

### Added

- README now names the five jobs that pay off fastest, with a worked command.
- `docs/use-case-ideas.md`: the longer list — release notes, issue triage, cost anomalies, backup verification, competitor watch, and the jobs that are a bad fit for a scheduled agent.

## [0.1.3]

### Added

- `examples/openclaw/`: a sample config fragment and an apply script that merges the CLI backend into an existing gateway config — dry run by default, timestamped backup, refuses to run when the CLI is not logged in, and drops direct-API model refs that would silently become a fallback.

### Changed

- Documentation examples now use Sonnet 5 / Opus 5 model refs.

## [0.1.2]

### Changed

- Surfaced the chat-gateway case on the front page: a self-hosted gateway can answer messages through the same logged-in CLI, with no key in its config. Same substrate as a scheduled job, different trigger.

## [0.1.1]

### Fixed

- `list` and `status` reported a job as installed as soon as it was scaffolded. `init` writes the unit file so it can be read before committing to it, which is not the same as the scheduler having accepted it — installed state is now read from `launchctl` / `systemctl` instead of from the file's existence.

### Added

- `claude-jobs --version`.

## [0.1.0]

Initial release.

- `init`, `list`, `run`, `install`, `uninstall`, `logs`, `status`, `doctor`.
- Scheduler backends: launchd, systemd user timers, cron.
- Generated runner with explicit environment, start jitter, precheck gate, streaming log, summary-file delivery and a notify hook.
- Prompt template written for unattended runs.
- Docs: design notes, subscription-vs-API-key use cases, gateway example, policy scope.
