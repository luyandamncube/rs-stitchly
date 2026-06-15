# 01 Run Detail Submenu

Purpose:

- explore the selected-run detail state inside the existing runs-history popup
- keep the visual language close to `00_runs_window`
- test whether run facts, node states, events, and logs can fit without the current production detail feeling like a generic drawer stack

Included in this study:

- same left rail and popup shell as the runs-history table
- back affordance to return to the run list
- compact run summary with status, workflow, duration, errors, and retries
- failure callout and operator actions
- three-column detail body for facts/node states, event timeline, and logs
- scrollable dense lists intended to map back to persisted run detail data

What to review:

- whether the detail view still feels like a submenu of `Runs & Logs`
- whether events and logs should be side-by-side or stacked
- whether the failure/action rail is too prominent
- which parts should graduate into the production `CanvasRunsHistoryPanel`
