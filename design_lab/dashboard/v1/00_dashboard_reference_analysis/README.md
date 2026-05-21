# 00 Dashboard Reference Analysis

Type: `reference-analysis`

Purpose:

- analyze the provided dashboard reference before adapting it for Stitchly
- identify the layout, spacing, typography, and data-display rules that make it feel clean and calm
- separate what should be preserved from what should be replaced with Stitchly-specific product needs

What this study is analyzing:

- overall application shell composition
- sidebar navigation structure
- top utility actions
- filter bar behavior
- KPI summary strip
- dense table design
- supporting notification and action surfaces

Reference direction:

- the supplied light dashboard showing a `Runs & Logs` view with left navigation, summary metrics, filters, and a large data table

What we see in the reference:

- a large rounded dashboard shell floating on a light neutral background
- a narrow left navigation rail/sidebar
- a main content area with a title, filters, summary metrics, and a table
- a soft visual hierarchy built mostly with spacing, not hard borders
- a calm analytics/productivity tone rather than a flashy SaaS style

Layout observations:

- the shell is a two-panel composition:
  - left sidebar
  - right content area
- the sidebar is narrow and mostly vertical
- the right side is wide and optimized for data density
- the whole product surface lives inside one large rounded outer frame
- there is very little decorative chrome outside that main frame

Shell observations:

- the outer shell has a very large radius
- the background behind it is intentionally empty and neutral
- the app feels inset and self-contained rather than edge-to-edge
- the internal surfaces remain soft and mostly monochrome

Sidebar observations:

- the sidebar is minimal and icon-supported
- items are vertically spaced with lots of breathing room
- one item is active with a stronger weight and a left-side marker
- the lower portion contains utility/support items rather than primary nav
- there is a dedicated notification or alert card embedded near the lower-middle of the sidebar
- a user/profile area sits at the bottom

Main content observations:

- the page title area is compact, not oversized
- the top row balances section title, export action, and search
- controls are arranged horizontally and stay very close to the data they affect
- the content hierarchy is:
  1. section title
  2. filters and search
  3. KPI strip
  4. table

Typography observations:

- the dashboard uses a clean neutral sans
- type is much smaller and denser than the login reference
- most hierarchy comes from weight differences, not dramatic size jumps
- labels are muted gray
- values are darker/stronger
- status colors are minimal and functional

Spacing observations:

- the design is spacious overall, but compact within data surfaces
- the sidebar uses generous vertical spacing
- filter chips have tight internal padding and small inter-chip gaps
- KPI blocks are packed into a single horizontal strip
- table rows are dense but not cramped
- whitespace is used to avoid visual noise, not to create drama

Shape-language observations:

- very large rounded outer shell
- smaller rounded pills for filters and actions
- rounded search field
- soft table container with low-contrast separation
- notification tile in the sidebar with rounded corners
- floating bottom-right action pill

Color observations:

- the reference is light and nearly monochrome
- neutrals carry most of the interface
- emphasis comes from:
  - black/dark text
  - muted gray labels
  - soft gray surfaces
  - small functional status colors like green and orange/red
- there is no heavy use of brand accent in the base shell

Filter-bar observations:

- filters are pill-like and grouped in a single horizontal row
- some are categorical chips: `All`, `Success`, `Failed`
- some are scope or dimension selectors: `Workflows`
- some are time selectors: `Last 24h`
- there is a `More filters` affordance instead of exposing everything at once
- the search field is pushed to the right and visually quieter

KPI-strip observations:

- KPI values sit in a single summary row above the table
- each metric block contains:
  - a label
  - a large value
  - sometimes a tiny delta or status indicator
- the metrics are not boxed as separate cards
- they feel like a compact dashboard strip rather than four standalone widgets

Table observations:

- the table is the main feature of the screen
- it includes:
  - checkbox column
  - run id
  - start time
  - workflow name
  - duration
  - status
  - error
  - retries/errors count
- row separators are low-contrast and subtle
- statuses use small icon-plus-text treatments
- error states are inline, not shown as huge banners
- table density is practical and operations-focused

Notification observations:

- the sidebar notification card is small but prominent
- it uses a slightly warmer accent to draw attention
- it looks like a compact system alert rather than a marketing card
- the red badge count below it creates a second-layer urgency signal

Floating-action observations:

- there is a small bottom-right floating pill labeled `Actions`
- this creates a secondary utility anchor outside the main table flow
- it feels contextual and low-noise

What Stitchly should preserve:

- the large rounded contained shell
- calm, minimal application tone
- narrow utility-oriented sidebar
- compact filter row above data
- KPI strip as a lightweight summary rather than a pile of cards
- dense, readable operations table
- restrained use of status color

What Stitchly should replace:

- light monochrome palette -> our dark `True Black + Lava Core` palette
- generic business dashboard wording -> Stitchly workflow/editor/product language
- runs/logs business sample data -> Stitchly runs, workflows, agents, and node state data
- static notification copy -> workflow-aware alerts and execution problems

Practical product considerations:

- this shell is a strong candidate for non-canvas product areas like:
  - runs
  - workflow list
  - templates
  - analytics
  - settings
- the table-first content model fits Stitchly particularly well for run history and execution inspection
- the sidebar pattern is calmer than the current canvas-first floating shell, so we may want separate shell modes:
  - immersive canvas mode
  - contained dashboard mode
- the light reference uses color very sparingly, which means our lava accent should remain rare and precise in the dark adaptation

Recommended next dashboard lab studies:

- `01_dashboard_shell`
  Outer frame, sidebar, and broad content composition.
- `02_dashboard_table`
  KPI strip, filter bar, and operational data table.
- `03_dashboard_sidebar`
  Navigation, notifications, profile, and utility areas.
- `04_dashboard_mobile`
  Narrow-layout reinterpretation or compressed admin view.

Still unresolved:

- whether Stitchly keeps a dedicated contained dashboard shell separate from the canvas shell
- how dark adaptation should treat the large white negative space of the reference
- whether KPI strips stay inline or become more card-like in dark mode
- how much of the sidebar utility pattern survives on mobile

Review questions:

- does this analysis capture the real structural drivers of the reference?
- should Stitchly preserve the contained outer shell pattern?
- does the KPI-strip approach feel better than standalone analytics cards?
- should the canvas and dashboard live in two distinct shell families?
