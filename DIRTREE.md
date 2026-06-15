.
├── AGENTS.md
├── Cargo.lock
├── Cargo.toml
├── DIRTREE.md
├── Justfile
├── apps
│   └── web
│       ├── AGENTS.md
│       ├── env.local
│       ├── index.html
│       ├── package.json
│       ├── public
│       │   └── brand
│       │       └── symbol
│       ├── src
│       │   ├── App.jsx
│       │   ├── App.test.jsx
│       │   ├── components
│       │   │   ├── CanvasWorkspace.jsx
│       │   │   ├── CanvasWorkspace.test.jsx
│       │   │   ├── WorkflowCanvas.jsx
│       │   │   └── WorkflowCanvas.test.jsx
│       │   ├── lib
│       │   │   ├── api.js
│       │   │   ├── canvasDnD.js
│       │   │   ├── catalogSync.js
│       │   │   ├── nodeCard.js
│       │   │   ├── nodeCard.test.js
│       │   │   ├── runSync.js
│       │   │   ├── shell.js
│       │   │   ├── shell.test.js
│       │   │   ├── workflow.js
│       │   │   ├── workflow.test.js
│       │   │   ├── workflowTemplates.js
│       │   │   ├── workflowTemplates.test.js
│       │   │   └── workspaceConnectionsSync.js
│       │   ├── main.jsx
│       │   ├── styles.css
│       │   └── vitest.setup.js
│       ├── tsconfig.json
│       └── vite.config.js
├── crates
│   ├── AGENTS.md
│   ├── api_contract
│   │   ├── Cargo.toml
│   │   └── src
│   │       └── lib.rs
│   ├── node_registry
│   │   ├── Cargo.toml
│   │   └── src
│   │       └── lib.rs
│   ├── runtime_adapters
│   │   ├── Cargo.toml
│   │   └── src
│   │       └── lib.rs
│   ├── runtime_core
│   │   ├── Cargo.toml
│   │   └── src
│   │       └── lib.rs
│   ├── runtime_server
│   │   ├── Cargo.toml
│   │   ├── build.rs
│   │   └── src
│   │       ├── bin
│   │       │   └── stitchly-server.rs
│   │       ├── lib.rs
│   │       └── platform.rs
│   └── workflow_schema
│       ├── Cargo.toml
│       └── src
│           └── lib.rs
├── design_lab
│   ├── AGENTS.md
│   ├── README.md
│   ├── canvas
│   │   ├── 01_canvas_control
│   │   │   ├── README.md
│   │   │   ├── index.html
│   │   │   └── styles.css
│   │   ├── 02_node_management_panel
│   │   │   ├── README.md
│   │   │   ├── index.html
│   │   │   └── styles.css
│   │   ├── 03_send_email_node_manager
│   │   │   ├── README.md
│   │   │   ├── index.html
│   │   │   └── styles.css
│   │   ├── 04_text_input_node_manager
│   │   │   ├── README.md
│   │   │   ├── index.html
│   │   │   └── styles.css
│   │   └── README.md
│   ├── dashboard
│   │   └── v1
│   │       ├── 00_dashboard_reference_analysis
│   │       │   ├── README.md
│   │       │   └── index.html
│   │       ├── 01_dashboard_shell
│   │       │   ├── README.md
│   │       │   └── index.html
│   │       ├── 02_dashboard_table
│   │       │   ├── README.md
│   │       │   └── index.html
│   │       ├── 03_dashboard_sidebar
│   │       │   ├── README.md
│   │       │   └── index.html
│   │       ├── 04_dashboard_collapsed_sidebar
│   │       │   ├── README.md
│   │       │   └── index.html
│   │       ├── 05_dashboard_mobile
│   │       │   ├── README.md
│   │       │   └── index.html
│   │       ├── 06_dashboard_detail_panel
│   │       │   ├── README.md
│   │       │   └── index.html
│   │       ├── 07_dashboard_empty_states
│   │       │   ├── README.md
│   │       │   └── index.html
│   │       ├── 08_dashboard_loading_states
│   │       │   ├── README.md
│   │       │   └── index.html
│   │       ├── 11_dashboard_notifications
│   │       │   ├── README.md
│   │       │   └── index.html
│   │       ├── README.md
│   │       └── shared.css
│   ├── data_sources
│   │   ├── README.md
│   │   └── v1
│   │       ├── 00_data_sources_window
│   │       │   ├── README.md
│   │       │   └── index.html
│   │       ├── 01_catalog_tree
│   │       │   ├── README.md
│   │       │   └── index.html
│   │       ├── 02_catalog_overview
│   │       │   ├── README.md
│   │       │   └── index.html
│   │       ├── 03_table_overview
│   │       │   ├── README.md
│   │       │   └── index.html
│   │       ├── 04_sample_data
│   │       │   ├── README.md
│   │       │   └── index.html
│   │       ├── 05_sql_editor
│   │       │   ├── README.md
│   │       │   └── index.html
│   │       ├── README.md
│   │       └── shared.css
│   ├── integrations
│   │   ├── README.md
│   │   └── v1
│   │       ├── 00_integrations_window
│   │       │   ├── README.md
│   │       │   └── index.html
│   │       ├── README.md
│   │       └── shared.css
│   ├── login
│   │   └── v1
│   │       ├── 00_login_reference_analysis
│   │       │   ├── README.md
│   │       │   └── index.html
│   │       ├── 01_login_shell
│   │       │   ├── README.md
│   │       │   └── index.html
│   │       ├── 02_login_form
│   │       │   ├── README.md
│   │       │   └── index.html
│   │       ├── 03_login_brand_panel
│   │       │   ├── README.md
│   │       │   └── index.html
│   │       ├── 04_login_mobile
│   │       │   ├── README.md
│   │       │   └── index.html
│   │       ├── README.md
│   │       └── shared.css
│   ├── menu
│   │   ├── README.md
│   │   └── v1
│   │       ├── 00_canvas_node_menu
│   │       │   ├── README.md
│   │       │   └── index.html
│   │       ├── README.md
│   │       └── shared.css
│   ├── nodes
│   │   └── v1
│   │       ├── 00_http_api_request
│   │       │   ├── README.md
│   │       │   └── index.html
│   │       ├── 01_conditional
│   │       │   ├── README.md
│   │       │   └── index.html
│   │       ├── 02_schedule_trigger
│   │       │   ├── README.md
│   │       │   └── index.html
│   │       ├── 03_text_input
│   │       │   ├── README.md
│   │       │   └── index.html
│   │       ├── 04_json_input
│   │       │   ├── README.md
│   │       │   └── index.html
│   │       ├── 05_file_input
│   │       │   ├── README.md
│   │       │   └── index.html
│   │       ├── 06_preview_output
│   │       │   ├── README.md
│   │       │   └── index.html
│   │       ├── 07_send_email
│   │       │   ├── README.md
│   │       │   └── index.html
│   │       ├── 08_send_telegram
│   │       │   ├── README.md
│   │       │   └── index.html
│   │       ├── 09_table_output
│   │       │   ├── README.md
│   │       │   └── index.html
│   │       ├── 10_table_input
│   │       │   ├── README.md
│   │       │   └── index.html
│   │       ├── 11_input_schema
│   │       │   ├── README.md
│   │       │   └── index.html
│   │       ├── 12_dolt_repo_source
│   │       │   ├── README.md
│   │       │   └── index.html
│   │       ├── 13_dolt_repo_sync
│   │       │   ├── README.md
│   │       │   └── index.html
│   │       ├── 14_dolt_change_manifest
│   │       │   ├── README.md
│   │       │   └── index.html
│   │       ├── 15_dolt_dump
│   │       │   ├── README.md
│   │       │   └── index.html
│   │       ├── 16_dolt_diff_export
│   │       │   ├── README.md
│   │       │   └── index.html
│   │       ├── 17_load_to_duckdb
│   │       │   ├── README.md
│   │       │   └── index.html
│   │       ├── 18_table_merge
│   │       │   ├── README.md
│   │       │   └── index.html
│   │       ├── 19_checkpoint_read
│   │       │   ├── README.md
│   │       │   └── index.html
│   │       ├── 20_checkpoint_write
│   │       │   ├── README.md
│   │       │   └── index.html
│   │       ├── 21_quality_check
│   │       │   ├── README.md
│   │       │   └── index.html
│   │       ├── 22_sql_transform
│   │       │   ├── README.md
│   │       │   └── index.html
│   │       ├── README.md
│   │       └── shared.css
│   ├── runs
│   │   ├── README.md
│   │   └── v1
│   │       ├── 00_run_state_planning
│   │       │   ├── README.md
│   │       │   └── index.html
│   │       ├── 01_created_and_queued
│   │       │   ├── README.md
│   │       │   └── index.html
│   │       ├── 02_planning
│   │       │   ├── README.md
│   │       │   └── index.html
│   │       ├── 03_running
│   │       │   ├── README.md
│   │       │   └── index.html
│   │       ├── 04_succeeded
│   │       │   ├── README.md
│   │       │   └── index.html
│   │       ├── 05_failed
│   │       │   ├── README.md
│   │       │   └── index.html
│   │       ├── 06_cancelling_and_cancelled
│   │       │   ├── README.md
│   │       │   └── index.html
│   │       ├── README.md
│   │       └── shared.css
│   ├── runs_history
│   │   ├── README.md
│   │   └── v1
│   │       ├── 00_runs_window
│   │       │   ├── README.md
│   │       │   └── index.html
│   │       ├── 01_run_detail_submenu
│   │       │   ├── README.md
│   │       │   └── index.html
│   │       ├── README.md
│   │       └── shared.css
│   └── runs_node
│       ├── README.md
│       └── v1
│           ├── 00_node_run_state_planning
│           │   ├── README.md
│           │   └── index.html
│           ├── 01_pending
│           │   ├── README.md
│           │   └── index.html
│           ├── 02_ready
│           │   ├── README.md
│           │   └── index.html
│           ├── 03_running
│           │   ├── README.md
│           │   └── index.html
│           ├── 04_succeeded
│           │   ├── README.md
│           │   └── index.html
│           ├── 05_failed
│           │   ├── README.md
│           │   └── index.html
│           ├── 06_skipped
│           │   ├── README.md
│           │   └── index.html
│           ├── 07_retrying
│           │   ├── README.md
│           │   └── index.html
│           ├── 08_cancelling
│           │   ├── README.md
│           │   └── index.html
│           ├── 09_cancelled
│           │   ├── README.md
│           │   └── index.html
│           ├── README.md
│           └── shared.css
├── docs
│   ├── 00_foundation
│   │   ├── 00_intro.md
│   │   ├── 01_node_types.md
│   │   ├── 02_architecture.md
│   │   ├── 03_workflow_schema.md
│   │   ├── 04_execution_runtime.md
│   │   ├── 06_backend_api.md
│   │   ├── 07_persistence.md
│   │   ├── 08_security_and_sandboxing.md
│   │   ├── 09_performance_and_scaling.md
│   │   ├── 10_mvp_scope.md
│   │   ├── 11_decision_log.md
│   │   ├── 12_dataflow_and_workloads.md
│   │   ├── 13_testing_strategy.md
│   │   ├── 14_repo_structure_and_build.md
│   │   ├── 15_node_definition_spec.md
│   │   ├── 16_connections_and_secrets.md
│   │   ├── 17_artifacts_and_dataset_refs.md
│   │   ├── 18_run_lifecycle_and_events.md
│   │   ├── 19_compute_model.md
│   │   ├── 20_app_auth_and_workspace_spec.md
│   │   ├── 21_workflow_management_spec.md
│   │   ├── 22_run_history_and_debugging_spec.md
│   │   ├── 23_storage_root_and_identity_architecture.md
│   │   └── 24_workflow_duckdb_storage_spec.md
│   ├── 01_workflows
│   │   ├── 00_finance_workflow_ideas.md
│   │   ├── 01_finance_table_grouping_and_naming.md
│   │   ├── 20_workflow_example_dolt.md
│   │   └── 21_dolthub_market_data_duckdb_ingest.md
│   ├── 02_build
│   │   └── 00_llm_build_prompt.md
│   ├── 03_ui
│   │   ├── 00_frontend_canvas.md
│   │   ├── 01_node_state_model.md
│   │   ├── 02_ui_roadmap.md
│   │   ├── 03_node_reference_analysis.md
│   │   ├── 04_ui_lab_workflow.md
│   │   ├── 05_node_design_inventory.md
│   │   └── 06_workflow_management_ui.md
│   ├── 04_execution
│   │   ├── 01_node_io_and_execution_contracts.md
│   │   ├── 02_output_contract.md
│   │   ├── 03_execution_contract.md
│   │   ├── 04_adapter_contract.md
│   │   ├── 05_multi_edge_semantics.md
│   │   ├── 06_run_execution_implementation_spec.md
│   │   └── README.md
│   ├── 05_venture
│   │   ├── 00_idea_framework.md
│   │   ├── 01_idea_record_template.md
│   │   ├── 02_scoring_rubric.md
│   │   ├── 03_recommendation_rules.md
│   │   ├── 04_portfolio_backlog.md
│   │   ├── 05_idea_generation_loop.md
│   │   ├── 06_idea_source_catalog.md
│   │   ├── 07_pre_score_template.md
│   │   ├── 20_idea_savr.md
│   │   ├── 21_idea_waterwatch.md
│   │   ├── 22_idea_gridza.md
│   │   └── README.md
│   ├── 06_trading_research
│   │   ├── 00_systematic_technical_strategy_research.md
│   │   └── 01_derivatives_and_volatility_strategy_research.md
│   ├── AGENTS.md
│   └── README.md
├── package.json
├── pnpm-lock.yaml
├── pnpm-workspace.yaml
├── scripts
│   ├── dev_ui_agent.ps1
│   ├── dev_ui_agent.sh
│   └── generate_brand_symbol_assets.mjs
├── src
│   └── lib.rs
├── tests
│   ├── fixtures
│   │   ├── api
│   │   │   ├── connections.json
│   │   │   └── node_definitions.json
│   │   ├── runs
│   │   │   └── basic_text_preview_events.json
│   │   └── workflows
│   │       └── basic_text_preview.json
│   ├── integration
│   │   └── run_flow.rs
│   └── integration.rs
├── vite-dev.err.log
└── vite-dev.out.log

128 directories, 292 files
