# 05 Dashboard Mobile

Type: `mobile-dashboard-study`

Purpose:

- define a phone-first dashboard mode for Stitchly instead of relying on desktop shell collapse
- test whether the contained dashboard language can survive on mobile with its own spacing and hierarchy
- establish a mobile pattern for runs, KPIs, filters, and bottom navigation

What this sample is testing:

- centered phone-frame presentation
- compact mobile header and hero
- horizontal filter chips
- reduced KPI cards instead of a long desktop strip
- run list cards instead of a dense table
- bottom navigation for primary dashboard destinations

What this sample intentionally includes:

- mobile dashboard frame
- top brand/header area
- hero summary
- compact KPI cards
- recent runs list with mixed states
- bottom nav

What this sample intentionally does not solve yet:

- real mobile search and filter expansion behavior
- swipe gestures
- row detail expansion
- account/profile drawer behavior
- tablet-specific dashboard mode

Shared styling:

- this sample uses `../shared.css`
- mobile-dashboard helpers are appended to the shared stylesheet rather than using a local override file

Review questions:

- does this feel like a real mobile dashboard rather than a shrunken desktop page?
- should mobile runs use cards like this, or a denser list row treatment?
- are the KPI cards the right choice on mobile, or should the summary be even lighter?
- does the bottom nav feel right for Stitchly dashboard mode?
