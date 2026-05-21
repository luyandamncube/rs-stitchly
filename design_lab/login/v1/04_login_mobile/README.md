# 04 Login Mobile

Type: `layout-study`

Purpose:

- create a dedicated mobile reinterpretation of the login shell
- preserve the premium dark auth language without simply collapsing the desktop split
- test whether mobile should use a different CTA pattern and hero composition

What this sample is testing:

- single-column mobile auth layout
- top brand hero with symbol and supporting copy
- stacked mobile form hierarchy
- whether mobile should switch from a detached circular CTA to a full-width action button
- balance between brand presence and practical sign-in flow on a phone-sized screen

Reference direction:

- the same supplied split-screen login reference, translated intentionally for mobile rather than responsively compressed

What this sample intentionally includes:

- a phone-like frame for consistent review
- top Stitchly hero with symbol monument
- compact brand/meta row
- stacked email and password fields
- helper row for remember-me and forgot-password
- full-width lava primary CTA

What this sample intentionally does not solve yet:

- final production input states
- final mobile keyboard-safe spacing
- sign-up and recovery flow details
- motion between hero and form sections

Shared styling:

- this sample uses `../shared.css`
- the mobile classes added here should remain reusable for later auth and onboarding studies

Review questions:

- does this feel like the same design family as the desktop studies?
- is the hero too tall or about right for mobile?
- is the full-width lava CTA a better mobile translation than the circular button?
- does the mobile screen feel premium without becoming impractical?
