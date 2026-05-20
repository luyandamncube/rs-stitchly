use api_contract::{CreateRunRequest, RunEventType, RunStatus};
use serde::Deserialize;
use serde_json::json;
use tokio::time::{sleep, Duration};
use workflow_schema::WorkflowDefinition;

use runtime_core::RuntimeService;

#[derive(Deserialize)]
struct ExpectedRunEvents {
    final_status: RunStatus,
    expected_sequence: Vec<RunEventType>,
}

#[tokio::test]
async fn fixture_workflow_validates_runs_and_matches_expected_event_sequence() {
    let runtime = RuntimeService::default();
    let workflow: WorkflowDefinition = serde_json::from_str(include_str!(
        "../fixtures/workflows/basic_text_preview.json"
    ))
    .expect("workflow fixture parses");
    let expected: ExpectedRunEvents = serde_json::from_str(include_str!(
        "../fixtures/runs/basic_text_preview_events.json"
    ))
    .expect("run fixture parses");

    let validation = runtime.validate_workflow(&workflow);
    assert!(validation.valid, "fixture workflow should validate");

    let created = runtime
        .create_run(CreateRunRequest {
            workflow,
            trigger: Default::default(),
            params: json!({}).as_object().cloned().unwrap_or_default(),
        })
        .await
        .expect("run should be created");

    let mut final_status = RunStatus::Created;
    for _ in 0..50 {
        let snapshot = runtime
            .get_run(&created.run_id)
            .await
            .expect("run snapshot should exist");
        final_status = snapshot.status;
        if matches!(final_status, RunStatus::Succeeded | RunStatus::Failed) {
            break;
        }
        sleep(Duration::from_millis(20)).await;
    }

    let history = runtime
        .event_history(&created.run_id)
        .await
        .expect("event history should exist");
    let actual_sequence = history
        .into_iter()
        .map(|event| event.event_type)
        .collect::<Vec<_>>();

    assert_eq!(final_status, expected.final_status);
    assert_eq!(actual_sequence, expected.expected_sequence);
}
