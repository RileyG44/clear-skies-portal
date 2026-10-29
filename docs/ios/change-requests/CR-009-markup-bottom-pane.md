# CR-009 — markup tools in the shared bottom pane

Status: ACCEPTED
Request content revision: r1; SHA-256 of UTF-8/LF bytes before Riley approval heading (recorded below).
Author / task: coordinating implementer, markup pane / default startup view task, 2026-10-28.
Current approved spec revision: SPEC.md 0.1.0-draft remains unapproved; CR-001 r1 and accepted CR-002–008 supplements govern.
Affected requirement IDs: U-01, U-03, U-04, UX-02/03/04, CAP-01/03, CR-001 parity and reuse conditions.
Type: permanent bounded UI supplement.

## Existing requirement and conflict

CR-001 requires native SwiftUI chrome around the shared web map. Current markup
controls remain a web popover, unlike camera/layers/engine native panels; markup
map touches dismiss controls. Riley now explicitly requests the same bottom pane
and continued map interaction at its medium detent. No scientific change is needed.

## Exact requested change

On iOS route the markup toolbar action to the existing FloatingToolsSheet and
PanelSheet, reusing its medium/expanded detents, handle, gestures, dismissal,
glass and animation. Describe and forward every markup tool/control through the
existing bridge to the real shared control/state, including dynamically rebuilt
controls and auxiliary choices; no replacement markup model or calculations.
Keep the exposed map interactive at medium for placing, drawing, selecting and
editing markups and pan/zoom. Native markup controls remain open during map use;
only the pane area captures touches. Preserve sensible expanded/closed behavior,
editing continuation after dismissal, and other panes' current touch behavior.
Shared web/Electron changes are limited to necessary markup integration fixes;
keep native-host-off behavior consistent with its existing UI. Synchronize assets.
This request covers Part A only. Investigate startup/presets/opacity/share restore
for Part B without guessing or implementing a viewpoint before Riley supplies it;
record Part B separately when exact state is available.
Permanent UI supplement only; all scientific/loading, sharing/session, PR #38,
pixel loader, prior CRs, pending baseline, release gates and CR-001 expiry remain.
No push to main, production deployment or TestFlight. Leave isolated branch committed.

## Alternatives and impact

A parallel pane or dismiss-on-map controls would fail Riley's instruction.
Reuse existing panel and map handlers to avoid scientific, provider, privacy or
cost changes. Roll back bounded UI/bridge changes to restore prior presentation.

## Verification plan

Run npm run check, npm test, Python unittests and simulator iOS build. Add meaningful
regressions for panel forwarding/state and native-only dismissal behavior. Verify
on iOS simulator with screenshots: open from markup button, half-open placement,
selection/edit/drawing, pan/zoom, pane controls capturing touches, expand/collapse,
close/reopen and existing camera/layers/engine behavior. Report physical-device
and any unverified controls honestly. Inspect Part B precedence without changes.

## Riley approval

Authority: direct user build instruction in this conversation, 2026-10-28, under GOV-002.
Exact relevant text:
> Make it open the markup tool panel as a bottom-up pane, exactly like the camera/capture, layer, and terrain engine buttons do (reuse that same pane component, detents, drag handle, dismissal and animation; don't build a parallel one).
> When the markup pane is at its "half open" position, the map above it must stay fully interactive: Riley must be able to place and edit markups/annotations on the map (taps, drags, drawing, selecting) and also pan/zoom. Only the pane's own area captures touches.
> Continue user's Part A markup bottom pane and Part B startup view task. User instructions in history are authoritative.
> draft bounded CR and obtain dedicated Spec Owner review as AGENTS requires (explicitly authorized delegation for owner only).
Available reference: current conversation's inherited user messages; no message URL supplied. Owner can independently inspect inherited user text.
Binding: SHA-256 325f115e94316ea4c009944f4a137ecb09b202ff3c23f9465914a307ee11d93c; later traceability digest, not represented as presented to Riley.
Scope: direct build authorization for Part A and dedicated owner review; Part B investigation until exact viewpoint arrives.

## Spec Owner disposition

Owner: dedicated Spec Owner sub-agent `/root/spec_owner` (Codex), CR-009 r1
only; reviewed 2026-10-28 (America/Los_Angeles). Session ends at handoff.
Decision: ACCEPTED for exact original r1, with the existing proposal applied as
specified below. Independently reproduced before edits: 3,057 UTF-8/LF bytes
before the Riley approval heading, SHA-256
`325f115e94316ea4c009944f4a137ecb09b202ff3c23f9465914a307ee11d93c`.
Normalize only the workflow Status line to DRAFT to reproduce. Proposal text is
otherwise unchanged. This later traceability hash was not presented to Riley.

Authority: independently read the inherited actual user messages, including the
original two-part build instruction and subsequent continuation explicitly
requiring a bounded CR and dedicated Spec Owner review. The original explicitly
requires the same pane component, medium map interaction, preserving other panes,
no guessed Part B viewpoint, isolated branch, named tests, simulator screenshots,
no main push and no TestFlight. This is direct user text in inherited context,
not merely the parent's summary; no durable message URL or metadata was provided,
and no external thread inspection is claimed. GOV-002 supplies the authorization
rule; no repeated Riley approval/restoration question is required.

Static consistency evidence: inspected RootView.swift FloatingToolsSheet's shared
medium/expanded heights, bounded content shape and gestures; ShellModel.swift's
panel routing, mapBusy and applyMap; native-shell.js PANELS/describePanel,
mapState, mutation watching and closePanel; markup.js startEditing, setToolsOpen,
map pointerdown dismissal, tool switching and paintBar. Markup is absent from the
native panel routing and currently reports drawing from visible mkBar, which
can close a native sheet on entry. These boundaries need coordinated integration,
not a second pane or a replacement scientific/annotation model.

Acceptance conditions (apply r1; no extra scope):
1. Reuse FloatingToolsSheet/PanelSheet and existing bridge handlers, preserving
   every markup control and auxiliary choice, disabled/selected state, dynamic
   references, layer switching, undo/redo and selected-feature edits. A native
   equivalent must exist before its web control is hidden from users/VoiceOver.
2. Keep the exposed map interactive at medium without dismissing the native
   markup pane or closing it through drawing/mapBusy synchronization. Drawing,
   selection/manipulation and pan/zoom retain the shared tools' existing gesture
   semantics. Pane gestures capture only the pane area; other panes retain their
   existing behavior. Closing the pane must not unintentionally end editing.
3. Exercise actual simulator touches for placement with medium pane visible,
   drawing/selection/editing and pan/zoom, plus full/closed states and controls'
   touch containment. Verify representative camera/layers/engine regressions,
   dynamic rebuilds, reopening, keyboard, safe areas and accessible controls.
   Screenshots alone do not prove successful placement; inspect resulting state.
4. Complete r1's JS/Python/build checks and synchronized shared packaging.
   Preserve ENGINEERING_REVIEW contracts, PR #38 startup selection, share/session
   precedence and CR-008 readiness/appearance. Record failures and physical-device
   limits honestly; owner acceptance supplies no runtime verification.

Spec treatment: permanent bounded UI supplement to SPEC.md 0.1.0-draft and
CR-001 Stage 2 for markup only. The draft and BASE-001 remain unapproved and
unchanged. Other CRs, scientific/source/loading contracts, open decisions, PERF
and release gates, and CR-001 expiry (BASE-001 approval/rejection or 2027-01-31,
whichever first) remain. Part B is investigation only in this request; exact
viewpoint and its owner record remain outstanding. No deployment, TestFlight or
main push accepted. Next action: parent implements/verifies r1 on the isolated
branch. Necessary within-task revisions use GOV-002 without repeated approval;
implementer does not inherit owner custody.

## Implementation and verification

Owner acceptance only; implementation and verification remain with parent.
This owner changed only CR-009, DECISIONS.md and SPEC_OWNER.md; no app changes,
runtime/device/scientific tests, commits, push or deployment. Leave records
uncommitted for parent; preserve unrelated work. Branch protection and mandatory
spec-path review enforcement remain unverified. This CR-009-r1-only session ends
at handoff; no ongoing owner remains.

Implementer evidence: shared native pane adapter and drawing retention implemented.
See ../../verification/markup-default-view/README.md for checks, real simulator
placement/drawing/selection/drag evidence and explicit remaining gesture checks.
This evidence does not amend the owner's disposition or the draft baseline.
