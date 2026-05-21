# 02 Login Form

Type: `surface-study`

Purpose:

- refine the right-side login form inside the approved auth shell
- move from placeholder field lines to actual form hierarchy and micro-layout
- study title, field values, helper actions, and CTA relationship in a realistic composition

What this sample is testing:

- oversized title proportion against the field row
- underline-only input treatment using realistic content
- label, value, and helper-text hierarchy
- password field trailing visibility affordance
- circular CTA placement relative to the form block

Reference direction:

- the supplied split-screen login reference, with emphasis on the right card content

What this sample intentionally includes:

- realistic email and password values
- helper actions for remember-me and forgot-password
- top-right account-creation action
- circular `Sign in` CTA anchored to the card corner
- the same left-side Stitchly brand shell from `01_login_shell`

What this sample intentionally does not solve yet:

- production-ready input states
- actual accessibility behavior for the auth form
- final brand-panel content on the left
- form validation or error-state treatments
- mobile-first auth layout decisions

Shared styling:

- this sample uses `../shared.css`
- the auth-field and helper patterns added here should remain reusable for later login studies

Review questions:

- do the field values feel close enough to the reference now?
- is the micro-spacing between title, field row, and helper row correct?
- does the underline-only treatment feel premium or too fragile for Stitchly?
- does the CTA still feel intentional once the form has real content?
