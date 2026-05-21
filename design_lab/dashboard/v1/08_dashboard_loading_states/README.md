# 08 Dashboard Loading States

Type: `loading-state-study`

Purpose:

- define how the dashboard should behave while data is still loading or refreshing
- test whether Stitchly needs separate loading tones for first load versus partial updates
- establish calm skeleton and refresh patterns that fit the contained shell language

What this sample is testing:

- full dashboard skeleton rhythm
- partial KPI/table refresh
- supporting right-rail loading note and metrics
- how much shimmer and placeholder structure the shell can carry without feeling noisy

What this sample intentionally includes:

- same contained shell as the other studies
- loading topbar, filters, KPI strip, and table
- supporting refresh-status side panel
- subtle shimmer placeholders instead of hard-edged wireframes

What this sample intentionally does not solve yet:

- true data-fetch timing behavior
- optimistic updates
- live partial row insertion
- mobile loading state treatment
- accessibility motion preferences

Shared styling:

- this sample uses `../shared.css`
- loading-state helpers are appended to the shared stylesheet rather than using a local override file

Review questions:

- does this feel calm enough for Stitchly’s dashboard tone?
- are the skeletons too heavy, too light, or about right?
- should first-load and partial-refresh states be more visually distinct?
- is the right-side refresh note useful, or does it over-explain loading?
