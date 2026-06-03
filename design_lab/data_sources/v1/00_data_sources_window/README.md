# 00 Data Sources Window

Purpose:

- explore a first canvas-popup data browser for local ETL and ELT work
- adapt the existing Stitchly rail popup language to workspace DuckDB browsing
- test whether one window can handle both source selection and sink selection without feeling confused

Included in this study:

- left menu rail with an active `Data` item
- popup window anchored to the rail
- `Data Sources` header with attach-db and create-sink actions
- filter chips for source/sink intent and object type
- workspace context cards tied to the selected canvas node
- three-column layout with a catalog rail for databases and schemas
- object browser for tables and views
- inspector with preview and node actions

What to review:

- whether `Data` should live with the top utility items in the rail
- whether the three-column layout feels powerful or too heavy
- whether source and sink actions can share one inspector cleanly
- whether the selected-table preview is useful enough to justify the space
