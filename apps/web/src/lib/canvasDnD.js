export const CANVAS_NODE_DRAG_MIME_TYPE = 'application/x-stitchly-node-type'

export function setDraggedNodeType(dataTransfer, typeId) {
  if (!dataTransfer || !typeId) {
    return
  }

  dataTransfer.setData(CANVAS_NODE_DRAG_MIME_TYPE, typeId)
  dataTransfer.setData('text/plain', typeId)
  dataTransfer.effectAllowed = 'copy'
}

export function getDraggedNodeType(dataTransfer) {
  if (!dataTransfer) {
    return null
  }

  return (
    dataTransfer.getData(CANVAS_NODE_DRAG_MIME_TYPE) ||
    dataTransfer.getData('text/plain') ||
    null
  )
}
