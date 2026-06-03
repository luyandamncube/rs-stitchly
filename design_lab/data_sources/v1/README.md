# Data Sources Lab v1

This folder holds the first design pass for Stitchly data-source popup surfaces.

Source inputs:

- [apps/web/src/App.jsx](/home/mncubel/rs-stitchly/apps/web/src/App.jsx)
- [crates/runtime_server/src/platform.rs](/home/mncubel/rs-stitchly/crates/runtime_server/src/platform.rs)
- the canvas menu / popup language already explored in `design_lab/menu/`
- the analytical popup structure explored in `design_lab/runs_history/`
- the utility popup simplification explored in `design_lab/integrations/`

Current studies:

- `00_data_sources_window/`
  First pass for a canvas-triggered data browser with workspace DuckDB catalogs, object lists, and source/sink actions.
- `01_catalog_tree/`
  Focused split-layout study for a Databricks-inspired catalog tree on the left and a Stitchly object explorer on the right.
- `02_catalog_overview/`
  Catalog-grain explorer study with the same left tree and a Databricks-inspired Overview surface on the right.
- `03_table_overview/`
  Table-grain explorer study with a deeper breadcrumb and an Overview tab focused on columns, types, and descriptions.
- `04_sample_data/`
  Table-grain explorer study with the `Sample Data` tab active and a preview grid for table rows.
- `05_sql_editor/`
  SQL-editor variation of the table explorer with a lightweight query surface above the result grid.

Goals for this pass:

- keep the popup language close to the existing canvas windows
- make the workspace DuckDB feel like the default local data home
- let one browser support both `Table Input` and `Table Output` flows
- test whether a three-column catalog, list, and inspector layout is the right density
