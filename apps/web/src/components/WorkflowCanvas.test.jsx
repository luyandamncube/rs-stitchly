import { fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import nodeDefinitionFixture from '../../../../tests/fixtures/api/node_definitions.json'
import workflowFixture from '../../../../tests/fixtures/workflows/basic_text_preview.json'
import { cloneWorkflow } from '../lib/workflow'
import WorkflowCanvas from './WorkflowCanvas'

function CanvasHarness({ onNodeOpen = () => {} }) {
  const [workflow, setWorkflow] = useState(() => cloneWorkflow(workflowFixture))
  const [selectedNodeId, setSelectedNodeId] = useState(null)

  return (
    <WorkflowCanvas
      nodeDefinitions={nodeDefinitionFixture.node_definitions}
      onNodeOpen={onNodeOpen}
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

describe('WorkflowCanvas', () => {
  it('renders the real send email node from the persisted workflow', () => {
    render(<CanvasHarness />)

    const sendEmailNode = getSendEmailNode()

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

    const sendEmailNode = container.querySelector(
      '[data-id="send_email_notification"] .workflow-node-card'
    )
    const placeholderNode = container.querySelector('.schema-node')

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
})
