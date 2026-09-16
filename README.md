# Journey Logger

A fast, local-first CLI for recording time spent on the things that matter.
There is no account, server, or runtime dependency: entries live in one JSON file in your
home folder (`~/.journey-logger.json`), so the same history follows the CLI from every directory.

## Install

```powershell
npm.cmd install
npm.cmd run journey -- --help
```

`npm.cmd` avoids PowerShell execution-policy issues on Windows. In Command Prompt,
macOS, or Linux, ordinary `npm` is equivalent.

For the shorter command everywhere, link this local project once:

```powershell
npm.cmd link
```

In PowerShell with script execution disabled, invoke it as `journey.cmd`. In
Command Prompt, macOS, and Linux, use `journey`.

## Use

Set up activities once, then log minutes in one short command:

```powershell
npm.cmd run journey -- activity add Writing --color blue
npm.cmd run journey -- activity add Running --color green
npm.cmd run journey -- log Writing 45
npm.cmd run journey -- log Running 30 2026-09-12
```

`journey log <activity> <minutes> [date]` uses today's date when it is omitted.
Activity matching is case-insensitive, so `writing` and `Writing` are the same.
The date accepts `YYYY-MM-DD`, `today`, or `yesterday`.

### Import a legacy CSV

For the headerless format exported by the original Journey Log (`M/D/YYYY,minutes,...`):

```powershell
journey.cmd import csv ..\japanese\immersion.csv --activity "Japanese immersion"
```

Imports append entries, so run this once per file.

Useful views:

```powershell
journey.cmd dashboard           # all-time cumulative trend, recent activity, heatmap
journey.cmd dashboard --days 30 # recent daily and cumulative trend
journey.cmd history             # recent individual entries
journey.cmd activities          # activities and totals
journey.cmd heatmap --weeks 26  # GitHub-style contribution grid
journey.cmd trend --days 60     # daily and cumulative chart
journey.cmd config path         # see where the data file lives
```

To keep data elsewhere, set `JOURNEY_LOGGER_FILE` to an absolute file path.

## Data

The data file is deliberately plain JSON. This makes it easy to back up, inspect,
or move. A write is atomic, so an interrupted save will not normally corrupt the
existing file.
