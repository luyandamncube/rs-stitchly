const BUILTIN_NODE_CARD_FALLBACKS = {
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
  }
}

const ICON_LABELS = {
  duration: 'D',
  label: 'T',
  logic: '</>',
  metric: '#',
  preview_output: 'O',
  sparkles: 'O',
  status: 'S',
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
      char_count: typeof node?.config?.text === 'string' ? node.config.text.length : 0
    }
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
