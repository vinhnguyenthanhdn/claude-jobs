# Changelog

All notable changes to this project are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [SemVer](https://semver.org/).

## [Unreleased]

### Added

- A `scope-guard` CI job (`scripts/scope-guard.mjs`): a pull request that removes an export
  from `src/` fails unless the description names that export. `src/index.js` is what
  `npm install claude-jobs` resolves to, so a removal there breaks installed code, and the
  rule was previously only prose. The scanner is covered by tests, including one that pins
  the current public surface of `src/index.js`.

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
