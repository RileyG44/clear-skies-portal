# CR-004 — Matching collapsible map information on desktop and iOS

Status: ACCEPTED
Request content revision and immutable commit/content digest: r1; SHA-256 of all bytes before the Riley approval heading
Author / task: coordinating agent (Codex), Riley's matching desktop/iOS map-info request in this conversation
Current approved spec revision: SPEC.md 0.1.0-draft remains unapproved; accepted supplements CR-001 r1, CR-002 r1 and CR-003 r1 apply
Affected requirement IDs: U-01, U-04, UX-02, UX-03, UX-04, CAP-01, CAP-04 through CAP-08, CAP-10, CAP-11, CR-001 Stage 2 and shared-client parity
Type: bounded cross-platform UI change

## Existing requirement and conflict

CR-001 requires native chrome around the shared map engine and states:
"With the mode off, web and Electron behavior is unchanged."
It also requires that scientific, source-selection, loading and rendering code
be reused rather than re-implemented in Swift.

The desktop client currently displays coordinates, sampled elevation, analysis
readings and active color keys in a permanently expanded bottom-left readout.
The native iOS terrain-status control is a collapsible capsule displaying only
the shared engine's terrain status. The native bridge does not currently expose
the desktop readout. Riley requests matching collapsible information controls
with both sets of information. This changes the desktop behavior covered by
CR-001's unchanged-web condition and adds native presentation of the readout.

## Exact requested change

1. Replace the desktop's permanently expanded bottom-left map readout with a
   control that starts as a compact round bubble. Clicking opens a small rounded
   rectangular information tile; an explicit close/collapse button returns it
   to the bubble. Keep it in the allocated bottom-left map area.
2. Expand the native iOS terrain-status control into the same information
   control in the upper-right map-control area Riley identified. Keep it compact
   when collapsed and preserve access to the existing toolbar and map gestures.
3. Both controls use the same visual design: matching bubble icon, rounded tile
   shape, information hierarchy and collapse interaction. Each uses its actual
   toolbar's glass material, color, transparency, blur/texture, border and shadow.
   Desktop reuses the existing web toolbar surface; iOS uses the existing native
   toolbar's system Liquid Glass. Native chrome stays native under CR-001.
4. Both expanded tiles show location/coordinates, approximate sampled elevation
   with units, existing analysis readings when applicable, active layer color
   keys with labels/units, and the shared engine's actual loaded-terrain status
   and source information. Preserve all existing desktop readout information.
   The information control remains usable when terrain is off or unavailable;
   report those states honestly rather than hiding the other information.
5. Desktop retains its cursor-based location reading. Touch iOS uses the selected
   map location when present, otherwise the current map center, with the location
   basis labeled. Changing the location refreshes the corresponding elevation
   and applicable analysis reading. The content and meanings otherwise match.
6. Reuse shared JavaScript readout, legend, sampling and terrain-status logic,
   delivering typed data through the native bridge. Preserve source provenance,
   approximate/no-data labels, actual rendered-source reporting and existing
   loading/refinement/failure semantics. No duplicated scientific calculations,
   new data providers or changes to source ranking are authorized.
7. Preserve accessible expand/collapse names and state, keyboard operation on
   desktop, VoiceOver on iOS, platform text scaling, reduced motion/transparency,
   safe areas and short-height/landscape access. A long set of keys can scroll
   within the expanded tile instead of obscuring the map or losing information.
8. This supplements CR-001's unchanged-web condition only for this information
   control and its bridge data. Shared checks and matching bundled iOS assets
   remain required. Other accepted requests, the unapproved baseline, release
   gates and CR-001's internal distribution scope/expiry remain unchanged.
   Record one dedicated Spec Owner's review of this exact request; this does
   not appoint an ongoing owner. No deployment or distribution is requested.

## Alternatives and impact

Keeping the separate desktop readout and native status capsule would preserve
the current layout but would not provide Riley's requested combined information
or collapse behavior. A web-rendered panel inside the native app would depart
from CR-001's native-chrome requirement. The requested shared-data/native-view
approach keeps the existing renderers and calculations and reduces idle map
occlusion. It adds readout bridge updates and native legend presentation, with
no new service, spending, location permission or background location collection.
Rollback restores the desktop readout and native status capsule and removes the
added bridge fields. The change is permanent UI behavior; CR-001's exception
still expires on baseline approval/rejection or 2027-01-31, whichever comes first.

## Verification plan

- Check initial bubble, expansion and collapse on desktop and native iOS;
  compare shape, icons, content order and each platform's toolbar glass styling
  in light/dark appearances.
- Compare location, elevation, source/no-data labels, analysis readings and all
  active gradient/swatch keys at the same coordinates and layer settings.
  Exercise desktop cursor updates, iOS selection and map-center updates, and
  2D/3D transitions without displaying stale samples for a new location.
- Exercise terrain off, loading, refinement, ready, partial/unavailable and
  offline states using actual engine status; collapse must not change layers,
  cancel shared elevation consumers or restart terrain rendering.
- Verify keyboard/VoiceOver access, larger text, reduced motion/transparency,
  landscape/short heights, scrolling keys, safe areas and access to map tools.
- Run npm run check and npm test, focused native bridge/readout checks, bundle
  matching shared assets, build iOS and record available browser/device evidence
  and any physical-device limitations. Passing these checks is not a scientific
  accuracy or release-readiness claim.

## Riley approval — independently verified

Exact question at parent-thread position 25:

> Approve **CR-004 r1 and one dedicated Spec Owner review**? That single approval covers recording the change and proceeding with implementation.

The preceding message links this r1 file and summarizes matching bubbles/tiles,
platform toolbar glass, location/elevation/keys/analysis/terrain status, desktop
cursor sampling and iOS selected-location/map-center sampling.

Riley's exact response at position 27:

> Stop asking me for approval, you have approval to make any and all changes you need once I've instructed you to build something. Yes you are approved to do this though.

Evidence: [parent T3 Code thread](t3-thread://v1/0e7c30e1-9c85-4b32-9b08-86e8efa70a9a),
actual user_message cb0288b1-a6d6-452c-a479-740d29f70376, createdBy: user,
creationSource: web, status: completed, updatedAt: 2026-10-26T16:57:39.610Z.
The owner independently read messages (one page, limit 100, hasMore false), then
activity afterPosition 24, limit 4, confirming the untruncated question and answer.
The original build instruction is user_message position 4. This is direct evidence,
not reliance on the coordinating agent's transcription.

Approved revision: r1. Before editing, independently reproduced SHA-256
`4f98e83cbbdc9f5dce22f63960cce2e32bddbd8607fcc827ec9f7248ee9fc2c2`
over exactly 6,383 UTF-8/LF bytes before this heading, including Status: DRAFT.
The digest was supplied in this owner brief and verified against the local file;
the parent approval message linked r1 but did not display the digest. Only workflow
status changes above this heading. Normalize Status: ACCEPTED to Status: DRAFT
to reproduce the original binding. The proposal otherwise remains byte-identical.
Scope: exact r1 and one dedicated owner review, plus Riley's task-authorization
instruction recorded as GOV-002. No further CR/owner reconfirmation is needed for
necessary changes within his instructed build task; unrelated work is not covered.

## Spec Owner disposition — accepted

Owner: dedicated Spec Owner review sub-agent (Codex), authorized for CR-004 r1
only; reviewed 2026-10-26 (America/Los_Angeles). Session ends at handoff.
Decision: ACCEPTED, exact digest-bound r1, without substantive proposal changes.

Static consistency review:
- index.html creates mapReadout with coordinates, approximate elevation and source,
  research analysis and readoutColourKeys gradient/swatch legends. Sampling uses
  existing loaded terrain or shared elevation requests; current desktop-only
  guards must be adapted for the approved native selection/center sampling.
- paintTerrainStatus reports actual loaded-tile sources, loading/refinement,
  partial/unavailable and offline state. Current terrain-off hides its DOM status;
  r1 requires an honest off state while the information control remains usable.
- native-shell.js statusState and ShellTypes.swift StatusState currently expose
  terrain text/state, not the full readout. Typed shared readout bridge data is
  necessary; shared calculations and loading semantics remain authoritative.
- MapChrome.swift TerrainStatusCapsule is the existing expandable status control,
  currently at the upper left. Item 2 explicitly places its replacement in the
  upper-right control area. Modify that existing control, preserving toolbar
  access; do not add a second competing info panel. Parent position 38 likewise
  identifies the existing status bubble and notes its current upper-left position.
- ui-system.css contains the existing readout and toolbar glass surfaces;
  MapChrome.swift ChromeGlass supplies the native toolbar's system material.
  Item 3 expressly uses each platform's actual toolbar glass and native chrome;
  matching design/content does not require reproducing native glass with HTML.
- CR-001 shared-engine/native-chrome architecture and engineering contracts 1–10
  are preserved. Its unchanged-web condition is supplemented only for this
  information control and bridge data. CR-002 wording/math and CR-003 sharing
  remain unchanged. No consistency issue requires a proposal amendment.

Affected IDs: those listed in r1, including CR-001 Stage 2 and shared-client parity.
Spec treatment: permanent UI supplement to SPEC.md 0.1.0-draft; SPEC.md and the
pending BASE-001 package remain unchanged and unapproved. CR-001's other
conditions, shared checks/matching iOS assets, internal distribution scope and
exception expiry (BASE-001 approval/rejection or 2027-01-31, whichever first)
remain unchanged. No deployment/distribution or new scientific/source policy is
accepted by this request. GOV-002 separately records Riley's authorization rule.
Next authorized action: the coordinating implementer may implement r1 and execute
its verification plan now that acceptance is recorded. Necessary subsequent
changes within this build task use the GOV-002 owner process without asking Riley
repeatedly. The implementer does not inherit Spec Owner custody.

### ADDENDUM — 2026-10-26 placement correction (r1-a1)

Owner: dedicated Spec Owner follow-up review sub-agent (Codex), restored for
this bounded CR-004 correction under Riley's build instruction and GOV-002.
Decision: ACCEPTED. This addendum supersedes only item 2's location and the
prior disposition/handoff statements directing an upper-right replacement.
The existing native terrain-status control must be replaced IN PLACE at the
upper left; do not move it to the upper right or add a competing control.

Operative replacement for item 2 (all other r1 requirements remain in force):

```text
2. Expand the existing native iOS upper-left terrain-status control in place
   into the same information control. Keep it in the upper-left map-control
   area, compact when collapsed, and preserve access to the existing toolbar
   and map gestures.
```

Addendum revision: r1-a1. Traceability SHA-256
`2454f13483119672ac9cd3e78b69a7c6324223de29278168ddcc8a45ae1bda54`
over the UTF-8/LF replacement text inside the fence, excluding the fence lines
and including the final newline. Computed for this owner record; this digest was
not presented to Riley. The original r1 proposal remains unchanged: 6,383 bytes
with workflow status normalized to DRAFT, SHA-256
`4f98e83cbbdc9f5dce22f63960cce2e32bddbd8607fcc827ec9f7248ee9fc2c2`.
Read that original proposal together with this superseding placement addendum.

Independent authority verification: directly read the
[parent T3 Code thread](t3-thread://v1/0e7c30e1-9c85-4b32-9b08-86e8efa70a9a),
messages afterPosition 49, limit 100, hasMore false through position 82. Actual
user_message position 50, messageId 7494a1c0-9630-4abc-8f66-629f6b83120d,
createdBy: user, creationSource: web, status: completed, untruncated,
updatedAt: 2026-10-26T17:00:31.498Z, says:

> Yes, on ios i am referring to the item at upper left, on desktop it is the pane at lower right that we will be updating to this functionality, correct, good catch.

The desktop placement was then explicitly clarified in actual user_message
position 80 (createdBy: user; creationSource: server; status: completed;
untruncated; updatedAt: 2026-10-26T17:05:13.668Z). The full recorded prompt and
answer are:

> For the desktop location/elevation/color-key pane, should the new collapsible bubble stay in its current lower-left corner or move to the lower right?
> Keep its current lower-left position

The position 80 answer supersedes the desktop lower-right wording in position
50 and confirms r1 item 1: update the existing desktop mapReadout IN PLACE at
the lower left. No desktop placement clarification remains pending. Authority
comes from these actual user messages, not the parent's position 82 summary.
The earlier r1 acceptance preceded these corrections; its upper-right statements
are historical and are superseded by this addendum. GOV-002 covers this necessary
within-task owner review and recording without reconfirmation.

Consistency and acceptance checks: inspected MapChrome.swift's leading status
control before the Spacer/MapTools and ui-system.css's mapReadout left/bottom
positioning. Keeping both existing controls in place is consistent with the
allocated-area intent and preserves native chrome/shared scientific logic.
Affected references remain r1's IDs, especially U-04, UX-02/03/04 and CR-001
Stage 2. Verify iOS upper-left and desktop lower-left placement in collapsed and
expanded states, with toolbar/gesture access, safe areas, landscape/short height,
text scaling and accessibility, alongside the unchanged full r1 verification
plan. This placement review does not accept or verify the parent's app edits.
SPEC.md 0.1.0-draft, pending BASE-001, all other r1 requirements, CR-001 conditions
and expiry, scientific/loading contracts and release limits are unchanged.

Next authorized action: implement r1 as amended by r1-a1 and verify both controls
in place. Owner documents only were changed in this follow-up; no app code,
runtime/device/scientific tests, commits or delegation. Records are left
uncommitted for the parent. This bounded successor owner session ends at handoff;
owner custody does not transfer to the implementer.

## Implementation and verification

Owner recording complete; implementation and verification remain with the parent.
No app code, runtime/device/scientific checks, commit, deployment or delegation
was performed by this owner. Evidence is independent thread inspection, proposal
hash verification and the static source review above. Acceptance is not a claim
of implementation, measured visual parity, scientific accuracy or release readiness.
The full r1 verification plan remains pending, including state/source/legend parity,
stale-sample handling, accessibility, browser/device comparison, npm checks/tests,
iOS build and matching shared assets. Leave all five owner-record files uncommitted
for the parent; preserve unrelated work. This one-request owner session ends here.
