import { buildNodeCardModel, getNodeCardWidth } from './nodeCard'

export function cloneWorkflow(workflow) {
  return structuredClone(workflow)
}

export function createCanvasElements(
  workflow,
  nodeDefinitions,
  selectedNodeId,
  hoveredNodeId = null
) {
  const definitionMap = Object.fromEntries(
    nodeDefinitions.map((definition) => [definition.type_id, definition])
  )

  return {
    nodes: workflow.nodes.map((node) => ({
      id: node.node_id,
      type: resolveCanvasNodeType(node.type_id),
      position: node.position,
      selected: node.node_id === selectedNodeId,
      data: {
        label: node.label ?? definitionMap[node.type_id]?.display_name ?? node.type_id,
        definition: definitionMap[node.type_id],
        node,
        uiState: {
          interaction: {
            hovered: node.node_id === hoveredNodeId
          }
        },
        typeId: node.type_id,
        card: buildNodeCardModel({
          workflow,
          node,
          definition: definitionMap[node.type_id],
          nodeDefinitions
        })
      },
      style: {
        background: 'transparent',
        border: 'none',
        width: getNodeCardWidth(definitionMap[node.type_id])
      }
    })),
    edges: workflow.edges.map((edge) => ({
      id: edge.edge_id,
      source: edge.source_node_id,
      sourceHandle: edge.source_port_id,
      target: edge.target_node_id,
      targetHandle: edge.target_port_id
    }))
  }
}

export function connectWorkflowNodes(workflow, connection) {
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

  return {
    ...workflow,
    edges: [
      ...workflow.edges,
      {
        edge_id: nextWorkflowEdgeId(workflow, connection),
        source_node_id: connection.source,
        source_port_id: connection.sourceHandle,
        target_node_id: connection.target,
        target_port_id: connection.targetHandle
      }
    ]
  }
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

export function canConnect(connection, workflow, nodeDefinitions) {
  if (!connection.source || !connection.target || !connection.sourceHandle || !connection.targetHandle) {
    return false
  }

  const sourceNode = workflow.nodes.find((node) => node.node_id === connection.source)
  const targetNode = workflow.nodes.find((node) => node.node_id === connection.target)
  if (!sourceNode || !targetNode) {
    return false
  }

  const sourceDefinition = nodeDefinitions.find((definition) => definition.type_id === sourceNode.type_id)
  const targetDefinition = nodeDefinitions.find((definition) => definition.type_id === targetNode.type_id)
  if (!sourceDefinition || !targetDefinition) {
    return false
  }

  const sourcePort = sourceDefinition.outputs.find((port) => port.port_id === connection.sourceHandle)
  const targetPort = targetDefinition.inputs.find((port) => port.port_id === connection.targetHandle)
  if (!sourcePort || !targetPort) {
    return false
  }

  const alreadyConnected = workflow.edges.some(
    (edge) =>
      edge.target_node_id === connection.target &&
      edge.target_port_id === connection.targetHandle
  )

  return sourcePort.data_type === targetPort.data_type && (targetPort.multiple || !alreadyConnected)
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
