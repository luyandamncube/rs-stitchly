import { fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { vi } from 'vitest'
import nodeDefinitionFixture from '../../../../tests/fixtures/api/node_definitions.json'
import workflowFixture from '../../../../tests/fixtures/workflows/basic_text_preview.json'
import { setDraggedNodeType } from '../lib/canvasDnD'
import { cloneWorkflow } from '../lib/workflow'
import WorkflowCanvas from './WorkflowCanvas'

function CanvasHarness({
  activeRunSnapshot = null,
  onNodeOpen = () => {},
  onNodeTypeDrop = () => {},
  workflowOverride = null
}) {
  const [workflow, setWorkflow] = useState(() =>
    cloneWorkflow(workflowOverride ?? workflowFixture)
  )
  const [selectedNodeId, setSelectedNodeId] = useState(null)

  return (
    <WorkflowCanvas
      activeRunSnapshot={activeRunSnapshot}
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

  it('deletes the selected node with the keyboard shortcut', () => {
    render(<CanvasHarness />)

    const sendEmailNode = getSendEmailNode()

    fireEvent.click(sendEmailNode)
    expect(sendEmailNode).toHaveClass('is-selected')

    fireEvent.keyDown(window, { key: 'Delete' })

    expect(screen.queryByText('Send Email')).not.toBeInTheDocument()
    expect(screen.getByText('Text Input')).toBeInTheDocument()
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

  it('maps an active run snapshot into real node runtime states', () => {
    const activeRunSnapshot = {
      run_id: 'run_phase1',
      workflow_id: 'wf_text_preview',
      workflow_version: 1,
      status: 'failed',
      trigger: { kind: 'manual' },
      started_at: '2026-05-26T08:00:00Z',
      finished_at: '2026-05-26T08:00:05Z',
      node_runs: [
        {
          node_id: 'input_text',
          type_id: 'text_input',
          status: 'succeeded',
          attempt: 1,
          started_at: '2026-05-26T08:00:00Z',
          finished_at: '2026-05-26T08:00:01Z',
          last_output: {
            data_type: 'text',
            value: 'Normalized output'
          },
          log_count: 1,
          error: null
        },
        {
          node_id: 'send_email_notification',
          type_id: 'send_email',
          status: 'failed',
          attempt: 1,
          started_at: '2026-05-26T08:00:01Z',
          finished_at: '2026-05-26T08:00:05Z',
          last_output: null,
          log_count: 1,
          error: {
            category: 'execution_error',
            message: 'SMTP timeout'
          }
        }
      ],
      logs: [],
      error: {
        category: 'execution_error',
        message: 'SMTP timeout'
      }
    }

    render(<CanvasHarness activeRunSnapshot={activeRunSnapshot} />)

    const textInputNode = getTextInputNode()
    const sendEmailNode = getSendEmailNode()

    expect(textInputNode).toHaveAttribute('data-runtime-state', 'succeeded')
    expect(sendEmailNode).toHaveAttribute('data-runtime-state', 'failed')
    expect(within(textInputNode).getByText('Succeeded')).toBeInTheDocument()
    expect(within(sendEmailNode).getByText('Failed')).toBeInTheDocument()
    expect(within(textInputNode).getByText('Normalized output')).toBeInTheDocument()
  })

  it('shows the execution wait marker when a node has configured waits', () => {
    const workflowWithWait = cloneWorkflow(workflowFixture)
    const sendEmailNode = workflowWithWait.nodes.find(
      (node) => node.node_id === 'send_email_notification'
    )

    sendEmailNode.config.execution = {
      wait_before_seconds: 5,
      wait_after_seconds: 3
    }

    render(<CanvasHarness workflowOverride={workflowWithWait} />)

    const emailNode = getSendEmailNode()
    const delayIcon = emailNode.querySelector('.workflow-node-card__delay-icon')

    expect(delayIcon).not.toBeNull()
    expect(delayIcon).toHaveTextContent('←')
    expect(delayIcon).toHaveTextContent('→')
  })
})
