# 00 Login Reference Analysis

Type: `reference-analysis`

Purpose:

- analyze the provided login reference screen before adapting it for Stitchly
- identify the layout, spacing, typography, and component rules that make it feel premium
- separate what should be preserved from what should be replaced with Stitchly-specific branding

What this study is analyzing:

- split-screen composition
- left-side brand/stage area
- right-side login card
- field layout and hierarchy
- secondary actions and CTA placement
- shape language and spacing discipline

Reference direction:

- the supplied dark luxury-finance login screen with a left brand monument and right login form card

What we see in the reference:

- a near-black full-screen background with minimal outer padding
- a strict left/right screen split
- a left-side brand panel dominated by symbol, guide lines, and whitespace
- a right-side oversized rounded login card with its own internal layout
- one large `Login` headline
- two minimalist underline-style fields in a single row
- quiet supporting actions below the fields
- a large circular bottom-right `Sign in` CTA

Layout observations:

- the composition is roughly a `50 / 50` split
- the vertical divider is strong and structural
- the form card is inset from the right half instead of filling it edge to edge
- the left half is almost entirely theater and brand framing
- the right half contains the actual product interaction

Typography observations:

- the screen uses a clean modern sans, likely grotesk or geometric-grotesk in feel
- the title is oversized and visually dominant
- field labels are very small and quiet
- field values are much larger than labels and act as the real scanning target
- support text such as `Remember me`, `Forgot?`, and `Create an account` is tiny and restrained

Spacing observations:

- the screen uses large empty areas confidently
- the card padding is generous
- the gap between the title and form row is large
- the gap between field underlines and support actions is tight
- the bottom-right CTA is intentionally detached from the form row
- the design feels premium largely because it refuses to crowd elements

Element inventory:

- wordmark in the top-left of the left panel
- abstract central brand symbol
- faint geometric guide lines in the left panel
- small legal/footer text at bottom-left
- top-right `Create an account` action
- large page title
- `Email` field
- `Password` field with trailing visibility/view affordance
- `Remember me` control
- `Forgot?` secondary action
- circular `Sign in` CTA

Field design observations:

- fields are not boxed
- fields are represented by labels, values, and underlines only
- the form row is horizontal rather than stacked
- the values carry more visual weight than the labels
- the password field uses a trailing icon without turning the field into a heavy component

Shape-language observations:

- most geometry is rectangular and planar
- the main form surface is a large rounded rectangle
- the CTA is a perfect circle
- fine lines are used structurally, not decoratively
- the result is minimal but highly controlled

Color observations:

- the reference is almost monochrome
- black and dark charcoal carry the full screen
- white carries all primary text and the CTA
- muted grays are used for secondary text and lines
- there is little or no accent color pressure in the reference itself

What Stitchly should preserve:

- split-screen shell
- left-side brand theater area
- right-side rounded form card
- oversized title hierarchy
- strict spacing discipline
- quiet supporting actions
- asymmetrical CTA placement

What Stitchly should replace:

- Golden Suisse wordmark -> Stitchly brand
- finance-style left-side symbol -> Stitchly symbol and workflow/canvas motif
- white-only action language -> our `True Black + Lava Core` palette
- luxury banking tone -> workflow/editor/productivity tone
- legal footer copy -> Stitchly product or support copy

Practical product considerations:

- the reference uses field values as visible text rather than typical app inputs, which looks strong but may need usability adjustments later
- the circular CTA is memorable but may need desktop/mobile variants
- the left brand panel is likely desktop-first and may compress or disappear on mobile
- the layout should eventually support both desktop and mobile adaptations without losing the core hierarchy

Recommended next login lab studies:

- `01_login_shell`
  Split layout, card container, and broad composition.
- `02_login_form`
  Title, fields, support actions, and CTA.
- `03_login_brand_panel`
  Stitchly-specific left-side symbol and stage treatment.
- `04_login_mobile`
  Mobile reinterpretation of the same design language.

Still unresolved:

- final production font choice
- whether Stitchly keeps underline-only inputs or adapts to bordered inputs
- how much lava accent should appear on login surfaces
- whether the circular CTA should remain literal or become a Stitchly variant

Review questions:

- does this analysis capture the real visual drivers of the reference?
- which parts of the reference feel essential versus merely stylish?
- should Stitchly preserve the circular CTA direction?
- should Stitchly preserve the two-column desktop split as a primary login pattern?
