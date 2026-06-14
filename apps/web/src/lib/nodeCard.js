const BUILTIN_NODE_CARD_FALLBACKS = {
  send_email: {
    variant: 'output',
    icon_key: 'send_email',
    top_chip: {
      visible: true,
      text: 'Notify'
    },
    header: {
      title_source: 'instance_label_or_display_name',
      show_overflow_menu: true
    },
    rows: [
      {
        row_id: 'recipient',
        kind: 'kv',
        label: 'To',
        value: { source: 'config', path: 'to' },
        formatter: 'text',
        icon_key: 'label',
        truncate: false
      },
      {
        row_id: 'subject',
        kind: 'text_block',
        label: 'Subject',
        value: { source: 'config', path: 'subject' },
        formatter: 'text',
        truncate: true
      }
    ],
    footer: {
      kind: 'metric',
      label: 'Last send',
      value: { source: 'runtime', path: 'last_status' },
      formatter: 'status',
      icon_key: 'status'
    },
    handles: {
      input_layout: 'single_left',
      output_layout: 'none',
      show_labels: 'never',
      align_to_rows: true
    },
    size: {
      width: 392,
      density: 'comfortable'
    }
  },
  text_input: {
    variant: 'trigger',
    icon_key: 'text_input',
    top_chip: {
      visible: true,
      text: 'Start'
    },
    header: {
      title_source: 'instance_label_or_display_name',
      show_overflow_menu: true
    },
    rows: [
      {
        row_id: 'text_value',
        kind: 'text_block',
        label: 'Text',
        value: { source: 'config', path: 'text' },
        formatter: 'text',
        truncate: true
      },
      {
        row_id: 'char_count',
        kind: 'kv',
        label: 'Length',
        value: { source: 'derived', path: 'char_count' },
        formatter: 'text',
        icon_key: 'metric',
        truncate: false
      }
    ],
    footer: {
      kind: 'metric',
      label: 'Last run',
      value: { source: 'runtime', path: 'last_status' },
      formatter: 'status',
      icon_key: 'status'
    },
    handles: {
      input_layout: 'none',
      output_layout: 'single_right',
      show_labels: 'never',
      align_to_rows: true
    },
    size: {
      width: 320,
      density: 'comfortable'
    }
  },
  text_transform: {
    variant: 'compute',
    icon_key: 'text_transform',
    top_chip: {
      visible: false
    },
    header: {
      title_source: 'instance_label_or_display_name',
      show_overflow_menu: true
    },
    rows: [
      {
        row_id: 'operation',
        kind: 'kv',
        label: 'Operation',
        value: { source: 'config', path: 'operation' },
        formatter: 'text',
        icon_key: 'logic',
        truncate: false
      },
      {
        row_id: 'preview',
        kind: 'text_block',
        label: 'Input',
        value: { source: 'runtime', path: 'last_input_preview' },
        formatter: 'text',
        truncate: true
      }
    ],
    footer: {
      kind: 'metric',
      label: 'Duration',
      value: { source: 'runtime', path: 'last_duration_ms' },
      formatter: 'duration_ms',
      icon_key: 'duration'
    },
    handles: {
      input_layout: 'single_left',
      output_layout: 'single_right',
      show_labels: 'never',
      align_to_rows: true
    },
    size: {
      width: 340,
      density: 'comfortable'
    }
  },
  preview_output: {
    variant: 'output',
    icon_key: 'preview_output',
    top_chip: {
      visible: true,
      text: 'Output'
    },
    header: {
      title_source: 'instance_label_or_display_name',
      show_overflow_menu: true
    },
    rows: [
      {
        row_id: 'title',
        kind: 'kv',
        label: 'Title',
        value: { source: 'config', path: 'title' },
        formatter: 'text',
        icon_key: 'label',
        truncate: false
      },
      {
        row_id: 'preview_text',
        kind: 'text_block',
        label: 'Preview',
        value: { source: 'runtime', path: 'last_output_preview' },
        formatter: 'text',
        truncate: true
      }
    ],
    footer: {
      kind: 'metric',
      label: 'Last emit',
      value: { source: 'runtime', path: 'last_status' },
      formatter: 'status',
      icon_key: 'status'
    },
    handles: {
      input_layout: 'single_left',
      output_layout: 'none',
      show_labels: 'never',
      align_to_rows: true
    },
    size: {
      width: 332,
      density: 'comfortable'
    }
  },
  checkpoint_read: {
    variant: 'compute',
    icon_key: 'checkpoint_read',
    top_chip: {
      visible: false,
      text: null
    },
    header: {
      title_source: 'instance_label_or_display_name',
      show_overflow_menu: true
    },
    rows: [
      {
        row_id: 'source_repo',
        kind: 'kv',
        label: 'Repo',
        value: { source: 'config', path: 'source_repo' },
        formatter: 'text',
        icon_key: 'label',
        truncate: false
      },
      {
        row_id: 'branch',
        kind: 'kv',
        label: 'Branch',
        value: { source: 'config', path: 'branch' },
        formatter: 'text',
        icon_key: 'status',
        truncate: false
      }
    ],
    footer: {
      kind: 'metric',
      label: 'Checkpoint store',
      value: { source: 'config', path: 'checkpoint_table' },
      formatter: 'text',
      icon_key: 'metric'
    },
    handles: {
      input_layout: 'none',
      output_layout: 'single_right',
      show_labels: 'never',
      align_to_rows: true
    },
    size: {
      width: 336,
      density: 'comfortable'
    }
  },
  checkpoint_write: {
    variant: 'compute',
    icon_key: 'checkpoint_write',
    top_chip: {
      visible: false,
      text: null
    },
    header: {
      title_source: 'instance_label_or_display_name',
      show_overflow_menu: true
    },
    rows: [
      {
        row_id: 'checkpoint_table',
        kind: 'kv',
        label: 'Checkpoint',
        value: { source: 'config', path: 'checkpoint_table' },
        formatter: 'text',
        icon_key: 'metric',
        truncate: false
      },
      {
        row_id: 'write_timing',
        kind: 'kv',
        label: 'Timing',
        value: { source: 'config', path: 'write_timing' },
        formatter: 'text',
        icon_key: 'status',
        truncate: false
      }
    ],
    footer: {
      kind: 'metric',
      label: 'Commit source',
      value: { source: 'config', path: 'commit_source' },
      formatter: 'text',
      icon_key: 'logic'
    },
    handles: {
      input_layout: 'single_left',
      output_layout: 'single_right',
      show_labels: 'never',
      align_to_rows: true
    },
    size: {
      width: 336,
      density: 'comfortable'
    }
  },
  quality_check: {
    variant: 'compute',
    icon_key: 'quality_check',
    top_chip: {
      visible: false,
      text: null
    },
    header: {
      title_source: 'instance_label_or_display_name',
      show_overflow_menu: true
    },
    rows: [
      {
        row_id: 'suite_preset',
        kind: 'kv',
        label: 'Suite',
        value: { source: 'config', path: 'suite_preset' },
        formatter: 'text',
        icon_key: 'logic',
        truncate: false
      },
      {
        row_id: 'warning_budget',
        kind: 'kv',
        label: 'Budget',
        value: { source: 'config', path: 'warning_budget' },
        formatter: 'text',
        icon_key: 'metric',
        truncate: false
      }
    ],
    footer: {
      kind: 'metric',
      label: 'Gate',
      value: { source: 'config', path: 'block_checkpoint_write_on_failure' },
      formatter: 'text',
      icon_key: 'status'
    },
    handles: {
      input_layout: 'single_left',
      output_layout: 'single_right',
      show_labels: 'never',
      align_to_rows: true
    },
    size: {
      width: 336,
      density: 'comfortable'
    }
  },
  table_output: {
    variant: 'output',
    icon_key: 'table_output',
    top_chip: {
      visible: true,
      text: 'Persist'
    },
    header: {
      title_source: 'instance_label_or_display_name',
      show_overflow_menu: true
    },
    rows: [
      {
        row_id: 'target_schema',
        kind: 'kv',
        label: 'Schema',
        value: { source: 'config', path: 'target_schema' },
        formatter: 'text',
        icon_key: 'table_output',
        truncate: false
      },
      {
        row_id: 'table_name',
        kind: 'kv',
        label: 'Table',
        value: { source: 'config', path: 'table_name' },
        formatter: 'text',
        icon_key: 'label',
        truncate: false
      },
      {
        row_id: 'write_mode',
        kind: 'kv',
        label: 'Mode',
        value: { source: 'config', path: 'write_mode' },
        formatter: 'text',
        icon_key: 'logic',
        truncate: false
      }
    ],
    footer: {
      kind: 'metric',
      label: 'Last write',
      value: { source: 'runtime', path: 'last_status' },
      formatter: 'status',
      icon_key: 'status'
    },
    handles: {
      input_layout: 'single_left',
      output_layout: 'none',
      show_labels: 'never',
      align_to_rows: true
    },
    size: {
      width: 336,
      density: 'comfortable'
    }
  },
  table_merge: {
    variant: 'compute',
    icon_key: 'logic',
    top_chip: {
      visible: false,
      text: null
    },
    header: {
      title_source: 'instance_label_or_display_name',
      show_overflow_menu: true
    },
    rows: [
      {
        row_id: 'write_policy',
        kind: 'kv',
        label: 'Policy',
        value: { source: 'config', path: 'write_policy' },
        formatter: 'text',
        icon_key: 'logic',
        truncate: false
      },
      {
        row_id: 'target_schema',
        kind: 'kv',
        label: 'Target',
        value: { source: 'config', path: 'target_schema' },
        formatter: 'text',
        icon_key: 'table_output',
        truncate: false
      }
    ],
    footer: {
      kind: 'metric',
      label: 'Delete handling',
      value: { source: 'config', path: 'delete_handling' },
      formatter: 'text',
      icon_key: 'status'
    },
    handles: {
      input_layout: 'single_left',
      output_layout: 'single_right',
      show_labels: 'never',
      align_to_rows: true
    },
    size: {
      width: 336,
      density: 'comfortable'
    }
  },
  sql_transform: {
    variant: 'compute',
    icon_key: 'logic',
    top_chip: {
      visible: false,
      text: null
    },
    header: {
      title_source: 'instance_label_or_display_name',
      show_overflow_menu: true
    },
    rows: [
      {
        row_id: 'materialization_mode',
        kind: 'kv',
        label: 'Mode',
        value: { source: 'config', path: 'materialization_mode' },
        formatter: 'text',
        icon_key: 'logic',
        truncate: false
      },
      {
        row_id: 'target_schema',
        kind: 'kv',
        label: 'Target',
        value: { source: 'config', path: 'target_schema' },
        formatter: 'text',
        icon_key: 'table_output',
        truncate: false
      }
    ],
    footer: {
      kind: 'metric',
      label: 'Output',
      value: { source: 'config', path: 'output_table_name' },
      formatter: 'text',
      icon_key: 'status'
    },
    handles: {
      input_layout: 'single_left',
      output_layout: 'single_right',
      show_labels: 'never',
      align_to_rows: true
    },
    size: {
      width: 336,
      density: 'comfortable'
    }
  },
  table_input: {
    variant: 'input',
    icon_key: 'table_output',
    top_chip: {
      visible: false,
      text: null
    },
    header: {
      title_source: 'instance_label_or_display_name',
      show_overflow_menu: true
    },
    rows: [
      {
        row_id: 'schema_name',
        kind: 'kv',
        label: 'Schema',
        value: { source: 'config', path: 'schema_name' },
        formatter: 'text',
        icon_key: 'table_output',
        truncate: false
      },
      {
        row_id: 'table_name',
        kind: 'kv',
        label: 'Table',
        value: { source: 'config', path: 'table_name' },
        formatter: 'text',
        icon_key: 'label',
        truncate: false
      }
    ],
    footer: {
      kind: 'metric',
      label: 'Catalog',
      value: { source: 'config', path: 'catalog' },
      formatter: 'text',
      icon_key: 'status'
    },
    handles: {
      input_layout: 'none',
      output_layout: 'single_right',
      show_labels: 'never',
      align_to_rows: true
    },
    size: {
      width: 336,
      density: 'comfortable'
    }
  }
}

const ICON_LABELS = {
  dolt_change_manifest: 'd',
  dolt_diff_export: 'd',
  dolt_dump: 'd',
  dolt_repo_source: 'd',
  dolt_repo_sync: 'd',
  duration: 'D',
  email: '@',
  label: 'T',
  logic: '</>',
  metric: '#',
  checkpoint_read: 'R',
  checkpoint_write: 'W',
  quality_check: 'Q',
  preview_output: 'O',
  send_email: '@',
  sparkles: 'O',
  status: 'S',
  sql_transform: 'SQL',
  table_merge: 'G',
  table_input: '[]',
  table_output: '[]',
  text_input: 'T',
  text_transform: '</>',
  type: 'T',
  wand: '</>'
}

export function getNodeCardDefinition(definition) {
  if (!definition) {
    return null
  }

  return definition.ui?.node_card ?? BUILTIN_NODE_CARD_FALLBACKS[definition.type_id] ?? buildGenericNodeCard(definition)
}

export function getNodeCardWidth(definition) {
  const nodeCard = getNodeCardDefinition(definition)
  return nodeCard?.size?.width ?? definition?.ui?.default_width ?? 320
}

export function buildNodeCardModel({ workflow, node, definition, nodeDefinitions }) {
  const nodeCard = getNodeCardDefinition(definition)
  const context = buildNodeCardContext({ workflow, node, nodeDefinitions })
  const rows = (nodeCard?.rows?.length ? nodeCard.rows : buildFallbackRows(definition)).map((row) =>
    renderNodeCardRow(row, context)
  )
  const footer = nodeCard?.footer
    ? renderNodeCardMetric(nodeCard.footer, context)
    : renderFallbackFooter(definition)

  return {
    title: resolveNodeCardTitle(nodeCard?.header?.title_source, node, definition),
    variant: nodeCard?.variant ?? definition?.category ?? 'node',
    topChip:
      nodeCard?.top_chip?.visible && nodeCard.top_chip.text
        ? nodeCard.top_chip.text
        : null,
    iconLabel: resolveIconLabel(nodeCard?.icon_key ?? definition?.ui?.icon ?? definition?.display_name),
    showOverflowMenu: nodeCard?.header?.show_overflow_menu ?? false,
    rows,
    footer,
    handles: {
      inputs: buildHandleDescriptors(
        definition?.inputs ?? [],
        nodeCard?.handles?.input_layout ?? fallbackInputLayout(definition)
      ),
      outputs: buildHandleDescriptors(
        definition?.outputs ?? [],
        nodeCard?.handles?.output_layout ?? fallbackOutputLayout(definition)
      )
    }
  }
}

function buildGenericNodeCard(definition) {
  return {
    variant: definition?.category ?? 'node',
    icon_key: definition?.ui?.icon ?? definition?.display_name?.[0] ?? 'N',
    top_chip: {
      visible: false
    },
    header: {
      title_source: 'instance_label_or_display_name',
      show_overflow_menu: true
    },
    rows: buildFallbackRows(definition),
    footer: null,
    handles: {
      input_layout: fallbackInputLayout(definition),
      output_layout: fallbackOutputLayout(definition),
      show_labels: 'never',
      align_to_rows: false
    },
    size: {
      width: definition?.ui?.default_width ?? 320,
      density: 'comfortable'
    }
  }
}

function buildFallbackRows(definition) {
  return [
    {
      row_id: 'description',
      kind: 'text_block',
      label: humanizeToken(definition?.category ?? 'node'),
      value: {
        source: 'literal',
        path: definition?.description ?? 'Ready to configure'
      },
      formatter: 'text',
      truncate: true
    }
  ]
}

function renderFallbackFooter(definition) {
  return {
    kind: 'metric',
    label: 'Ports',
    value: `${definition?.inputs?.length ?? 0} in / ${definition?.outputs?.length ?? 0} out`,
    iconLabel: '#'
  }
}

function renderNodeCardRow(row, context) {
  return {
    id: row.row_id,
    kind: row.kind ?? 'kv',
    label: row.label ?? 'Field',
    value: formatBoundValue(resolveNodeCardValue(row.value, context), row.formatter),
    iconLabel: row.icon_key ? resolveIconLabel(row.icon_key) : null,
    truncate: row.truncate ?? false
  }
}

function renderNodeCardMetric(metric, context) {
  return {
    kind: metric.kind ?? 'metric',
    label: metric.label ?? 'Metric',
    value: formatBoundValue(resolveNodeCardValue(metric.value, context), metric.formatter),
    iconLabel: metric.icon_key ? resolveIconLabel(metric.icon_key) : null
  }
}

function resolveNodeCardTitle(titleSource, node, definition) {
  if (titleSource === 'display_name') {
    return definition?.display_name ?? node?.type_id ?? 'Node'
  }

  if (titleSource === 'instance_label') {
    return node?.label ?? node?.node_id ?? definition?.display_name ?? 'Node'
  }

  return node?.label ?? definition?.display_name ?? node?.node_id ?? 'Node'
}

function resolveNodeCardValue(binding, context) {
  if (!binding) {
    return null
  }

  if (binding.source === 'literal') {
    return binding.path ?? null
  }

  const sourceValue = context[binding.source]
  return getByPath(sourceValue, binding.path)
}

function formatBoundValue(value, formatter) {
  if (formatter === 'duration_ms') {
    return typeof value === 'number' ? `${(value / 1000).toFixed(1)}s` : '--'
  }

  if (formatter === 'status') {
    return value ? humanizeToken(String(value)) : 'Idle'
  }

  if (formatter === 'json_preview') {
    return value == null ? '--' : JSON.stringify(value)
  }

  if (value == null || value === '') {
    return '--'
  }

  return typeof value === 'string' ? value : String(value)
}

function buildNodeCardContext({ workflow, node, nodeDefinitions }) {
  const previewResolver = createTextPreviewResolver(workflow, nodeDefinitions)
  const doltRepoCard = buildDoltRepoCardDerivedValues(node?.config ?? {})
  const doltRepoSyncCard = buildDoltRepoSyncCardDerivedValues(
    workflow,
    node?.node_id,
    node?.config ?? {}
  )
  const doltChangeManifestCard = buildDoltChangeManifestCardDerivedValues(
    workflow,
    node?.node_id,
    node?.config ?? {}
  )
  const doltDiffExportCard = buildDoltDiffExportCardDerivedValues(
    workflow,
    node?.node_id,
    node?.config ?? {}
  )
  const loadToDuckDbCard = buildLoadToDuckDbCardDerivedValues(
    workflow,
    node?.node_id
  )

  return {
    config: node?.config ?? {},
    instance: {
      label: node?.label ?? null,
      node_id: node?.node_id ?? null,
      type_id: node?.type_id ?? null
    },
    runtime: {
      last_duration_ms: null,
      last_input_preview: previewResolver.resolveInputPreview(node?.node_id),
      last_output_preview: previewResolver.resolveOutputPreview(node?.node_id),
      last_status: 'idle'
    },
    derived: {
      char_count: typeof node?.config?.text === 'string' ? node.config.text.length : 0,
      dolt_current_commit: doltRepoCard.currentCommit,
      dolt_repo_family: doltRepoCard.repoFamily,
      dolt_sync_strategy: doltRepoCard.syncStrategy,
      dolt_sync_action: doltRepoSyncCard.syncAction,
      dolt_sync_current_commit: doltRepoSyncCard.currentCommit,
      dolt_sync_previous_commit: doltRepoSyncCard.previousCommit,
      dolt_manifest_range: doltChangeManifestCard.range,
      dolt_manifest_scope: doltChangeManifestCard.scope,
      dolt_manifest_schema_drift: doltChangeManifestCard.schemaDrift,
      dolt_diff_bundle: doltDiffExportCard.bundle,
      dolt_diff_filter: doltDiffExportCard.filter,
      dolt_diff_range: doltDiffExportCard.range,
      load_bundle_mode: loadToDuckDbCard.bundleMode,
      load_merge_context: loadToDuckDbCard.mergeContext
    }
  }
}

function buildDoltRepoCardDerivedValues(config = {}) {
  const repository = typeof config.repository === 'string' ? config.repository.trim() : ''
  const checkoutRef =
    typeof config.checkout_ref === 'string' && config.checkout_ref.trim()
      ? config.checkout_ref.trim()
      : null
  const profile = resolveMockDoltRepoCardProfile(repository)
  const currentCommit = checkoutRef
    ? checkoutRef.slice(0, 12)
    : profile?.currentCommit ?? 'pending_sync'

  return {
    currentCommit,
    repoFamily: profile?.repoFamily ?? deriveDoltRepoFamily(repository),
    syncStrategy: humanizeToken(
      config.sync_strategy === 'clone_only' || config.sync_strategy === 'manual'
        ? config.sync_strategy
        : 'pull_before_execution'
    )
  }
}

function resolveMockDoltRepoCardProfile(repository) {
  switch (repository) {
    case 'post-no-preference/earnings':
      return {
        repoFamily: 'earnings',
        previousCommit: '92fd7ac',
        currentCommit: 'a34ef9c'
      }
    case 'post-no-preference/options':
      return {
        repoFamily: 'options',
        previousCommit: 'ac31f0b',
        currentCommit: 'b91c2aa'
      }
    case 'post-no-preference/rates':
      return {
        repoFamily: 'rates',
        previousCommit: 'c83f10d',
        currentCommit: 'd0f61b4'
      }
    default:
      return null
  }
}

function buildDoltRepoSyncCardDerivedValues(workflow, nodeId, config = {}) {
  const sourceConfig = resolveConnectedDoltRepoSourceCardConfig(workflow, nodeId)
  const repository =
    typeof sourceConfig?.repository === 'string' && sourceConfig.repository.trim()
      ? sourceConfig.repository.trim()
      : 'post-no-preference/earnings'
  const profile = resolveMockDoltRepoCardProfile(repository)
  const checkoutRef =
    typeof sourceConfig?.checkout_ref === 'string' && sourceConfig.checkout_ref.trim()
      ? sourceConfig.checkout_ref.trim()
      : ''
  const syncAction =
    config?.sync_action === 'fetch_and_checkout' || config?.sync_action === 'refresh_checkout'
      ? config.sync_action
      : 'pull_remote_head'

  return {
    currentCommit: checkoutRef
      ? checkoutRef.slice(0, 12)
      : profile?.currentCommit ?? 'pending_sync',
    previousCommit: profile?.previousCommit ?? 'pending_checkpoint',
    syncAction: humanizeToken(syncAction)
  }
}

function buildDoltChangeManifestCardDerivedValues(workflow, nodeId, config = {}) {
  const syncContext = resolveConnectedDoltRepoSyncCardContext(workflow, nodeId)
  const sourceConfig = syncContext?.sourceConfig ?? null
  const repository =
    typeof sourceConfig?.repository === 'string' && sourceConfig.repository.trim()
      ? sourceConfig.repository.trim()
      : 'post-no-preference/earnings'
  const repoProfile = resolveMockDoltRepoCardProfile(repository)
  const manifestProfile = resolveMockDoltChangeManifestProfile(repository)
  const checkoutRef =
    typeof sourceConfig?.checkout_ref === 'string' && sourceConfig.checkout_ref.trim()
      ? sourceConfig.checkout_ref.trim()
      : ''
  const previousCommit = repoProfile?.previousCommit ?? 'pending_checkpoint'
  const currentCommit = checkoutRef
    ? checkoutRef.slice(0, 12)
    : repoProfile?.currentCommit ?? 'pending_sync'
  const selectedTables = normalizeSelectedTableNames(config?.selected_tables)
  const tableScope = config?.table_scope === 'allowlist' ? 'allowlist' : 'all_tables'
  const changedTables = filterManifestTablesForScope(
    manifestProfile?.changedTables ?? [],
    tableScope,
    selectedTables
  )
  const schemaFlags = filterManifestTablesForScope(
    manifestProfile?.schemaChangedTables ?? [],
    tableScope,
    selectedTables
  )

  return {
    range: `${previousCommit} -> ${currentCommit}`,
    scope:
      tableScope === 'allowlist'
        ? selectedTables.length > 0
          ? `${selectedTables.length} selected`
          : 'selected tables'
        : 'all tables',
    schemaDrift:
      schemaFlags.length > 0
        ? `${schemaFlags.length} table${schemaFlags.length === 1 ? '' : 's'} flagged`
        : changedTables.length > 0
          ? 'no drift'
          : 'pending scope'
  }
}

function buildDoltDiffExportCardDerivedValues(workflow, nodeId, config = {}) {
  const manifestContext = resolveConnectedDoltDiffExportCardContext(workflow, nodeId)
  const repository =
    typeof manifestContext?.sourceConfig?.repository === 'string' &&
    manifestContext.sourceConfig.repository.trim()
      ? manifestContext.sourceConfig.repository.trim()
      : 'post-no-preference/earnings'
  const repoProfile = resolveMockDoltRepoCardProfile(repository)
  const checkoutRef =
    typeof manifestContext?.sourceConfig?.checkout_ref === 'string' &&
    manifestContext.sourceConfig.checkout_ref.trim()
      ? manifestContext.sourceConfig.checkout_ref.trim()
      : ''
  const previousCommit = repoProfile?.previousCommit ?? 'pending_checkpoint'
  const currentCommit = checkoutRef
    ? checkoutRef.slice(0, 12)
    : repoProfile?.currentCommit ?? 'pending_sync'

  return {
    bundle: 'directory_ref',
    filter: describeDoltDiffExportChangeFilter(config?.change_filter),
    range: `${previousCommit} -> ${currentCommit}`
  }
}

function buildLoadToDuckDbCardDerivedValues(workflow, nodeId) {
  const inputEdge = workflow?.edges?.find(
    (edge) => edge.target_node_id === nodeId && edge.target_port_id === 'bundle'
  )
  const sourceNode = workflow?.nodes?.find(
    (node) => node.node_id === inputEdge?.source_node_id
  )

  if (sourceNode?.type_id === 'dolt_diff_export') {
    const diffCard = buildDoltDiffExportCardDerivedValues(
      workflow,
      sourceNode.node_id,
      sourceNode.config ?? {}
    )
    return {
      bundleMode: 'delta bundle',
      mergeContext: diffCard.range
    }
  }

  if (sourceNode?.type_id === 'dolt_dump') {
    const dumpContext = resolveConnectedDoltDumpCardContext(workflow, sourceNode.node_id)
    const repository =
      typeof dumpContext?.sourceConfig?.repository === 'string' &&
      dumpContext.sourceConfig.repository.trim()
        ? dumpContext.sourceConfig.repository.trim()
        : 'post-no-preference/earnings'
    const profile = resolveMockDoltRepoCardProfile(repository)
    const checkoutRef =
      typeof dumpContext?.sourceConfig?.checkout_ref === 'string' &&
      dumpContext.sourceConfig.checkout_ref.trim()
        ? dumpContext.sourceConfig.checkout_ref.trim()
        : ''

    return {
      bundleMode: 'snapshot bundle',
      mergeContext: checkoutRef
        ? checkoutRef.slice(0, 12)
        : profile?.currentCommit ?? 'pending_sync'
    }
  }

  return {
    bundleMode: 'dump + diff aware',
    mergeContext: 'load manifest'
  }
}

function resolveConnectedDoltRepoSourceCardConfig(workflow, nodeId) {
  if (!workflow || !nodeId) {
    return null
  }

  const incomingEdge = workflow.edges?.find(
    (edge) => edge.target_node_id === nodeId && edge.target_port_id === 'repo'
  )
  if (!incomingEdge) {
    return null
  }

  const sourceNode = workflow.nodes?.find(
    (node) =>
      node.node_id === incomingEdge.source_node_id && node.type_id === 'dolt_repo_source'
  )

  return sourceNode?.config ?? null
}

function resolveConnectedDoltRepoSyncCardContext(workflow, nodeId) {
  if (!workflow || !nodeId) {
    return null
  }

  const incomingEdge = workflow.edges?.find(
    (edge) => edge.target_node_id === nodeId && edge.target_port_id === 'repo'
  )
  if (!incomingEdge) {
    return null
  }

  const syncNode = workflow.nodes?.find(
    (node) =>
      node.node_id === incomingEdge.source_node_id && node.type_id === 'dolt_repo_sync'
  )
  if (!syncNode) {
    return null
  }

  return {
    sourceConfig: resolveConnectedDoltRepoSourceCardConfig(workflow, syncNode.node_id),
    syncConfig: syncNode.config ?? {}
  }
}

function resolveConnectedDoltDumpCardContext(workflow, nodeId) {
  if (!workflow || !nodeId) {
    return null
  }

  const incomingEdge = workflow.edges?.find(
    (edge) => edge.target_node_id === nodeId && edge.target_port_id === 'repo'
  )
  if (!incomingEdge) {
    return null
  }

  const sourceNode = workflow.nodes?.find((node) => node.node_id === incomingEdge.source_node_id)
  if (!sourceNode) {
    return null
  }

  if (sourceNode.type_id === 'dolt_repo_source') {
    return {
      sourceConfig: sourceNode.config ?? null
    }
  }

  if (sourceNode.type_id === 'dolt_repo_sync') {
    return {
      sourceConfig: resolveConnectedDoltRepoSourceCardConfig(workflow, sourceNode.node_id)
    }
  }

  if (sourceNode.type_id === 'dolt_change_manifest') {
    return {
      sourceConfig: resolveConnectedDoltRepoSyncCardContext(workflow, sourceNode.node_id)
        ?.sourceConfig ?? null
    }
  }

  return null
}

function resolveConnectedDoltDiffExportCardContext(workflow, nodeId) {
  if (!workflow || !nodeId) {
    return null
  }

  const incomingEdge = workflow.edges?.find(
    (edge) => edge.target_node_id === nodeId && edge.target_port_id === 'manifest'
  )
  if (!incomingEdge) {
    return null
  }

  const manifestNode = workflow.nodes?.find(
    (node) =>
      node.node_id === incomingEdge.source_node_id && node.type_id === 'dolt_change_manifest'
  )
  if (!manifestNode) {
    return null
  }

  return {
    manifestConfig: manifestNode.config ?? {},
    sourceConfig: resolveConnectedDoltRepoSyncCardContext(workflow, manifestNode.node_id)
      ?.sourceConfig ?? null
  }
}

function resolveMockDoltChangeManifestProfile(repository) {
  switch (repository) {
    case 'post-no-preference/earnings':
      return {
        changedTables: ['earnings_calendar', 'eps_history', 'income_statement'],
        schemaChangedTables: ['income_statement']
      }
    case 'post-no-preference/options':
      return {
        changedTables: ['option_chain', 'volatility_history'],
        schemaChangedTables: []
      }
    case 'post-no-preference/rates':
      return {
        changedTables: ['us_treasury'],
        schemaChangedTables: []
      }
    default:
      return null
  }
}

function normalizeSelectedTableNames(value) {
  if (Array.isArray(value)) {
    return [...new Set(value.map((entry) => (typeof entry === 'string' ? entry.trim() : '')).filter(Boolean))]
  }

  if (typeof value === 'string') {
    return [...new Set(value.split(',').map((entry) => entry.trim()).filter(Boolean))]
  }

  return []
}

function filterManifestTablesForScope(changedTables, tableScope, selectedTables) {
  if (tableScope !== 'allowlist') {
    return [...changedTables]
  }

  if (selectedTables.length === 0) {
    return []
  }

  const selectedSet = new Set(selectedTables)
  return changedTables.filter((tableName) => selectedSet.has(tableName))
}

function deriveDoltRepoFamily(repository) {
  if (!repository) {
    return 'repo'
  }

  const segments = repository
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean)

  return segments[segments.length - 1] ?? 'repo'
}

function describeDoltDiffExportChangeFilter(changeFilter) {
  switch (changeFilter) {
    case 'non_delete_changes':
      return 'Non-delete changes'
    case 'added_only':
      return 'Added only'
    case 'modified_only':
      return 'Modified only'
    case 'removed_only':
      return 'Removed only'
    default:
      return 'All changes'
  }
}

function createTextPreviewResolver(workflow, nodeDefinitions) {
  const nodeById = Object.fromEntries((workflow?.nodes ?? []).map((node) => [node.node_id, node]))
  const definitionByTypeId = Object.fromEntries(
    (nodeDefinitions ?? []).map((definition) => [definition.type_id, definition])
  )
  const incomingEdgeByNodeId = new Map()
  const memo = new Map()
  const active = new Set()

  for (const edge of workflow?.edges ?? []) {
    if (!incomingEdgeByNodeId.has(edge.target_node_id)) {
      incomingEdgeByNodeId.set(edge.target_node_id, [])
    }

    incomingEdgeByNodeId.get(edge.target_node_id).push(edge)
  }

  function resolveNodeOutput(nodeId) {
    if (!nodeId) {
      return ''
    }

    if (memo.has(nodeId)) {
      return memo.get(nodeId)
    }

    if (active.has(nodeId)) {
      return ''
    }

    active.add(nodeId)

    const node = nodeById[nodeId]
    const definition = definitionByTypeId[node?.type_id]
    let nextValue = ''

    if (node && definition) {
      switch (node.type_id) {
        case 'text_input':
          nextValue = typeof node.config?.text === 'string' ? node.config.text : ''
          break
        case 'text_transform':
          nextValue = applyTextOperation(resolveInputPreview(nodeId, 'source'), node.config?.operation)
          break
        case 'preview_output':
          nextValue = resolveInputPreview(nodeId, 'text')
          break
        default:
          nextValue = definition.description ?? ''
      }
    }

    active.delete(nodeId)
    memo.set(nodeId, nextValue)
    return nextValue
  }

  function resolveInputPreview(nodeId, portId = null) {
    const incomingEdges = incomingEdgeByNodeId.get(nodeId) ?? []
    const matchingEdge = portId
      ? incomingEdges.find((edge) => edge.target_port_id === portId)
      : incomingEdges[0]

    return matchingEdge ? resolveNodeOutput(matchingEdge.source_node_id) : ''
  }

  return {
    resolveInputPreview,
    resolveOutputPreview: resolveNodeOutput
  }
}

function applyTextOperation(value, operation) {
  const text = typeof value === 'string' ? value : ''

  if (operation === 'uppercase') {
    return text.toUpperCase()
  }

  if (operation === 'trim') {
    return text.trim()
  }

  return text
}

function buildHandleDescriptors(ports, layout) {
  if (!ports.length || layout === 'none') {
    return []
  }

  const offsets = buildHandleOffsets(ports.length, layout)

  return ports.map((port, index) => ({
    id: port.port_id,
    label: port.display_name,
    top: `${offsets[index] ?? 50}%`
  }))
}

function buildHandleOffsets(count, layout) {
  if (count <= 1) {
    return [50]
  }

  const start = layout === 'branch_right' ? 38 : 34
  const end = layout === 'branch_right' ? 74 : 66
  const step = (end - start) / Math.max(count - 1, 1)

  return Array.from({ length: count }, (_, index) => Number((start + index * step).toFixed(2)))
}

function fallbackInputLayout(definition) {
  return definition?.inputs?.length ? (definition.inputs.length > 1 ? 'multi_left' : 'single_left') : 'none'
}

function fallbackOutputLayout(definition) {
  return definition?.outputs?.length ? (definition.outputs.length > 1 ? 'multi_right' : 'single_right') : 'none'
}

function resolveIconLabel(iconKey) {
  if (!iconKey) {
    return 'N'
  }

  return ICON_LABELS[iconKey] ?? String(iconKey).slice(0, 1).toUpperCase()
}

function getByPath(value, path) {
  if (!path) {
    return value
  }

  return String(path)
    .split('.')
    .reduce((current, segment) => (current == null ? undefined : current[segment]), value)
}

function humanizeToken(value) {
  return String(value ?? '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (character) => character.toUpperCase())
}
