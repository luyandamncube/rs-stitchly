import { buildBlankWorkflowDefinition, buildStarterWorkflowDefinition } from './workflowTemplates'

describe('workflowTemplates', () => {
  it('builds blank workflows with 22-character alphanumeric ids', () => {
    const workflow = buildBlankWorkflowDefinition()

    expect(workflow.workflow_id).toMatch(/^[A-Za-z0-9]{22}$/)
  })

  it('builds starter workflows with 22-character alphanumeric ids', () => {
    const workflow = buildStarterWorkflowDefinition()

    expect(workflow.workflow_id).toMatch(/^[A-Za-z0-9]{22}$/)
  })
})
