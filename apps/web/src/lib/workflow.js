import { buildNodeCardModel, getNodeCardWidth } from './nodeCard'

export function cloneWorkflow(workflow) {
  return structuredClone(workflow)
}

export function createCanvasElements(
  workflow,
  nodeDefinitions,
  selectedNodeId,
  hoveredNodeId = null,
  selectedEdgeId = null,
  runtimeSnapshot = null
) {
  return {
    nodes: workflow.nodes.map((node) => {
      const definition = resolveNodeDefinition(node, nodeDefinitions)

      return {
        id: node.node_id,
        type: resolveCanvasNodeType(node.type_id),
        position: node.position,
        selected: node.node_id === selectedNodeId,
        data: {
          label: node.label ?? definition?.display_name ?? node.type_id,
          definition,
          node,
          uiState: {
            interaction: {
              hovered: node.node_id === hoveredNodeId
            },
            runtime: buildNodeRuntimeUiState(runtimeSnapshot, node.node_id)
          },
          typeId: node.type_id,
          workflow,
          card: buildNodeCardModel({
            workflow,
            node,
            definition,
            nodeDefinitions
          })
        },
        style: {
          background: 'transparent',
          border: 'none',
          width: getNodeCardWidth(definition)
        }
      }
    }),
    edges: workflow.edges.map((edge) => ({
      className: edgeRuntimeClassName(runtimeSnapshot, edge),
      id: edge.edge_id,
      selected: edge.edge_id === selectedEdgeId,
      source: edge.source_node_id,
      sourceHandle: edge.source_port_id,
      style: edgeRuntimeStyle(runtimeSnapshot, edge),
      target: edge.target_node_id,
      targetHandle: edge.target_port_id
    }))
  }
}

function buildNodeRuntimeUiState(runtimeSnapshot, nodeId) {
  if (!runtimeSnapshot) {
    return null
  }

  const nodeRun = runtimeSnapshot.node_runs?.find((candidate) => candidate.node_id === nodeId)
  if (!nodeRun) {
    return {
      status: null,
      workflowStatus: normalizeDataType(runtimeSnapshot.status)
    }
  }

  return {
    attempt: nodeRun.attempt ?? 0,
    error: nodeRun.error ?? null,
    finishedAt: nodeRun.finished_at ?? null,
    lastOutput: nodeRun.last_output ?? null,
    logCount: nodeRun.log_count ?? 0,
    startedAt: nodeRun.started_at ?? null,
    status: normalizeDataType(nodeRun.status),
    workflowStatus: normalizeDataType(runtimeSnapshot.status)
  }
}

function edgeRuntimeClassName(runtimeSnapshot, edge) {
  const status = edgeRuntimeStatus(runtimeSnapshot, edge)
  return status ? `workflow-edge--${status}` : ''
}

function edgeRuntimeStyle(runtimeSnapshot, edge) {
  const status = edgeRuntimeStatus(runtimeSnapshot, edge)

  if (status === 'succeeded') {
    return {
      stroke: 'rgba(121, 199, 139, 0.72)',
      strokeWidth: 1.6
    }
  }

  return undefined
}

function edgeRuntimeStatus(runtimeSnapshot, edge) {
  if (!runtimeSnapshot) {
    return null
  }

  const sourceStatus = nodeRunStatus(runtimeSnapshot, edge.source_node_id)
  const targetStatus = nodeRunStatus(runtimeSnapshot, edge.target_node_id)

  if (sourceStatus === 'succeeded' && targetStatus === 'succeeded') {
    return 'succeeded'
  }

  return null
}

function nodeRunStatus(runtimeSnapshot, nodeId) {
  return normalizeDataType(
    runtimeSnapshot.node_runs?.find((candidate) => candidate.node_id === nodeId)?.status
  )
}

export function connectWorkflowNodes(workflow, connection, nodeDefinitions = []) {
  if (!connection.source || !connection.target || !connection.sourceHandle || !connection.targetHandle) {
    return workflow
  }

  const duplicateEdge = workflow.edges.find(
    (edge) =>
      edge.source_node_id === connection.source &&
      edge.source_port_id === connection.sourceHandle &&
      edge.target_node_id === connection.target &&
      edge.target_port_id === connection.targetHandle
  )

  if (duplicateEdge) {
    return workflow
  }

  const targetPort = findTargetPortDefinition(workflow, connection, nodeDefinitions)
  const nextEdges =
    targetPort && !targetPort.multiple
      ? workflow.edges.filter(
          (edge) =>
            !(
              edge.target_node_id === connection.target &&
              edge.target_port_id === connection.targetHandle
            )
        )
      : workflow.edges

  return applyConnectionSideEffects({
    ...workflow,
    edges: [
      ...nextEdges,
      {
        edge_id: nextWorkflowEdgeId(workflow, connection),
        source_node_id: connection.source,
        source_port_id: connection.sourceHandle,
        target_node_id: connection.target,
        target_port_id: connection.targetHandle
      }
    ]
  }, connection)
}

export function reconnectWorkflowEdge(workflow, edgeId, connection, nodeDefinitions = []) {
  if (!edgeId || !connection.source || !connection.target || !connection.sourceHandle || !connection.targetHandle) {
    return workflow
  }

  const targetPort = findTargetPortDefinition(workflow, connection, nodeDefinitions)
  const nextEdges =
    targetPort && !targetPort.multiple
      ? workflow.edges.filter(
          (edge) =>
            edge.edge_id === edgeId ||
            !(
              edge.target_node_id === connection.target &&
              edge.target_port_id === connection.targetHandle
            )
        )
      : workflow.edges

  return applyConnectionSideEffects({
    ...workflow,
    edges: nextEdges.map((edge) =>
      edge.edge_id === edgeId
        ? {
            ...edge,
            source_node_id: connection.source,
            source_port_id: connection.sourceHandle,
            target_node_id: connection.target,
            target_port_id: connection.targetHandle
          }
        : edge
    )
  }, connection)
}

export function syncWorkflowNodes(workflow, nodes) {
  const positionMap = Object.fromEntries(
    nodes.map((node) => [
      node.id,
      {
        x: node.position.x,
        y: node.position.y
      }
    ])
  )

  return {
    ...workflow,
    nodes: workflow.nodes.map((node) => ({
      ...node,
      position: positionMap[node.node_id] ?? node.position
    }))
  }
}

export function syncWorkflowEdges(workflow, edges) {
  return {
    ...workflow,
    edges: edges.map((edge) => ({
      edge_id: edge.id,
      source_node_id: edge.source,
      source_port_id: edge.sourceHandle,
      target_node_id: edge.target,
      target_port_id: edge.targetHandle
    }))
  }
}

export function removeWorkflowEdge(workflow, edgeId) {
  return {
    ...workflow,
    edges: workflow.edges.filter((edge) => edge.edge_id !== edgeId)
  }
}

export function removeWorkflowNode(workflow, nodeId) {
  return {
    ...workflow,
    edges: workflow.edges.filter(
      (edge) => edge.source_node_id !== nodeId && edge.target_node_id !== nodeId
    ),
    nodes: workflow.nodes.filter((node) => node.node_id !== nodeId)
  }
}

export function canConnect(connection, workflow, nodeDefinitions) {
  return inspectConnection(connection, workflow, nodeDefinitions).valid
}

export function inspectConnection(connection, workflow, nodeDefinitions) {
  if (!connection.source || !connection.target || !connection.sourceHandle || !connection.targetHandle) {
    return {
      reason: 'missing_endpoint',
      sourceDataType: null,
      sourceFound: false,
      sourceHandleFound: false,
      sourceTypeId: null,
      targetDataType: null,
      targetFound: false,
      targetHandleFound: false,
      targetTypeId: null,
      valid: false
    }
  }

  const sourceNode = workflow.nodes.find((node) => node.node_id === connection.source)
  const targetNode = workflow.nodes.find((node) => node.node_id === connection.target)
  if (!sourceNode || !targetNode) {
    return {
      reason: !sourceNode ? 'missing_source_node' : 'missing_target_node',
      sourceDataType: null,
      sourceFound: Boolean(sourceNode),
      sourceHandleFound: false,
      sourceTypeId: sourceNode?.type_id ?? null,
      targetDataType: null,
      targetFound: Boolean(targetNode),
      targetHandleFound: false,
      targetTypeId: targetNode?.type_id ?? null,
      valid: false
    }
  }

  const sourceDefinition = findNodeDefinition(sourceNode, nodeDefinitions)
  const targetDefinition = findNodeDefinition(targetNode, nodeDefinitions)
  if (!sourceDefinition || !targetDefinition) {
    return {
      reason: !sourceDefinition ? 'missing_source_definition' : 'missing_target_definition',
      sourceDataType: null,
      sourceFound: true,
      sourceHandleFound: false,
      sourceTypeId: sourceNode.type_id,
      targetDataType: null,
      targetFound: true,
      targetHandleFound: false,
      targetTypeId: targetNode.type_id,
      valid: false
    }
  }

  const sourcePort = sourceDefinition.outputs.find((port) => port.port_id === connection.sourceHandle)
  const targetPort = targetDefinition.inputs.find((port) => port.port_id === connection.targetHandle)
  if (!sourcePort || !targetPort) {
    return {
      reason: !sourcePort ? 'missing_source_port' : 'missing_target_port',
      sourceDataType: normalizeDataType(sourcePort?.data_type),
      sourceFound: true,
      sourceHandleFound: Boolean(sourcePort),
      sourceTypeId: sourceNode.type_id,
      targetDataType: normalizeDataType(targetPort?.data_type),
      targetFound: true,
      targetHandleFound: Boolean(targetPort),
      targetTypeId: targetNode.type_id,
      valid: false
    }
  }

  const sourceDataType = normalizeDataType(sourcePort.data_type)
  const targetDataType = normalizeDataType(targetPort.data_type)
  const valid = arePortTypesCompatible(sourceNode, sourcePort, targetNode, targetPort)

  return {
    reason: valid ? 'ok' : 'type_mismatch',
    sourceDataType,
    sourceFound: true,
    sourceHandleFound: true,
    sourceTypeId: sourceNode.type_id,
    targetDataType,
    targetFound: true,
    targetHandleFound: true,
    targetTypeId: targetNode.type_id,
    valid
  }
}

function arePortTypesCompatible(sourceNode, sourcePort, targetNode, targetPort) {
  const sourceDataType = normalizeDataType(sourcePort?.data_type)
  const targetDataType = normalizeDataType(targetPort?.data_type)

  if (targetNode?.type_id === 'quality_check' && targetPort?.port_id === 'table') {
    return sourceNode?.type_id === 'table_merge' && sourceDataType === 'table_ref'
  }

  if (targetNode?.type_id === 'checkpoint_write' && targetPort?.port_id === 'table') {
    return (
      (sourceNode?.type_id === 'table_merge' || sourceNode?.type_id === 'quality_check') &&
      sourceDataType === 'table_ref'
    )
  }

  if (sourceDataType === targetDataType) {
    return true
  }

  return (
    sourceDataType === 'table_ref' &&
    targetNode?.type_id === 'table_output' &&
    targetPort?.port_id === 'text'
  )
}

function applyConnectionSideEffects(workflow, connection) {
  const sourceNode = workflow.nodes.find((node) => node.node_id === connection.source)
  const targetNode = workflow.nodes.find((node) => node.node_id === connection.target)

  if (!sourceNode || !targetNode || targetNode.type_id !== 'table_output' || connection.targetHandle !== 'text') {
    return workflow
  }

  let nextInputShape = null
  if (
    sourceNode.type_id === 'table_input' ||
    sourceNode.type_id === 'table_merge' ||
    sourceNode.type_id === 'checkpoint_write' ||
    sourceNode.type_id === 'quality_check'
  ) {
    nextInputShape = 'source_table'
  } else if (sourceNode.type_id === 'table_schema') {
    nextInputShape = 'table_schema'
  } else if (sourceNode.type_id === 'text_input') {
    nextInputShape = 'single_text_row'
  }

  if (!nextInputShape) {
    return workflow
  }

  return {
    ...workflow,
    nodes: workflow.nodes.map((node) =>
      node.node_id === targetNode.node_id
        ? {
            ...node,
            config: {
              ...(node.config ?? {}),
              input_shape: nextInputShape
            }
          }
        : node
    )
  }
}

export function updateNodeConfig(workflow, nodeId, nextConfig) {
  return {
    ...workflow,
    nodes: workflow.nodes.map((node) =>
      node.node_id === nodeId
        ? {
            ...node,
            config: nextConfig
          }
        : node
    )
  }
}

export function updateNodeLabel(workflow, nodeId, nextLabel) {
  return {
    ...workflow,
    nodes: workflow.nodes.map((node) =>
      node.node_id === nodeId
        ? {
            ...node,
            label: nextLabel
          }
      : node
    )
  }
}

function resolveCanvasNodeType(typeId) {
  if (typeId === 'text_input') {
    return 'text_input'
  }

  if (typeId === 'dolt_repo_source') {
    return 'dolt_repo_source'
  }

  if (typeId === 'checkpoint_read') {
    return 'checkpoint_read'
  }

  if (typeId === 'checkpoint_write') {
    return 'checkpoint_write'
  }

  if (typeId === 'quality_check') {
    return 'quality_check'
  }

  if (typeId === 'dolt_repo_sync') {
    return 'dolt_repo_sync'
  }

  if (typeId === 'dolt_change_manifest') {
    return 'dolt_change_manifest'
  }

  if (typeId === 'dolt_dump') {
    return 'dolt_dump'
  }

  if (typeId === 'dolt_diff_export') {
    return 'dolt_diff_export'
  }

  if (typeId === 'load_to_duckdb') {
    return 'load_to_duckdb'
  }

  if (typeId === 'table_merge') {
    return 'table_merge'
  }

  if (typeId === 'table_input') {
    return 'table_input'
  }

  if (typeId === 'table_schema') {
    return 'table_schema'
  }

  if (typeId === 'table_output') {
    return 'table_output'
  }

  if (typeId === 'send_email') {
    return 'send_email'
  }

  return 'stitchly'
}

function nextWorkflowEdgeId(workflow, connection) {
  const baseId = `edge_${connection.source}_${connection.sourceHandle}_to_${connection.target}_${connection.targetHandle}`

  if (!workflow.edges.some((edge) => edge.edge_id === baseId)) {
    return baseId
  }

  let suffix = 2
  let nextId = `${baseId}_${suffix}`

  while (workflow.edges.some((edge) => edge.edge_id === nextId)) {
    suffix += 1
    nextId = `${baseId}_${suffix}`
  }

  return nextId
}

function findTargetPortDefinition(workflow, connection, nodeDefinitions) {
  const targetNode = workflow.nodes.find((node) => node.node_id === connection.target)
  const targetDefinition = findNodeDefinition(targetNode, nodeDefinitions)

  return targetDefinition?.inputs.find((port) => port.port_id === connection.targetHandle) ?? null
}

function normalizeDataType(value) {
  return String(value ?? '').trim().toLowerCase()
}

function findNodeDefinition(node, nodeDefinitions) {
  if (!node) {
    return null
  }

  const matchedDefinition = nodeDefinitions.find(
    (definition) => definition.type_id === node.type_id
  )

  if (matchedDefinition) {
    return matchedDefinition
  }

  return FALLBACK_NODE_DEFINITIONS[node.type_id] ?? null
}

export function resolveNodeDefinition(node, nodeDefinitions) {
  return findNodeDefinition(node, nodeDefinitions)
}

const FALLBACK_NODE_DEFINITIONS = {
  dolt_repo_source: {
    display_name: 'Dolt Repo Source',
    inputs: [],
    outputs: [
      {
        data_type: 'dataset_ref',
        multiple: false,
        port_id: 'repo_out'
      }
    ],
    ui: {
      default_width: 336
    },
    type_id: 'dolt_repo_source'
  },
  checkpoint_read: {
    display_name: 'Checkpoint Read',
    inputs: [],
    outputs: [
      {
        data_type: 'json',
        multiple: false,
        port_id: 'checkpoint'
      }
    ],
    ui: {
      default_width: 336
    },
    type_id: 'checkpoint_read'
  },
  checkpoint_write: {
    display_name: 'Checkpoint Write',
    inputs: [
      {
        data_type: 'table_ref',
        multiple: false,
        port_id: 'table',
        required: true
      }
    ],
    outputs: [
      {
        data_type: 'table_ref',
        multiple: false,
        port_id: 'table'
      }
    ],
    ui: {
      default_width: 336
    },
    type_id: 'checkpoint_write'
  },
  quality_check: {
    display_name: 'Quality Check',
    inputs: [
      {
        data_type: 'table_ref',
        multiple: false,
        port_id: 'table',
        required: true
      }
    ],
    outputs: [
      {
        data_type: 'table_ref',
        multiple: false,
        port_id: 'table'
      }
    ],
    ui: {
      default_width: 336
    },
    type_id: 'quality_check'
  },
  dolt_repo_sync: {
    display_name: 'Dolt Repo Sync',
    inputs: [
      {
        data_type: 'dataset_ref',
        multiple: false,
        port_id: 'repo',
        required: true
      },
      {
        data_type: 'json',
        multiple: false,
        port_id: 'checkpoint',
        required: false
      }
    ],
    outputs: [
      {
        data_type: 'dataset_ref',
        multiple: false,
        port_id: 'repo_out'
      }
    ],
    ui: {
      default_width: 336
    },
    type_id: 'dolt_repo_sync'
  },
  dolt_change_manifest: {
    display_name: 'Dolt Change Manifest',
    inputs: [
      {
        data_type: 'dataset_ref',
        multiple: false,
        port_id: 'repo',
        required: true
      }
    ],
    outputs: [
      {
        data_type: 'dataset_ref',
        multiple: false,
        port_id: 'manifest'
      }
    ],
    ui: {
      default_width: 336
    },
    type_id: 'dolt_change_manifest'
  },
  dolt_dump: {
    display_name: 'Dolt Dump',
    inputs: [
      {
        data_type: 'dataset_ref',
        multiple: false,
        port_id: 'repo',
        required: true
      }
    ],
    outputs: [
      {
        data_type: 'directory_ref',
        multiple: false,
        port_id: 'bundle'
      }
    ],
    ui: {
      default_width: 336
    },
    type_id: 'dolt_dump'
  },
  dolt_diff_export: {
    display_name: 'Dolt Diff Export',
    inputs: [
      {
        data_type: 'dataset_ref',
        multiple: false,
        port_id: 'manifest',
        required: true
      }
    ],
    outputs: [
      {
        data_type: 'directory_ref',
        multiple: false,
        port_id: 'bundle'
      }
    ],
    ui: {
      default_width: 336
    },
    type_id: 'dolt_diff_export'
  },
  load_to_duckdb: {
    display_name: 'Load to DuckDB',
    inputs: [
      {
        data_type: 'directory_ref',
        multiple: false,
        port_id: 'bundle',
        required: true
      }
    ],
    outputs: [
      {
        data_type: 'table_ref',
        multiple: false,
        port_id: 'table'
      }
    ],
    ui: {
      default_width: 336
    },
    type_id: 'load_to_duckdb'
  },
  table_merge: {
    display_name: 'Table Merge',
    inputs: [
      {
        data_type: 'table_ref',
        multiple: false,
        port_id: 'table',
        required: true
      }
    ],
    outputs: [
      {
        data_type: 'table_ref',
        multiple: false,
        port_id: 'table'
      }
    ],
    ui: {
      default_width: 336
    },
    type_id: 'table_merge'
  },
  send_email: {
    inputs: [
      {
        data_type: 'text',
        multiple: false,
        port_id: 'body'
      }
    ],
    outputs: [],
    type_id: 'send_email'
  },
  table_input: {
    inputs: [],
    outputs: [
      {
        data_type: 'table_ref',
        multiple: false,
        port_id: 'table'
      }
    ],
    type_id: 'table_input'
  },
  table_schema: {
    inputs: [],
    outputs: [
      {
        data_type: 'table_ref',
        multiple: false,
        port_id: 'table'
      }
    ],
    type_id: 'table_schema'
  },
  table_output: {
    inputs: [
      {
        data_type: 'text',
        multiple: false,
        port_id: 'text',
        required: true
      }
    ],
    outputs: [],
    type_id: 'table_output'
  },
  text_input: {
    inputs: [],
    outputs: [
      {
        data_type: 'text',
        multiple: false,
        port_id: 'text'
      }
    ],
    type_id: 'text_input'
  }
}
