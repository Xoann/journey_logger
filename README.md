# Journey Logger

A fast, local-first terminal app and CLI for recording progress on the things that matter.
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

## Terminal app

Run `journey.cmd` or `journey.cmd app` to open the full-screen app, like JP Flash.
From this folder, `npm.cmd run app` also works. A standard 80×24 terminal is supported;
a larger window (roughly 110×36) gives the charts more room. No packages or server are needed.

The app uses the same data file as the commands and refreshes when another terminal logs progress.
Opening it does not alter your history.
The header always shows the selected journey's **today total / goal**, with the amount
left or **Goal met!** The footer shows which date counts as today and the reset time.

| View | What it shows |
| --- | --- |
| Overview | Period total, averages, active days, goal achievement, lifetime total, current and longest goal streaks |
| Trends | Overall cumulative curve or daily bars, historical goals, and a separate cumulative graph by category |
| Calendar | Activity heatmap with goal markers and monthly totals |
| History | All logs and their categories; add, edit, reclassify, or delete individual entries |
| Settings | Journey name, goals and goal history, categories and hex colours, measurement, CSV import, and deletion |

| Key | Action |
| --- | --- |
| `1`–`5` or `Tab` / `Shift+Tab` | Switch views |
| `[` / `]` | Switch journeys (`Up` / `Down` also works outside History) |
| `R` | Cycle 7, 30, 90, 365 days, and all time |
| `L` / `N` / `S` / `I` | Log progress / new journey / settings / import CSV |
| `C` in Trends | Toggle cumulative and daily graphs |
| `B` in Trends | Toggle the cumulative category graph; `Up` / `Down` selects a category |
| `Left` / `Right` in Trends | Inspect a day; hold Shift to move a week; Home/End jumps to the edges |
| `Up` / `Down`, `Enter`, `D` in History | Select, edit, or delete a log; PageUp/PageDown moves ten entries |
| `E` / `H` / `C` / `D` in Settings | Edit settings / goal history / categories / delete the journey and its logs |
| `T` in Settings | Configure the day reset time for all journeys |
| `Q` or `Ctrl+C` | Quit |

Forms use `Tab` to move fields, `Left` / `Right` to change choices, and `Ctrl+U` to clear
a text field. `Enter` advances or saves on the last field; `Ctrl+S` saves immediately.
`Esc` cancels a form or confirmation. Deletions and CSV imports show a confirmation first.
CSV import accepts headerless `M/D/YYYY,amount,...` or `YYYY-MM-DD,amount,...` rows.

When adding or editing a log, the amount accepts simple arithmetic: `3*21+45` logs
108 minutes. Use `+`, `-`, `*`, `/`, decimals, spaces, and parentheses; multiplication
and division happen before addition and subtraction. The result must be positive
and finite. Only the calculated total is saved.

### Daily goal and day reset

Open **Settings → T** to choose a reset time in local, 24-hour `HH:MM` format.
This is shared by all journeys. The default for an unconfigured data file is `00:00`.
With `07:00`, Monday's tracking day runs from Monday at 7 a.m. until Tuesday at 7 a.m.,
so immersion after midnight still contributes to Monday's goal and streak.

The reset applies to automatically dated logs, `today`, `yesterday`, goal changes,
current streaks, and chart ranges. `--yesterday` means the day before the current
tracking day. Explicit `YYYY-MM-DD` dates and existing saved log dates stay as recorded.
The log form defaults to `today`, resolved when you save. The reset follows your
computer's local clock, including daylight-saving changes.

For a quick check without opening the app:

```powershell
journey.cmd today
journey.cmd today "Japanese immersion"
journey.cmd config day-reset 07:00
journey.cmd config day-reset       # show the current setting
```

### Categories within a journey

In **Settings, press `C`** to manage categories, such as Anime, Live action, YouTube,
and Podcasts for a Japanese journey. Press `N` to add a category, or select one with
the arrows and press `Enter` to rename it or change its colour. Colours accept
`#RRGGBB` or `#RGB`, for example `#7FAAF5` or `#ABC`.

When adding or editing a log, choose its **Category** with `Left` / `Right`.
Each log has one optional category. Existing logs, CSV imports, and logs without
a selection are **Unclassified**; you can assign them later in History.
Every category, including Unclassified, contributes its full amount to the journey's
overall totals, graphs, daily goals, and streaks. Categories do not weight time differently.

In **Trends, press `B`** for cumulative category curves in their configured colours.
`R` changes the date range, and `Left` / `Right` moves the date cursor. The legend shows
each category's cumulative total and share of the journey's total at that date, measured
from the beginning of the selected range. `Up` / `Down` selects a category, brings its
curve to the front, and scrolls the legend when needed. With `NO_COLOR`, the graph shows
the selected category's curve and keeps the numeric breakdown. Press `B` to return
to the overall graph.

Renaming or recolouring a category keeps all its logs together. In category settings,
press `A` to archive or restore a category. Archived categories remain in history and
graphs; they are hidden from new logs. Existing archived logs remain editable.
Categories are configured separately for each journey. `Esc` returns to Settings.

### How the numbers work

- Ranges end on the current tracking day, using your configured local reset time. Today counts even if it is still in progress.
- **Daily average** = total / all calendar days in the range, including zero days.
- **Active-day average** = total / days with a positive total. Zero when there are no active days.
- **Days active** = days with a positive total / all days in the range.
- **Goal achieved** = days whose combined logs meet that day's goal / days with a goal in the range.
  Days without a goal are excluded. Today counts if it has a goal, even while it is in progress.
- **Current streak** counts consecutive tracking days meeting their own goals. If today's goal
  is unfinished, yesterday's streak stays alive for the rest of today. A missed completed day
  breaks it. **Longest streak** is the longest such run across all history. Both are independent
  of the selected chart range. Days without a goal break a streak; old records remain counted.
- **All time** starts at the journey's earliest logged date and ends today. Future logs appear
  in History, but do not count as completed progress yet.
- Cumulative charts reset at the beginning of the selected range. Wide date ranges use
  labeled buckets: daily bars show each bucket's daily average; the curve shows its ending total.
  Daily goal lines follow the saved goals by date; for buckets, they show the average target
  only when every day in the bucket had a goal. The date cursor always reports the exact
  individual day's amount, goal, and whether it was met. Calendar shows the latest weeks
  that fit; monthly totals are limited to the selected range.

Goal changes take effect **today**, with one final goal per tracking day. Changing from
180 minutes to 120, then back to 180 later, keeps the 120-minute days as successes when
120 was their goal. Editing the goal again on the same day replaces that day's target.
Backdated logs, edits, and imports use the goal for the log's date.

For existing journeys, the previously saved goal remains the baseline for earlier days;
older goal changes that were never recorded cannot be reconstructed. New journeys start
their goal history on creation. In Settings, press `H` to see all changes, newest first;
use arrows, PageUp/PageDown, or Home/End to scroll, and `Esc` or `H` to return.

Journeys can measure **minutes, pages, words, reps, km, or sessions**. Existing journeys
default to minutes. Time totals use hours; daily amounts and goals use minutes.
Units cannot change after the first log, to avoid changing the meaning of historical data.
Create another journey for a different measurement. Renaming preserves all logs and their IDs.
Changing measurement before the first log starts a fresh goal history in the new unit.

## Quick commands

Set up activities once, then log minutes in one short command:

```powershell
npm.cmd run journey -- activity add Writing --color blue
npm.cmd run journey -- activity add Running --color green
npm.cmd run journey -- log Writing 45
npm.cmd run journey -- log Running 30 2026-09-12
```

`journey log <activity> <minutes> [date|--yesterday]` uses the current tracking day when the date is omitted. Use `--yesterday` for a quick backdated log.
Activity matching is case-insensitive, so `writing` and `Writing` are the same.
The date accepts `YYYY-MM-DD`, `today`, or `yesterday`.

Goals and other measurements also work from the CLI:

```powershell
journey.cmd activity set Writing --goal 60
journey.cmd activity add Reading --unit pages --goal 20
journey.cmd log Reading 25
journey.cmd activity set Reading --name Books --color green
journey.cmd activity set Books --goal none
journey.cmd activity goals Books
```

Categories also work from the CLI (quote hex colours, especially in PowerShell):

```powershell
journey.cmd category add "Japanese immersion" Anime --color "#7FAAF5"
journey.cmd category add "Japanese immersion" Podcasts --color "#C29DEB"
journey.cmd log "Japanese immersion" "3*21" --category Anime
journey.cmd log "Japanese immersion" 45 --yesterday --category Podcasts
journey.cmd categories "Japanese immersion"
journey.cmd category set "Japanese immersion" Anime --name Animation --color "#80CF97"
journey.cmd category archive "Japanese immersion" Animation
journey.cmd category restore "Japanese immersion" Animation
```

The amount is in the journey's configured unit; existing time commands still use minutes.
Expressions work here too; quote them so your shell passes them as one argument:

```powershell
journey.cmd log Japanese "3*21+45"
```

The original `trend`, `heatmap`, and `dashboard` commands show time journeys together.
Use the app for charts of other measurements, which are kept separate from time totals.

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
journey.cmd log undo 123        # remove one entry by its history ID
journey.cmd activities          # activities, totals, current and longest streaks
journey.cmd heatmap --weeks 26  # GitHub-style contribution grid
journey.cmd trend --days 60     # daily and cumulative chart
journey.cmd config path         # see where the data file lives
```

Each log receives a permanent numeric ID. `history` shows IDs for existing entries too,
so you can undo one entry even when several have the same activity, minutes, and date.
IDs are never reused after an undo.

To keep data elsewhere, set `JOURNEY_LOGGER_FILE` to an absolute file path.

## Data

The data file is deliberately plain JSON. This makes it easy to back up, inspect,
or move. A write is atomic, so an interrupted save will not normally corrupt the
existing file.
