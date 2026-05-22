import { fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { vi } from 'vitest'
import nodeDefinitionFixture from '../../../../tests/fixtures/api/node_definitions.json'
import workflowFixture from '../../../../tests/fixtures/workflows/basic_text_preview.json'
import { setDraggedNodeType } from '../lib/canvasDnD'
import { cloneWorkflow } from '../lib/workflow'
import WorkflowCanvas from './WorkflowCanvas'

function CanvasHarness({ onNodeOpen = () => {}, onNodeTypeDrop = () => {} }) {
  const [workflow, setWorkflow] = useState(() => cloneWorkflow(workflowFixture))
  const [selectedNodeId, setSelectedNodeId] = useState(null)

  return (
    <WorkflowCanvas
      nodeDefinitions={nodeDefinitionFixture.node_definitions}
      onNodeOpen={onNodeOpen}
      onNodeTypeDrop={onNodeTypeDrop}
      onSelectionChange={setSelectedNodeId}
      onWorkflowChange={setWorkflow}
      selectedNodeId={selectedNodeId}
      workflow={workflow}
    />
  )
}

function getSendEmailNode() {
  const node = screen.getByText('Send Email').closest('.workflow-node-card')

  expect(node).not.toBeNull()

  return node
}

function getTextInputNode() {
  const node = screen.getByText('Text Input').closest('.workflow-node-card')

  expect(node).not.toBeNull()

  return node
}

describe('WorkflowCanvas', () => {
  it('renders the real text input and send email nodes from the persisted workflow', () => {
    render(<CanvasHarness />)

    const textInputNode = getTextInputNode()
    const sendEmailNode = getSendEmailNode()

    expect(textInputNode).toHaveClass('workflow-node-card')
    expect(
      within(textInputNode).getByText(
        'Please inspect the latest failed refunds batch and acknowledge the issue.'
      )
    ).toBeInTheDocument()
    expect(within(textInputNode).getByText('73 chars')).toBeInTheDocument()
    expect(sendEmailNode).toHaveClass('workflow-node-card')
    expect(within(sendEmailNode).getByText('Notify')).toBeInTheDocument()
    expect(within(sendEmailNode).getByText('ops@stitchly.dev')).toBeInTheDocument()
    expect(
      within(sendEmailNode).getByText('Failed refunds need review from the latest sync')
    ).toBeInTheDocument()
    expect(within(sendEmailNode).getByText('Last send')).toBeInTheDocument()
  })

  it('does not keep the old placeholder starter nodes in the flow', () => {
    const { container } = render(<CanvasHarness />)

    const textInputNode = container.querySelector('[data-id="input_text"] .workflow-node-card')
    const sendEmailNode = container.querySelector(
      '[data-id="send_email_notification"] .workflow-node-card'
    )
    const placeholderNode = container.querySelector('.schema-node')

    expect(textInputNode).not.toBeNull()
    expect(sendEmailNode).not.toBeNull()
    expect(placeholderNode).toBeNull()
  })

  it('selects a node on click and clears selection on canvas click', () => {
    const { container } = render(<CanvasHarness />)

    const sendEmailNode = getSendEmailNode()
    const canvasPane = container.querySelector('.react-flow__pane')

    expect(canvasPane).not.toBeNull()
    expect(sendEmailNode).not.toHaveClass('is-selected')

    fireEvent.click(sendEmailNode)

    expect(sendEmailNode).toHaveClass('is-selected')

    fireEvent.click(canvasPane)

    expect(sendEmailNode).not.toHaveClass('is-selected')
  })

  it('opens the node inspector on double click', () => {
    const onNodeOpen = vi.fn()

    render(<CanvasHarness onNodeOpen={onNodeOpen} />)

    fireEvent.doubleClick(getSendEmailNode())

    expect(onNodeOpen).toHaveBeenCalledWith('send_email_notification')
  })

  it('emits a node drop event when a shelf item is dragged onto the canvas', () => {
    const onNodeTypeDrop = vi.fn()
    const dragData = new Map()
    const dataTransfer = {
      dropEffect: '',
      effectAllowed: '',
      getData(type) {
        return dragData.get(type) ?? ''
      },
      setData(type, value) {
        dragData.set(type, value)
      }
    }

    const { container } = render(<CanvasHarness onNodeTypeDrop={onNodeTypeDrop} />)
    const canvasSurface = container.querySelector('.canvas-surface')

    expect(canvasSurface).not.toBeNull()

    setDraggedNodeType(dataTransfer, 'send_email')
    fireEvent.dragOver(canvasSurface, { dataTransfer })
    fireEvent.drop(canvasSurface, { clientX: 240, clientY: 180, dataTransfer })

    expect(onNodeTypeDrop).toHaveBeenCalledWith(
      'send_email',
      expect.objectContaining({
        x: expect.any(Number),
        y: expect.any(Number)
      })
    )
  })
})
