# 01 Dashboard Shell

Type: `layout-study`

Purpose:

- translate the dashboard reference analysis into a first Stitchly contained-shell study
- establish the broad dashboard composition before going deep on data-table detail
- create a shared dashboard stylesheet foundation for later runs, analytics, and settings studies

What this sample is testing:

- large rounded outer shell
- narrow left sidebar versus wide data surface balance
- dark adaptation of the calm, low-noise dashboard tone
- broad placement of title, filter row, KPI strip, and data area
- whether Stitchly can support a contained dashboard shell distinct from canvas mode

Reference direction:

- the supplied light `Runs & Logs` dashboard reference

What this sample intentionally includes:

- Stitchly-contained outer shell
- left sidebar with active navigation, alert tile, and profile area
- top toolbar and section title
- compact filter/action row
- KPI strip
- placeholder operations table
- floating `Actions` pill

What this sample intentionally does not solve yet:

- final table density and column behavior
- final KPI copy and metric logic
- final notification-card content strategy
- mobile-first dashboard behavior
- exact iconography for nav and status states

Shared styling:

- this sample uses `../shared.css`
- the stylesheet should become the dashboard-shell foundation for later shell, table, and sidebar studies

Review questions:

- does the contained shell feel calm and premium enough in dark mode?
- is the sidebar too heavy or about right?
- does the KPI strip feel better inline than as separate cards?
- does the shell feel like a strong non-canvas companion to Stitchly’s immersive editor mode?
