# iOS menu redesign

## Recommendations, ranked by expected value

| Rank | Improvement | Expected value |
| --- | --- | --- |
| 1 | Group controls by workflow and give shared tasks one editor | Highest: reduces hunting across panes and uncertainty about duplicated settings |
| 2 | Use a shared layout rhythm and accessible control sizes | High: improves scanning, alignment, touch use and large-text layouts throughout the app |
| 3 | Use task-based names, scoped reset labels and consistent source disclosures | High: makes choices easier to understand and keeps provenance out of the controls' reading order |
| 4 | Add recent or frequently used tool shortcuts | Moderate: saves repeat navigation after the hierarchy is clear |
| 5 | Add contextual help for advanced scientific controls | Moderate: helps unfamiliar users interpret specialized options |

The first three are implemented. The last two remain recommendations.

## What changed

The native home menu groups its 13 tools into Explore the map, Study & share,
Reference layers, and App. Every route has a brief purpose subtitle. Terrain
has quick presets, map display controls, separate customization submenus,
downloads, and a final Sources & scale disclosure. Spectrum colors stay inside
the elevation spectrum section; resets explicitly name spectrum or highlights.

Image export uses the camera shortcut's existing controls and layout directly.
Settings links to that editor instead of exposing copied export preferences.
Custom appearance colors have one editor each. Lists and toolbar cards share
page margins, row spacing and minimum 44-point targets; pickers and choice rows
adapt at accessibility text sizes. Layer providers and scale information sit
in named source disclosures. Scientific warnings, dates used to choose imagery,
units and loading status remain beside the relevant controls or results.

These changes are native presentation and adapter changes. The map engine,
source ranking, loading rules, export implementation and scientific calculations
are unchanged. Native control actions still target the original live web inputs.

## Verification

- Simulator Debug build with Xcode, plus `npm run check`.
- Menu-layout behavioral regressions and the existing LiDAR menu, menu-control
  and native-markup tests.
- `ios/scripts/verify_menus.js` in the actual bundled WebKit app: all 13 routes,
  live-control coverage, duplicate controls, source placement, exact elevation
  span, opacity, sun position, and export-resolution state.
- Simulator screenshots and accessibility snapshots for the home menu, terrain
  submenus, elevation, export, settings, appearance and reference layers in
  light and dark appearances; accessibility text-size checks.

Independent GPT-6.1 grades and any resulting revisions are recorded below.

### Round 1 — 82/100

GPT-6.1 scored workflow/discoverability 22/25, grouping/naming 21/25,
visual hierarchy 16/20, accessibility 15/20, scientific metadata clarity 8/10.
Its three highest-value findings were provider names still embedded in real
layer labels, low-contrast light-mode navigation titles, and truncated preset
names at accessibility sizes. It also flagged repetitive Appearance labels
and long sentence-shaped Settings buttons.

The second revision fixes overlay-label extraction before the generic label
handler, applies explicit semantic title colors and stronger secondary text,
and presents complete preset names in vertical rows at accessibility sizes.
It also merges repeated choice labels, shortens Settings actions and preserves
normal back navigation from Settings to the shared export editor. The live
probe now explicitly checks the actual overlay DOM's layer names and providers.

### Round 2 — 91/100

A fresh GPT-6.1 reviewer scored workflow 23/25, grouping 24/25, visual
hierarchy 18/20, accessibility 17/20 and scientific clarity 9/10. It confirmed
the light-mode titles, clean provider labels and complete large-text preset
names in the refreshed screenshots. No blocking UI defect was found.

### Final review — 92/100

A final expanded-disclosure check found that a label applied to the entire
SwiftUI disclosure propagated to its source rows in the accessibility tree.
The label and expanded state now apply only to the disclosure heading; a fresh
XCTest snapshot preserves each layer name and provider independently. Search
also has an explicit accessibility label and stronger placeholder contrast.

A fresh GPT-6.1 reviewer graded the final code **92/100**: workflow 23/25,
grouping 24/25, visual hierarchy 18/20, accessibility 18/20 and scientific
clarity 9/10. It independently reran the five menu-layout tests and found no
blocking UI defect. The final home screenshot was captured after its review;
the reviewer verified the search contrast change in code.

Final validation: simulator Debug build, eight focused Node tests,
`npm run check`, `git diff --check`, both live WebKit probes across all 13
routes, expanded source disclosure, and Settings → Export image → Back.
The export area-selection flow dismisses the menu and returns safely after
cancellation. No terrain download or actual image export was triggered.

Known limitations: no physical-device VoiceOver traversal or exhaustive
large-text testing of every advanced editor. Minor Appearance wording, small
normal-size preset captions and long scrolling remain possible future polish.
No website assets changed, so the web build stamp is unchanged.
