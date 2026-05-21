# 11 Dashboard Notifications

Type: `notification-center-study`

Purpose:

- define a dedicated dashboard surface for workflow alerts, failures, and operational messages
- test how Stitchly should separate actionable incidents from quieter informational updates
- establish a calmer alert-center language than a noisy inbox-style feed

What this sample is testing:

- grouped notification feed by recency
- severity treatment for critical, warning, and informational items
- action chips on alert cards
- supporting right-side summary rail for counts and alert rules
- whether notifications deserve their own first-class dashboard destination

What this sample intentionally includes:

- contained shell reused from the broader dashboard studies
- alert feed with mixed severities
- workflow-specific action affordances
- compact summary and rule cards

What this sample intentionally does not solve yet:

- real read/unread behavior
- pagination or infinite notification history
- push/toast relationship with the dashboard center
- mobile notification-center adaptation
- final severity taxonomy

Shared styling:

- this sample uses `../shared.css`
- notification-center helpers are appended to the shared stylesheet rather than using a local override file

Review questions:

- does this feel like a useful destination rather than just a list of messages?
- are the severity treatments too loud or about right?
- should alerts live in a separate center like this, or mostly stay embedded in runs and overview views?
- does the right-side summary rail help prioritize work, or feel unnecessary?
