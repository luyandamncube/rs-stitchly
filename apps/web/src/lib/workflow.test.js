import nodeDefinitionFixture from '../../../../tests/fixtures/api/node_definitions.json';
import workflowFixture from '../../../../tests/fixtures/workflows/basic_text_preview.json';
import {
  canConnect,
  connectWorkflowNodes,
  createCanvasElements,
  removeWorkflowNode,
  removeWorkflowEdge,
  reconnectWorkflowEdge,
  syncWorkflowEdges
} from './workflow';

function buildTableInputToTableOutputWorkflow() {
  return {
    ...workflowFixture,
    nodes: [
      ...workflowFixture.nodes,
      {
        node_id: 'table_input_runs',
        type_id: 'table_input',
        definition_version: 1,
        label: 'Table Input',
        config: {
          catalog: 'workflow.duckdb',
          execution: {
            wait_after_seconds: 0,
            wait_before_seconds: 0
          },
          open_in_catalog: false,
          output_alias: 'workflow_runs',
          refresh_schema: true,
          row_filter: '',
          row_limit: null,
          schema_name: 'runs',
          selected_columns: [],
          table_name: 'workflow_runs'
        },
        position: { x: 120, y: 320 }
      },
      {
        node_id: 'table_output_copy',
        type_id: 'table_output',
        definition_version: 1,
        label: 'Table Output',
        config: {
          execution: {
            wait_after_seconds: 0,
            wait_before_seconds: 0
          },
          include_run_id: true,
          include_written_at: true,
          input_shape: 'single_text_row',
          open_in_catalog: false,
          table_name: 'workflow_runs_copy',
          target_schema: 'tables',
          value_column: 'content',
          write_mode: 'append'
        },
        position: { x: 560, y: 320 }
      }
    ],
    edges: workflowFixture.edges
  };
}

function buildTableSchemaToTableOutputWorkflow() {
  return {
    ...workflowFixture,
    nodes: [
      ...workflowFixture.nodes,
      {
        node_id: 'table_schema_orders',
        type_id: 'table_schema',
        definition_version: 1,
        label: 'Table Schema',
        config: {
          catalog: 'workflow.duckdb',
          checks: ['total_amount >= 0'],
          columns: [
            {
              name: 'order_id',
              nullable: false,
              primary_key: true,
              type: 'bigint'
            }
          ],
          create_mode: 'create_if_missing',
          execution: {
            wait_after_seconds: 0,
            wait_before_seconds: 0
          },
          if_target_exists: 'keep_existing',
          open_in_catalog: false,
          output_alias: 'orders_definition',
          primary_key: ['order_id'],
          schema_name: 'output',
          table_name: 'orders'
        },
        position: { x: 120, y: 320 }
      },
      {
        node_id: 'table_output_copy',
        type_id: 'table_output',
        definition_version: 1,
        label: 'Table Output',
        config: {
          execution: {
            wait_after_seconds: 0,
            wait_before_seconds: 0
          },
          include_run_id: true,
          include_written_at: true,
          input_shape: 'single_text_row',
          open_in_catalog: false,
          table_name: 'workflow_runs_copy',
          target_schema: 'tables',
          value_column: 'content',
          write_mode: 'append'
        },
        position: { x: 560, y: 320 }
      }
    ],
    edges: workflowFixture.edges
  };
}

function buildDoltRepoSourceWorkflow() {
  return {
    ...workflowFixture,
    nodes: [
      ...workflowFixture.nodes,
      {
        node_id: 'dolt_repo_source',
        type_id: 'dolt_repo_source',
        definition_version: 1,
        label: 'Dolt Repo Source',
        config: {
          branch: 'main',
          checkout_ref: '',
          clone_mode: 'reuse_local_copy',
          connection_ref: 'dolthub_public',
          execution: {
            wait_after_seconds: 0,
            wait_before_seconds: 0
          },
          repository: 'post-no-preference/earnings',
          sync_strategy: 'pull_before_execution'
        },
        position: { x: 120, y: 320 }
      }
    ],
    edges: workflowFixture.edges
  };
}

function buildCheckpointReadWorkflow() {
  return {
    ...workflowFixture,
    nodes: [
      ...workflowFixture.nodes,
      {
        node_id: 'checkpoint_read',
        type_id: 'checkpoint_read',
        definition_version: 1,
        label: 'Checkpoint Read',
        config: {
          branch: 'main',
          checkpoint_table: 'tables.ingest_checkpoints',
          emit_bootstrap_marker_if_missing: true,
          execution: {
            wait_after_seconds: 0,
            wait_before_seconds: 0
          },
          fail_on_stale_checkpoint: false,
          source_repo: 'post-no-preference/options'
        },
        position: { x: 120, y: 220 }
      },
      {
        node_id: 'dolt_repo_source',
        type_id: 'dolt_repo_source',
        definition_version: 1,
        label: 'Dolt Repo Source',
        config: {
          branch: 'main',
          checkout_ref: '',
          clone_mode: 'reuse_local_copy',
          connection_ref: 'dolthub_public',
          execution: {
            wait_after_seconds: 0,
            wait_before_seconds: 0
          },
          repository: 'post-no-preference/options',
          sync_strategy: 'pull_before_execution'
        },
        position: { x: 120, y: 320 }
      },
      {
        node_id: 'dolt_repo_sync',
        type_id: 'dolt_repo_sync',
        definition_version: 1,
        label: 'Dolt Repo Sync',
        config: {
          branch_guard: 'require_tracked_branch_match',
          dirty_working_copy_policy: 'fail_if_dirty',
          execution: {
            wait_after_seconds: 0,
            wait_before_seconds: 0
          },
          no_change_behavior: 'emit_current_range',
          sync_action: 'pull_remote_head'
        },
        position: { x: 520, y: 280 }
      }
    ],
    edges: [
      ...workflowFixture.edges,
      {
        edge_id: 'edge_checkpoint_read_to_dolt_repo_sync',
        source_node_id: 'checkpoint_read',
        source_port_id: 'checkpoint',
        target_node_id: 'dolt_repo_sync',
        target_port_id: 'checkpoint'
      },
      {
        edge_id: 'edge_repo_source_to_repo_sync',
        source_node_id: 'dolt_repo_source',
        source_port_id: 'repo_out',
        target_node_id: 'dolt_repo_sync',
        target_port_id: 'repo'
      }
    ]
  };
}

function buildDoltRepoSyncWorkflow() {
  return {
    ...workflowFixture,
    nodes: [
      ...workflowFixture.nodes,
      {
        node_id: 'dolt_repo_source',
        type_id: 'dolt_repo_source',
        definition_version: 1,
        label: 'Dolt Repo Source',
        config: {
          branch: 'main',
          checkout_ref: '',
          clone_mode: 'reuse_local_copy',
          connection_ref: 'dolthub_public',
          execution: {
            wait_after_seconds: 0,
            wait_before_seconds: 0
          },
          repository: 'post-no-preference/earnings',
          sync_strategy: 'pull_before_execution'
        },
        position: { x: 120, y: 320 }
      },
      {
        node_id: 'dolt_repo_sync',
        type_id: 'dolt_repo_sync',
        definition_version: 1,
        label: 'Dolt Repo Sync',
        config: {
          branch_guard: 'require_tracked_branch_match',
          dirty_working_copy_policy: 'fail_if_dirty',
          execution: {
            wait_after_seconds: 0,
            wait_before_seconds: 0
          },
          no_change_behavior: 'emit_current_range',
          sync_action: 'pull_remote_head'
        },
        position: { x: 520, y: 320 }
      }
    ],
    edges: [
      ...workflowFixture.edges,
      {
        edge_id: 'edge_repo_source_to_repo_sync',
        source_node_id: 'dolt_repo_source',
        source_port_id: 'repo_out',
        target_node_id: 'dolt_repo_sync',
        target_port_id: 'repo'
      }
    ]
  };
}

function buildDoltChangeManifestWorkflow() {
  const workflow = buildDoltRepoSyncWorkflow()

  workflow.nodes.push({
    node_id: 'dolt_change_manifest',
    type_id: 'dolt_change_manifest',
    definition_version: 1,
    label: 'Dolt Change Manifest',
    config: {
      execution: {
        wait_after_seconds: 0,
        wait_before_seconds: 0
      },
      schema_change_policy: 'flag_and_continue',
      selected_tables: [],
      table_scope: 'all_tables'
    },
    position: { x: 920, y: 320 }
  })
  workflow.edges.push({
    edge_id: 'edge_repo_sync_to_change_manifest',
    source_node_id: 'dolt_repo_sync',
    source_port_id: 'repo_out',
    target_node_id: 'dolt_change_manifest',
    target_port_id: 'repo'
  })

  return workflow
}

function buildDoltDumpWorkflow() {
  const workflow = buildDoltChangeManifestWorkflow()

  workflow.nodes.push({
    node_id: 'dolt_dump',
    type_id: 'dolt_dump',
    definition_version: 1,
    label: 'Dolt Dump',
    config: {
      artifact_retention: 'keep_latest_success',
      execution: {
        wait_after_seconds: 0,
        wait_before_seconds: 0
      },
      output_directory_policy: 'ephemeral_run_bundle',
      output_format: 'parquet',
      selected_tables: [],
      table_selection_mode: 'prefer_manifest_scope'
    },
    position: { x: 1320, y: 320 }
  })
  workflow.edges.push({
    edge_id: 'edge_change_manifest_to_dolt_dump',
    source_node_id: 'dolt_change_manifest',
    source_port_id: 'manifest',
    target_node_id: 'dolt_dump',
    target_port_id: 'repo'
  })

  return workflow
}

function buildDoltDiffExportWorkflow() {
  const workflow = buildDoltChangeManifestWorkflow()

  workflow.nodes.push({
    node_id: 'dolt_diff_export',
    type_id: 'dolt_diff_export',
    definition_version: 1,
    label: 'Dolt Diff Export',
    config: {
      change_filter: 'all_changes',
      deleted_row_handling: 'emit_delete_markers',
      execution: {
        wait_after_seconds: 0,
        wait_before_seconds: 0
      },
      output_format: 'parquet'
    },
    position: { x: 1320, y: 320 }
  })
  workflow.edges.push({
    edge_id: 'edge_change_manifest_to_dolt_diff_export',
    source_node_id: 'dolt_change_manifest',
    source_port_id: 'manifest',
    target_node_id: 'dolt_diff_export',
    target_port_id: 'manifest'
  })

  return workflow
}

function buildLoadToDuckDbFromDumpWorkflow() {
  const workflow = buildDoltDumpWorkflow()

  workflow.nodes.push({
    node_id: 'load_to_duckdb',
    type_id: 'load_to_duckdb',
    definition_version: 1,
    label: 'Load to DuckDB',
    config: {
      delta_context_preservation: 'preserve_commit_range_and_delete_flags',
      execution: {
        wait_after_seconds: 0,
        wait_before_seconds: 0
      },
      schema_handling: 'infer_on_first_load_validate_on_recurring',
      table_mapping: 'bundle_aware_staging_names',
      target_schema: 'staging'
    },
    position: { x: 1720, y: 320 }
  })
  workflow.edges.push({
    edge_id: 'edge_dolt_dump_to_load_to_duckdb',
    source_node_id: 'dolt_dump',
    source_port_id: 'bundle',
    target_node_id: 'load_to_duckdb',
    target_port_id: 'bundle'
  })

  return workflow
}

function buildLoadToDuckDbFromDiffWorkflow() {
  const workflow = buildDoltDiffExportWorkflow()

  workflow.nodes.push({
    node_id: 'load_to_duckdb',
    type_id: 'load_to_duckdb',
    definition_version: 1,
    label: 'Load to DuckDB',
    config: {
      delta_context_preservation: 'preserve_commit_range_and_delete_flags',
      execution: {
        wait_after_seconds: 0,
        wait_before_seconds: 0
      },
      schema_handling: 'infer_on_first_load_validate_on_recurring',
      table_mapping: 'bundle_aware_staging_names',
      target_schema: 'staging'
    },
    position: { x: 1720, y: 320 }
  })
  workflow.edges.push({
    edge_id: 'edge_dolt_diff_export_to_load_to_duckdb',
    source_node_id: 'dolt_diff_export',
    source_port_id: 'bundle',
    target_node_id: 'load_to_duckdb',
    target_port_id: 'bundle'
  })

  return workflow
}

function buildTableMergeWorkflow() {
  const workflow = buildLoadToDuckDbFromDumpWorkflow()

  workflow.nodes.push({
    node_id: 'table_merge',
    type_id: 'table_merge',
    definition_version: 1,
    label: 'Table Merge',
    config: {
      delete_handling: 'apply_delete_markers',
      execution: {
        wait_after_seconds: 0,
        wait_before_seconds: 0
      },
      merge_key_columns: ['symbol', 'report_date'],
      schema_drift_behavior: 'fail_and_require_review',
      target_schema: 'tables',
      write_policy: 'upsert'
    },
    position: { x: 2120, y: 320 }
  })
  workflow.edges.push({
    edge_id: 'edge_load_to_duckdb_to_table_merge',
    source_node_id: 'load_to_duckdb',
    source_port_id: 'table',
    target_node_id: 'table_merge',
    target_port_id: 'table'
  })

  return workflow
}

function buildCheckpointWriteWorkflow() {
  const workflow = buildTableMergeWorkflow()

  workflow.nodes.push({
    node_id: 'checkpoint_write',
    type_id: 'checkpoint_write',
    definition_version: 1,
    label: 'Checkpoint Write',
    config: {
      advance_on_partial_success: false,
      checkpoint_table: 'tables.ingest_checkpoints',
      commit_source: 'metadata.current_commit',
      execution: {
        wait_after_seconds: 0,
        wait_before_seconds: 0
      },
      only_persist_on_full_success: true,
      write_timing: 'after_merge_success'
    },
    position: { x: 2520, y: 320 }
  })
  workflow.edges.push({
    edge_id: 'edge_table_merge_to_checkpoint_write',
    source_node_id: 'table_merge',
    source_port_id: 'table',
    target_node_id: 'checkpoint_write',
    target_port_id: 'table'
  })

  return workflow
}

function buildTableMergeToTableOutputWorkflow() {
  const workflow = buildTableMergeWorkflow()

  workflow.nodes.push({
    node_id: 'table_output_copy',
    type_id: 'table_output',
    definition_version: 1,
    label: 'Table Output',
    config: {
      execution: {
        wait_after_seconds: 0,
        wait_before_seconds: 0
      },
      include_run_id: true,
      include_written_at: true,
      input_shape: 'single_text_row',
      open_in_catalog: false,
      table_name: 'durable_copy',
      target_schema: 'outputs',
      value_column: 'content',
      write_mode: 'append'
    },
    position: { x: 2520, y: 320 }
  })

  return workflow
}

function buildQualityCheckWorkflow() {
  const workflow = buildTableMergeWorkflow()

  workflow.nodes.push({
    node_id: 'quality_check',
    type_id: 'quality_check',
    definition_version: 1,
    label: 'Quality Check',
    config: {
      allow_warning_only_runs_to_continue: true,
      block_checkpoint_write_on_failure: true,
      execution: {
        wait_after_seconds: 0,
        wait_before_seconds: 0
      },
      null_key_policy: 'block_on_primary_key_nulls',
      schema_drift_rule: 'fail_on_required_column_drift',
      suite_preset: 'post_merge_ingest_gate',
      warning_budget: 2
    },
    position: { x: 2520, y: 320 }
  })
  workflow.edges.push({
    edge_id: 'edge_table_merge_to_quality_check',
    source_node_id: 'table_merge',
    source_port_id: 'table',
    target_node_id: 'quality_check',
    target_port_id: 'table'
  })

  return workflow
}

describe('createCanvasElements', () => {
  it('consumes the shared fixture workflow and preserves its graph shape', () => {
    const graph = createCanvasElements(
      workflowFixture,
      nodeDefinitionFixture.node_definitions,
      workflowFixture.nodes[0].node_id,
      workflowFixture.nodes[1].node_id
    );

    expect(graph.nodes).toHaveLength(2);
    expect(graph.edges).toHaveLength(1);
    expect(graph.nodes[0].type).toBe('text_input');
    expect(graph.nodes[0].data.label).toBe('Text Input');
    expect(graph.edges[0].sourceHandle).toBe('text');
    expect(graph.edges[0].targetHandle).toBe('body');
    expect(graph.nodes[1].data.uiState.interaction.hovered).toBe(true);
  });

  it('maps table schema nodes onto their dedicated canvas node type', () => {
    const workflow = buildTableSchemaToTableOutputWorkflow()
    const graph = createCanvasElements(
      workflow,
      nodeDefinitionFixture.node_definitions,
      'table_schema_orders',
      null
    )

    expect(
      graph.nodes.find((node) => node.id === 'table_schema_orders')?.type
    ).toBe('table_schema')
  })

  it('maps dolt repo source nodes onto their dedicated canvas node type', () => {
    const workflow = buildDoltRepoSourceWorkflow()
    const graph = createCanvasElements(
      workflow,
      nodeDefinitionFixture.node_definitions,
      'dolt_repo_source',
      null
    )

    expect(
      graph.nodes.find((node) => node.id === 'dolt_repo_source')?.type
    ).toBe('dolt_repo_source')
  })

  it('maps dolt repo sync nodes onto their dedicated canvas node type', () => {
    const workflow = buildDoltRepoSyncWorkflow()
    const graph = createCanvasElements(
      workflow,
      nodeDefinitionFixture.node_definitions,
      'dolt_repo_sync',
      null
    )

    expect(
      graph.nodes.find((node) => node.id === 'dolt_repo_sync')?.type
    ).toBe('dolt_repo_sync')
  })

  it('maps dolt change manifest nodes onto their dedicated canvas node type', () => {
    const workflow = buildDoltChangeManifestWorkflow()
    const graph = createCanvasElements(
      workflow,
      nodeDefinitionFixture.node_definitions,
      'dolt_change_manifest',
      null
    )

    expect(
      graph.nodes.find((node) => node.id === 'dolt_change_manifest')?.type
    ).toBe('dolt_change_manifest')
  })

  it('maps dolt dump nodes onto their dedicated canvas node type', () => {
    const workflow = buildDoltDumpWorkflow()
    const graph = createCanvasElements(
      workflow,
      nodeDefinitionFixture.node_definitions,
      'dolt_dump',
      null
    )

    expect(
      graph.nodes.find((node) => node.id === 'dolt_dump')?.type
    ).toBe('dolt_dump')
  })

  it('maps dolt diff export nodes onto their dedicated canvas node type', () => {
    const workflow = buildDoltDiffExportWorkflow()
    const graph = createCanvasElements(
      workflow,
      nodeDefinitionFixture.node_definitions,
      'dolt_diff_export',
      null
    )

    expect(
      graph.nodes.find((node) => node.id === 'dolt_diff_export')?.type
    ).toBe('dolt_diff_export')
  })

  it('maps load to duckdb nodes onto their dedicated canvas node type', () => {
    const workflow = buildLoadToDuckDbFromDumpWorkflow()
    const graph = createCanvasElements(
      workflow,
      nodeDefinitionFixture.node_definitions,
      'load_to_duckdb',
      null
    )

    expect(
      graph.nodes.find((node) => node.id === 'load_to_duckdb')?.type
    ).toBe('load_to_duckdb')
  })

  it('maps table merge nodes onto their dedicated canvas node type', () => {
    const workflow = buildTableMergeWorkflow()
    const graph = createCanvasElements(
      workflow,
      nodeDefinitionFixture.node_definitions,
      'table_merge',
      null
    )

    expect(
      graph.nodes.find((node) => node.id === 'table_merge')?.type
    ).toBe('table_merge')
  })

  it('maps checkpoint read nodes onto their dedicated canvas node type', () => {
    const workflow = buildCheckpointReadWorkflow()
    const graph = createCanvasElements(
      workflow,
      nodeDefinitionFixture.node_definitions,
      'checkpoint_read',
      null
    )

    expect(
      graph.nodes.find((node) => node.id === 'checkpoint_read')?.type
    ).toBe('checkpoint_read')
  })

  it('maps checkpoint write nodes onto their dedicated canvas node type', () => {
    const workflow = buildCheckpointWriteWorkflow()
    const graph = createCanvasElements(
      workflow,
      nodeDefinitionFixture.node_definitions,
      'checkpoint_write',
      null
    )

    expect(
      graph.nodes.find((node) => node.id === 'checkpoint_write')?.type
    ).toBe('checkpoint_write')
  })

  it('maps quality check nodes onto their dedicated canvas node type', () => {
    const workflow = buildQualityCheckWorkflow()
    const graph = createCanvasElements(
      workflow,
      nodeDefinitionFixture.node_definitions,
      'quality_check',
      null
    )

    expect(
      graph.nodes.find((node) => node.id === 'quality_check')?.type
    ).toBe('quality_check')
  })

  it('allows a dolt repo source handle to connect into dolt repo sync', () => {
    const workflow = buildDoltRepoSyncWorkflow()

    expect(
      canConnect(
        {
          source: 'dolt_repo_source',
          sourceHandle: 'repo_out',
          target: 'dolt_repo_sync',
          targetHandle: 'repo'
        },
        workflow,
        nodeDefinitionFixture.node_definitions
      )
    ).toBe(true)
  })

  it('allows a checkpoint read handle to connect into dolt repo sync', () => {
    const workflow = buildCheckpointReadWorkflow()

    expect(
      canConnect(
        {
          source: 'checkpoint_read',
          sourceHandle: 'checkpoint',
          target: 'dolt_repo_sync',
          targetHandle: 'checkpoint'
        },
        workflow,
        nodeDefinitionFixture.node_definitions
      )
    ).toBe(true)
  })

  it('allows a table merge handle to connect into checkpoint write', () => {
    const workflow = buildCheckpointWriteWorkflow()

    expect(
      canConnect(
        {
          source: 'table_merge',
          sourceHandle: 'table',
          target: 'checkpoint_write',
          targetHandle: 'table'
        },
        workflow,
        nodeDefinitionFixture.node_definitions
      )
    ).toBe(true)
  })

  it('allows table merge to connect into quality check', () => {
    const workflow = buildQualityCheckWorkflow()

    expect(
      canConnect(
        {
          source: 'table_merge',
          sourceHandle: 'table',
          target: 'quality_check',
          targetHandle: 'table'
        },
        workflow,
        nodeDefinitionFixture.node_definitions
      )
    ).toBe(true)
  })

  it('allows quality check to connect into checkpoint write', () => {
    const workflow = buildQualityCheckWorkflow()

    workflow.nodes.push({
      node_id: 'checkpoint_write_after_quality',
      type_id: 'checkpoint_write',
      definition_version: 1,
      label: 'Checkpoint Write',
      config: {
        advance_on_partial_success: false,
        checkpoint_table: 'tables.ingest_checkpoints',
        commit_source: 'metadata.current_commit',
        execution: {
          wait_after_seconds: 0,
          wait_before_seconds: 0
        },
        only_persist_on_full_success: true,
        write_timing: 'after_quality_gate'
      },
      position: { x: 2920, y: 320 }
    })

    expect(
      canConnect(
        {
          source: 'quality_check',
          sourceHandle: 'table',
          target: 'checkpoint_write_after_quality',
          targetHandle: 'table'
        },
        workflow,
        nodeDefinitionFixture.node_definitions
      )
    ).toBe(true)
  })

  it('allows a dolt repo sync handle to connect into dolt change manifest', () => {
    const workflow = buildDoltChangeManifestWorkflow()

    expect(
      canConnect(
        {
          source: 'dolt_repo_sync',
          sourceHandle: 'repo_out',
          target: 'dolt_change_manifest',
          targetHandle: 'repo'
        },
        workflow,
        nodeDefinitionFixture.node_definitions
      )
    ).toBe(true)
  })

  it('allows a dolt change manifest handle to connect into dolt dump', () => {
    const workflow = buildDoltDumpWorkflow()

    expect(
      canConnect(
        {
          source: 'dolt_change_manifest',
          sourceHandle: 'manifest',
          target: 'dolt_dump',
          targetHandle: 'repo'
        },
        workflow,
        nodeDefinitionFixture.node_definitions
      )
    ).toBe(true)
  })

  it('allows a dolt change manifest handle to connect into dolt diff export', () => {
    const workflow = buildDoltDiffExportWorkflow()

    expect(
      canConnect(
        {
          source: 'dolt_change_manifest',
          sourceHandle: 'manifest',
          target: 'dolt_diff_export',
          targetHandle: 'manifest'
        },
        workflow,
        nodeDefinitionFixture.node_definitions
      )
    ).toBe(true)
  })

  it('allows a dolt dump handle to connect into load to duckdb', () => {
    const workflow = buildLoadToDuckDbFromDumpWorkflow()

    expect(
      canConnect(
        {
          source: 'dolt_dump',
          sourceHandle: 'bundle',
          target: 'load_to_duckdb',
          targetHandle: 'bundle'
        },
        workflow,
        nodeDefinitionFixture.node_definitions
      )
    ).toBe(true)
  })

  it('allows a dolt diff export handle to connect into load to duckdb', () => {
    const workflow = buildLoadToDuckDbFromDiffWorkflow()

    expect(
      canConnect(
        {
          source: 'dolt_diff_export',
          sourceHandle: 'bundle',
          target: 'load_to_duckdb',
          targetHandle: 'bundle'
        },
        workflow,
        nodeDefinitionFixture.node_definitions
      )
    ).toBe(true)
  })

  it('allows load to duckdb to connect into table merge', () => {
    const workflow = buildTableMergeWorkflow()

    expect(
      canConnect(
        {
          source: 'load_to_duckdb',
          sourceHandle: 'table',
          target: 'table_merge',
          targetHandle: 'table'
        },
        workflow,
        nodeDefinitionFixture.node_definitions
      )
    ).toBe(true)
  })

  it('can remove and resync edges from the workflow graph', () => {
    const nextWorkflow = syncWorkflowEdges(workflowFixture, [])

    expect(nextWorkflow.edges).toHaveLength(0)
  })

  it('can remove a workflow edge by id', () => {
    const nextWorkflow = removeWorkflowEdge(
      workflowFixture,
      workflowFixture.edges[0].edge_id
    )

    expect(nextWorkflow.edges).toHaveLength(0)
  })

  it('can remove a workflow node and any attached edges', () => {
    const nextWorkflow = removeWorkflowNode(workflowFixture, 'input_text')

    expect(nextWorkflow.nodes).toHaveLength(1)
    expect(nextWorkflow.nodes[0].node_id).toBe('send_email_notification')
    expect(nextWorkflow.edges).toHaveLength(0)
  })

  it('can reconnect an existing edge without tripping the single-target guard', () => {
    const edge = workflowFixture.edges[0]
    const nextConnection = {
      edgeId: edge.edge_id,
      source: 'input_text',
      sourceHandle: 'text',
      target: 'send_email_notification',
      targetHandle: 'body'
    }

    expect(
      canConnect(nextConnection, workflowFixture, nodeDefinitionFixture.node_definitions)
    ).toBe(true)

    const nextWorkflow = reconnectWorkflowEdge(workflowFixture, edge.edge_id, nextConnection)

    expect(nextWorkflow.edges[0].source_node_id).toBe('input_text')
    expect(nextWorkflow.edges[0].target_node_id).toBe('send_email_notification')
    expect(nextWorkflow.edges[0].target_port_id).toBe('body')
  })

  it('replaces an existing single-input edge when a new source connects to the same target port', () => {
    const workflowWithSecondInput = {
      ...workflowFixture,
      nodes: [
        ...workflowFixture.nodes,
        {
          ...workflowFixture.nodes[0],
          node_id: 'input_text_2',
          position: { x: 120, y: 320 }
        }
      ]
    }
    const replacementConnection = {
      source: 'input_text_2',
      sourceHandle: 'text',
      target: 'send_email_notification',
      targetHandle: 'body'
    }

    expect(
      canConnect(replacementConnection, workflowWithSecondInput, nodeDefinitionFixture.node_definitions)
    ).toBe(true)

    const nextWorkflow = connectWorkflowNodes(
      workflowWithSecondInput,
      replacementConnection,
      nodeDefinitionFixture.node_definitions
    )

    expect(nextWorkflow.edges).toHaveLength(1)
    expect(nextWorkflow.edges[0].source_node_id).toBe('input_text_2')
    expect(nextWorkflow.edges[0].target_node_id).toBe('send_email_notification')
    expect(nextWorkflow.edges[0].target_port_id).toBe('body')
  })

  it('can still validate and connect implemented node types when a definition is missing', () => {
    const definitionsWithoutSendEmail = nodeDefinitionFixture.node_definitions.filter(
      (definition) => definition.type_id !== 'send_email'
    )
    const connection = {
      source: 'input_text',
      sourceHandle: 'text',
      target: 'send_email_notification',
      targetHandle: 'body'
    }

    expect(
      canConnect(connection, workflowFixture, definitionsWithoutSendEmail)
    ).toBe(true)

    const nextWorkflow = connectWorkflowNodes(
      {
        ...workflowFixture,
        edges: []
      },
      connection,
      definitionsWithoutSendEmail
    )

    expect(nextWorkflow.edges).toHaveLength(1)
    expect(nextWorkflow.edges[0].source_port_id).toBe('text')
    expect(nextWorkflow.edges[0].target_port_id).toBe('body')
  })

  it('allows table input to connect into table output and updates the sink shape', () => {
    const workflow = buildTableInputToTableOutputWorkflow()
    const connection = {
      source: 'table_input_runs',
      sourceHandle: 'table',
      target: 'table_output_copy',
      targetHandle: 'text'
    }

    expect(
      canConnect(connection, workflow, nodeDefinitionFixture.node_definitions)
    ).toBe(true)

    const nextWorkflow = connectWorkflowNodes(
      {
        ...workflow,
        edges: []
      },
      connection,
      nodeDefinitionFixture.node_definitions
    )

    expect(nextWorkflow.edges).toHaveLength(1)
    expect(nextWorkflow.edges[0].source_port_id).toBe('table')
    expect(nextWorkflow.edges[0].target_port_id).toBe('text')
    expect(
      nextWorkflow.nodes.find((node) => node.node_id === 'table_output_copy')?.config.input_shape
    ).toBe('source_table')
  })

  it('allows table schema to connect into table output and updates the sink shape', () => {
    const workflow = buildTableSchemaToTableOutputWorkflow()
    const connection = {
      source: 'table_schema_orders',
      sourceHandle: 'table',
      target: 'table_output_copy',
      targetHandle: 'text'
    }

    expect(
      canConnect(connection, workflow, nodeDefinitionFixture.node_definitions)
    ).toBe(true)

    const nextWorkflow = connectWorkflowNodes(
      {
        ...workflow,
        edges: []
      },
      connection,
      nodeDefinitionFixture.node_definitions
    )

    expect(nextWorkflow.edges).toHaveLength(1)
    expect(nextWorkflow.edges[0].source_port_id).toBe('table')
    expect(nextWorkflow.edges[0].target_port_id).toBe('text')
    expect(
      nextWorkflow.nodes.find((node) => node.node_id === 'table_output_copy')?.config.input_shape
    ).toBe('table_schema')
  })

  it('allows table merge to connect into table output and updates the sink shape', () => {
    const workflow = buildTableMergeToTableOutputWorkflow()
    const connection = {
      source: 'table_merge',
      sourceHandle: 'table',
      target: 'table_output_copy',
      targetHandle: 'text'
    }

    expect(
      canConnect(connection, workflow, nodeDefinitionFixture.node_definitions)
    ).toBe(true)

    const nextWorkflow = connectWorkflowNodes(
      {
        ...workflow,
        edges: workflow.edges.filter((edge) => edge.target_node_id !== 'table_output_copy')
      },
      connection,
      nodeDefinitionFixture.node_definitions
    )

    expect(nextWorkflow.edges).toHaveLength(workflow.edges.length + 1)
    expect(
      nextWorkflow.nodes.find((node) => node.node_id === 'table_output_copy')?.config.input_shape
    ).toBe('source_table')
  })
});
