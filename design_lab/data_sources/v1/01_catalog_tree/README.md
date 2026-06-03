# 01 Catalog Tree

Purpose:

- isolate a simpler catalog-tree-first data browsing pattern
- split the inside of the popup into a left tree and a right explorer
- borrow the clarity of the Databricks catalog browser while keeping Stitchly's darker canvas language

Included in this study:

- left menu rail with an active `Data` item
- popup window anchored to the rail
- left catalog tree pane with utility actions, search, and quick filters
- hierarchical database, schema, and object tree
- right catalog explorer focused on object details and grain

What to review:

- whether the left tree width feels right for long database and table names
- whether the Databricks-like search plus filter row fits the Stitchly popup language
- whether the right explorer is the right level of detail for grain and object metadata
- whether this split feels clearer than the earlier three-column concept
