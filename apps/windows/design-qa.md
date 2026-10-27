# Primus Main Screen Design QA

## Comparison Target

- Source visual: `Design/PrimusMainReference.png` (1260 x 1119 px)
- Implementation: `Design/PrimusMainFinal.png` (1332 x 1117 px)
- Splash implementation: `Design/PrimusSplashFinal.png`
- App viewport: 888 x 744.7 DIP at 150% display scaling; 1332 x 1117 px
- State: light theme, intro complete, empty main screen, empty prompt input
- Density normalization: both images resized to 700 px height for comparison
- Full-view comparison: `Design/design-comparison.png`
- Focused composer comparison: `Design/design-comparison-composer.png`

## Findings

No actionable P0, P1, or P2 findings remain.

### Intentional Differences

- The reference uses a neutral placeholder mark; Primus uses the supplied brand logo in a subtle glass badge.
- The reference has a flat white background; Primus intentionally keeps the existing fixed Acrylic background.
- Primus retains the native WinUI title bar because this is a desktop application rather than a browser mock.

## Required Fidelity Surfaces

- Fonts and typography: heading, model selector, access label, placeholder, and project label follow the reference hierarchy. `Segoe UI Variable Display` is used for the heading with the system Chinese fallback.
- Spacing and layout rhythm: the hero mark and heading are centered above the bottom composer, which retains the project-chip, input, toolbar, model selector, and send-control structure from the reference.
- Colors and visual tokens: the glass surfaces use translucent theme dictionaries; the access label uses the warm orange accent shown in the reference.
- Image quality and assets: the supplied Primus raster logo is used directly. No fabricated vector or placeholder artwork replaces a visible image asset.
- Copy and content: heading copy is `我们应该在winui中做些什么？`; project, placeholder, access, and model labels match the reference.
- Accessibility and interaction: the prompt input is named and editable through UI Automation. Icon buttons expose accessible names. The prompt accepted and cleared test text successfully.

## Comparison History

1. P2: The focused TextBox displayed an unintended underline that was absent from the reference.
   - Fix: overrode unfocused and focused text-control border thickness/brushes.
   - Post-fix evidence: `Design/PrimusMainFinal.png`.
2. P2: The disabled send button rendered as a bare arrow instead of the circular control in the reference.
   - Fix: kept the circular control enabled while retaining its subdued glass color.
   - Post-fix evidence: `Design/PrimusMainFinal.png` and `Design/design-comparison-composer.png`.
3. P2: Heading casing and spacing differed from the reference copy.
   - Fix: changed the heading to `我们应该在winui中做些什么？`.
   - Post-fix evidence: `Design/design-comparison.png`.

## Verification

- Build: passed with 0 warnings and 0 errors.
- Splash state: captured before the one-second hold ends.
- Main state: captured after the crossfade completes.
- Background behavior: only the splash and main foreground layers are animated; the Acrylic backdrop is unchanged.
- Application process remained running after verification.

## Follow-up Polish

- P3: The branded glass badge for the hero logo is slightly more prominent than the neutral mark in the reference.

final result: passed
