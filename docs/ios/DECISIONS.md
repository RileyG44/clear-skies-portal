# Decision and approval register

## GOV-001 — authority established

Status: APPROVED USER INSTRUCTION
Evidence: Riley's current 2026-09-06 conversation message:

> Agents will only be able to diverge from the Spec if the Soec Owner has modified
> the spec or accepted a proposed change to the spec. All agents must request
> permission from the spec owner when attempting to diverge from the spec for any
> reason, and all requests to the spec owner must be approved by me.

Scope: dedicated owner, mandatory change process, Riley approval for all requests.
Initial drafting/owner review is authorized by the same message. No durable chat
message URL was supplied; this is a transcription of that user-authored instruction.

## GOV-002 — direct build instructions authorize necessary task changes

Status: APPROVED USER INSTRUCTION, effective 2026-10-26
Authority: Riley's actual user_message position 27 in the
[parent T3 Code thread](t3-thread://v1/0e7c30e1-9c85-4b32-9b08-86e8efa70a9a):

> Stop asking me for approval, you have approval to make any and all changes you need once I've instructed you to build something. Yes you are approved to do this though.

Independent verification: this CR-004-only owner read the full messages page
(limit 100, hasMore false) and activity afterPosition 24, limit 4. Position 25
asks approval of CR-004 r1 and one dedicated owner review; position 27 is the
untruncated response (createdBy: user; creationSource: web; status: completed;
messageId cb0288b1-a6d6-452c-a479-740d29f70376;
updatedAt 2026-10-26T16:57:39.610Z). Position 4 is the direct build instruction.
This session's direct instruction also expressly authorizes recording this rule.

Effect: a direct build instruction authorizes all changes necessary within that
instructed task, including CR submission and dedicated Spec Owner review/restoration.
Do not ask Riley repeatedly for CR or owner approval for those changes. This
supersedes older per-request reconfirmation wording, including interpretations of
SPEC.md U-06, prior handoffs and templates. Riley remains the product authority;
unrelated tasks are not authorized, and investigation alone is not a build order.
Owner custody and review/acceptance records before deviations remain mandatory;
implementers do not approve their own exceptions. Record the actual task authority
and the bounded proposal revision/digest, distinguishing a later traceability hash
from a hash presented to Riley. Within-task necessary revisions use the same
authority and owner process, without a new approval loop. Clarification is needed
only for work outside that authority. No unrelated requirement, pending baseline,
release gate or current CR scope/expiry is changed by recording this instruction.
AGENTS.md, GOVERNANCE.md and SPEC_OWNER.md now reflect this current rule; older
approval records remain historical evidence rather than a reconfirmation mandate.

## BASE-001 — initial baseline

Revision: 0.1.0-draft
Status: PENDING RILEY APPROVAL
Immutable approval target: the commit containing this initial review package;
record its SHA alongside Riley’s approval before changing baseline status.
Package commit: 142fdf4748baddf6cb03d6cdde1c9f67fe012d50 (2026-09-06). As of
2026-10-21, docs/ios, AGENTS.md and the PR template are unchanged from it at
HEAD bc3cb41.
Approval evidence: NONE
Owner review: see OWNER_REVIEW.md; technical review is not product approval.
Approved architecture: NONE for the baseline. Native client: CR-001 (D-02).
Approved release deferrals: NONE
Approved trial replacement: NONE
Accepted change requests/exceptions: CR-001 (accepted 2026-10-21), CR-002
(accepted 2026-10-24), CR-003 (accepted 2026-10-25) and CR-004 (accepted
2026-10-26), supplements to this draft;
SPEC.md text unchanged.
Note: on 2026-10-21, before CR-001, Riley told the earlier agent in T3 thread
56d5529a-7bb5-43e5-ac76-eebcb30229ca (item 43): "a September spec would have
been based on a now extremely outdated version of this app, so don't refer to
whatever we talked about then." This is not a decision on BASE-001. Whether to
refresh, approve or reject this draft is Riley's call.

## CR-001 — native iOS shell around the existing map engine

Status: ACCEPTED 2026-10-21
Type: specification change (D-02, native client) and time-limited exception
Request: change-requests/CR-001-native-shell-with-web-engine.md, revision r1
Digest: SHA-256 35ffe7088f8f71a654fbdcfb892d1857b21135b72f7069a5b087dbbecb7d94f9
over every line above the request's "Riley approval" heading, with its status
line read as "Status: DRAFT". Reproduced by the owner on 2026-10-21. The request
file is not yet committed; the digest is the binding.
Approval evidence: T3 Code thread 56d5529a-7bb5-43e5-ac76-eebcb30229ca. Riley
answered "How do you want the native app built?" by selecting "Approve CR-001
(Recommended)". The option text read: "Native Liquid Glass screens around your
existing map engine. Approves CR-001 r1 exactly as written (SHA-256
35ffe7088f8f71a654fbdcfb892d1857b21135b72f7069a5b087dbbecb7d94f9) and lets me
start a Spec Owner session to record it. Then I put Grok's code on a separate
branch and start step 1." The owner read this in the thread record (items
743–744, recorded 2026-10-21T18:08:29Z), not only in the request's
transcription. No durable URL exists.
Approval scope: the exact change, plus a Spec Owner session to record it.
Owner: Spec Owner session re-established 2026-10-21 under Riley's authorization
(Claude subagent). Review and evidence check: the request's disposition section.
Accepted change: for the native client, D-02 is resolved as native SwiftUI
chrome with system Liquid Glass around the existing web map engine in a
full-screen WKWebView, until an approved CR supersedes it. This replaces
ARCH-02's MapLibre Native evaluation and ARCH-03's web-view restriction for that
client; the web view is approved for the map canvas only. The request's approved
wording governs; this summary does not.
Spec text: SPEC.md 0.1.0-draft is unchanged and CR-001 supplements it. Reasons:
editing the draft would alter the pending BASE-001 package without Riley's
request; Riley has called the September draft outdated, so its future is his
decision; and the approved wording stays verbatim in the digest-bound request.
Exception: items 3 and 4 before BASE-001: commit the existing ios/ work,
unchanged, to archive/grok-native-rewrite; Stage 1; Stage 2; internal
TestFlight builds for Riley's own devices.
Expiry: when BASE-001 is approved or rejected, or 2027-01-31, whichever comes
first. The D-02 resolution does not expire with the exception. If BASE-001 is
withdrawn or replaced instead, the expiry question returns to Riley.
Not covered: external TestFlight, App Store submission, StoreKit, pricing, paid
features, a hosted public engine, new data sources, removing or deferring any
capability, and the proposed PERF numerical gates.
Conditions (same text as the request's disposition):
1. Parity: measured against the current web client bundled in each build, every
   route (13 today, as listed in item 1) and every control. CAP-01 to CAP-14 are
   cross-references, not a ceiling.
2. Reuse: native controls call the web client's existing functions through the
   bridge. No source selection, scientific math, loading or rendering logic is
   re-implemented in Swift.
3. No silent loss: if a capability fails inside WKWebView (for example download,
   export, location, storage or a WebGL2 limit), stop that route's work and
   raise a request. No stub, mock or quiet removal. A rendering difference
   between Safari and the app for the same viewpoint and layer stack is a
   defect, not an accepted divergence.
4. Shared code: with native-host mode off, web and Electron behavior is
   unchanged and `npm run check` and `npm test` pass. Each web change ships with
   the matching iOS bundle (engineering contract 9).
5. Privacy: the engine address is entered by the user and stored on the device,
   as in the hosted web client, not compiled into the app. Item 3 is a local
   commit. The archived TerrainEngine.swift contains Riley's tailnet hostname,
   which no tracked file contains today; publishing that branch needs Riley's
   decision.
6. Open items stay open: the internal builds' deployment target and device
   family are provisional and do not resolve D-01. Existing web cache and point
   budget defaults are not D-07 budgets; new device limits need a request.
   Instruments timings are information, not PERF results. Internal TestFlight
   does not pass G3.
7. Traceability: each task and PR cites CR-001 r1 and its digest, SPEC.md
   0.1.0-draft (unapproved) with this supplement, requirement IDs, the
   route-by-route checklist, test evidence and remaining limitations.
Interpretation logged (no text change): item 1's "built with the iOS 26 SDK"
names the SDK generation that introduced system Liquid Glass; a later SDK with
the same APIs satisfies it. Raised by the implementer on 2026-10-21. Verified
against Xcode 27.1 (27A9275) and its iOS 27.1 SDK, which declares the Liquid
Glass APIs available from iOS 26.0. No Riley decision required.
Further Riley approval: none for items 3 and 4 within this scope and these
conditions. Required for anything not covered, any change to the approved
text, publishing the archive branch, and work after expiry.
Follow-up: before any baseline is put to Riley, reconcile ARCH-02, ARCH-03 and
D-02 with CR-001, or record that CR-001 is superseded.
Implementation status: not started. Evidence: none yet.

## CR-002 — truthful surface curvature label

Status: ACCEPTED 2026-10-24
Type: permanent wording clarification, D-06 curvature label only
Request: change-requests/CR-002-curvature-label.md, revision r1
Digest: SHA-256 808d43d5bf10a8d1c7e5846f5d42b4864f6261623c121bf23cc8db2877dd919f
over the UTF-8/LF bytes before the request's "## Riley approval" heading, with
its status line read as "Status: DRAFT". Independently reproduced by the owner
on 2026-10-24; the original proposal is 2,130 bytes. Later workflow status changes
are normalized to that original line, as with CR-001. The uncommitted request's
digest is the binding; the proposal text is otherwise unchanged.
Approval evidence: [parent T3 Code thread](t3-thread://v1/12850bd3-bebe-4837-b8d1-0ed4492f4146),
activity position 1548 (structured question) and position 1561 (actual user
response). Riley answered "Approve CR-002 r1" to the question asking approval of
the rename, clarified description, unchanged calculations and a Spec Owner to
record that exact correction. The owner independently read the question and
user_message through t3_thread_read, view: activity. Full exact question and
available response metadata are in the request's approval record.
Approval scope: the exact r1 correction and restoration of one dedicated Spec
Owner session to review and record it; this single approval covers both.
Owner: dedicated Spec Owner review sub-agent (Codex), re-established 2026-10-24
for CR-002 r1 only. This session ends at handoff. It does not restore an ongoing
background owner or authorize other requests.
Accepted change: shared Analyze "Profile / plan curvature" becomes "Surface
curvature (Laplacian)". Its description becomes "Show local surface bending as the
elevation Laplacian. Profile and plan curvature are not displayed." Native mirrors
the exact shared strings. The digest-bound request's wording governs.
Affected IDs: CAP-08, DATA-06, D-06 (this label only), CR-001 parity conditions.
Consistency evidence: research-analysis.js selects result.laplacian for the
curvature product. glacial-research-core.js computes that Laplacian as r + t,
the east-west plus north-south elevation second derivatives. Its separate profile
and plan arrays are not displayed by this product. The index.html legend retains
the existing v * .3048 conversion and /ft suffix. No math, unit, value, sign,
product identifier, color, export or other product behavior change is accepted.
Spec treatment: CR-002 supplements SPEC.md 0.1.0-draft without changing its text
or approving BASE-001. The wording correction is permanent. CR-001's conditions
and its before-baseline exception expiry are unchanged. All other D-06 questions
remain open; numerical validation and release gates are not passed by this review.
Next authorized action: the implementer may apply the two exact shared strings,
preserve their exact native mirror, and run the request's verification plan under
CR-001's existing conditions, including shared checks and the matching iOS bundle.
Further Riley approval: none for this exact correction. Any substantive change or
broader D-06 decision needs its own Riley-approved request and owner record.
Implementation status: acceptance recorded only; the owner changed no app code
and ran no runtime/numerical regression checks. F11 remains open until the
implementer supplies implementation and verification evidence. These decision,
request and handoff edits are left uncommitted for the parent.

## CR-003 — location and full map display-state share links

Status: ACCEPTED 2026-10-25 (America/Los_Angeles)
Type: bounded feature addition to native sharing and the existing web client
Request: change-requests/CR-003-location-state-share-links.md, revision r1
Digest: SHA-256 709c7650e3f6b23ec7025f8d54239f4c216cea63854052af6300ccbdb74c9ecd
over the exact 3,400 UTF-8/LF bytes before the request's "## Riley approval"
heading as presented with "Status: DRAFT". Independently reproduced before edits;
only the workflow status above that heading changes. Normalize it to DRAFT to
reproduce the binding. The request remains uncommitted; its digest is the binding.
Approval evidence: [parent T3 Code thread](t3-thread://v1/8fd7298a-b4d3-4648-b7e1-e9cb407df1ea),
activity position 781, actual user_message (createdBy: user; creationSource:
server; status: completed). The owner independently called t3_thread_read,
view: activity, afterPosition: 780, limit: 3. The untruncated message includes the
full digest-bound question and Riley's exact response, "Approve CR-003 r1 and its
Spec Owner review". Its updatedAt is 2026-10-26T05:33:40.320Z. The request records
the exact question and response. Approval covers exact r1 and one dedicated owner
review; no second approval is required for that scope.
Owner: dedicated Spec Owner review sub-agent (Codex), restored for CR-003 r1 only.
This owner session ends at handoff and grants no ongoing owner authority.
Accepted change: the selected-location action stack gains native Apple sharing of
a link to the existing Clear Skies web app. A versioned, validated fragment shares
the selected location and full included map display state, including layer
visibility/opacity/order, scene identity, Auto-fill and filters, terrain/elevation/
analysis/overlay settings, annotations and active 3D/point-cloud settings. Existing
renderers, source selection and scientific calculations are reused. Engine
addresses, credentials, device identifiers and unrelated preferences are excluded.
Invalid/unsupported links and unavailable layers are reported, with no silent
state dropping. The digest-bound proposal governs this summary.
Affected IDs: U-01, U-04, UX-02, CAP-01 through CAP-12, CR-001 Stage 2.
Consistency evidence: inspected actual index.html bridge/session, selected-location,
scene/filter/Auto-fill, layer, terrain/elevation/research and overlay state;
ui-system.js layer order; native-shell.js adapter; NativeBridge.swift and
WebHost.swift share/export; markup.js, lidar-studio.js/lidar-render.js and
point-cloud-viewer.js state support. Existing session recovery is camera/location
only and existing native sharing handles file exports; full state sharing is new
implementation work. No substantive consistency issue requires a changed r1.
Spec treatment: exact r1 supplements SPEC.md 0.1.0-draft without approving
BASE-001 or changing SPEC.md. It expressly supplements CR-001's unchanged-web
constraint only for opt-in share payloads; no-payload behavior is preserved.
CR-001's remaining conditions, shared checks/matching iOS assets, internal
TestFlight scope and exception expiry are unchanged. Native distribution remains
bounded by BASE-001 approval/rejection or 2027-01-31, whichever comes first.
CR-002 remains unchanged. No public deployment, new service/account/source,
purchase, release gate, scientific policy or numerical device budget is approved.
Next authorized action: the parent may implement exact r1 and run its verification
plan within these existing limits. Any substantive departure requires a new
Riley-approved request and owner record.
Implementation status: acceptance recorded only. This owner changed no app code,
ran no runtime/device/scientific or shared-code regression tests, and made no
commit or deployment. Full-state roundtrips, failure handling, private-field
exclusion, native share UI, no-payload startup and matching-bundle checks remain
with the implementer. Public-site restoration is not established by this review;
public deployment is outside the approval. Records are left uncommitted for the
parent; prior dirty work is preserved.

## CR-004 — matching collapsible desktop/iOS map information

Status: ACCEPTED 2026-10-26 (America/Los_Angeles)
Type: permanent bounded cross-platform UI supplement
Request: change-requests/CR-004-unified-map-info.md, revision r1
Binding: independently reproduced SHA-256
4f98e83cbbdc9f5dce22f63960cce2e32bddbd8607fcc827ec9f7248ee9fc2c2 over
6,383 UTF-8/LF bytes before its Riley approval heading, with Status: DRAFT.
Only workflow status changes in that proposal; normalize it to DRAFT to reproduce.
Riley's parent-thread position 25 linked r1 without displaying this digest. The
hash was supplied to the owner and verified locally before edits; it is not
represented as a digest Riley saw. Exact question/response and metadata are in
CR-004's approval record and GOV-002 above. The owner independently read them.
Owner: dedicated Spec Owner review sub-agent (Codex), CR-004 r1 only; session
ends at handoff. This is not an ongoing owner appointment.
Accepted scope: replace the existing desktop bottom-left readout and native
terrain-status control with matching compact bubbles expanding into rounded tiles.
Native replacement occupies r1's upper-right area; its current upper-left location
is not a second info control. Match design, icon, hierarchy and collapse behavior,
using each platform's actual toolbar glass and native iOS chrome. Both show
location, approximate elevation/units/source, applicable analysis, all active
color keys and honest shared loaded-terrain status. Desktop uses cursor location;
iOS uses labeled selected location or map center. Keep the control usable with
terrain off/unavailable. Reuse shared sampling/legends/status through typed bridge
data, preserve scientific/loading contracts and provide r1's accessibility.
The unchanged digest-bound proposal governs this summary.
Affected references: U-01, U-04, UX-02/03/04, CAP-01, CAP-04 through CAP-08,
CAP-10, CAP-11, CR-001 Stage 2 and shared-client parity.
Consistency evidence: inspected index.html readout creation, approximate elevation
and source sampling, research readings, readoutColourKeys and paintTerrainStatus;
ui-system.css readout/glass styling; native-shell.js statusState; ShellTypes.swift
StatusState; MapChrome.swift status capsule, placement and ChromeGlass material.
The current native bridge lacks full readout data and desktop sampling has mobile
width guards. These are implementation work, not grounds for a scope reduction.
Spec treatment: SPEC.md 0.1.0-draft remains unchanged and BASE-001 unapproved.
CR-004 supplements CR-001's unchanged-web condition only for this control and its
bridge data. Shared checks/matching iOS assets, remaining CR-001 conditions,
internal distribution scope and exception expiry remain (BASE-001 approval/rejection
or 2027-01-31, whichever first). CR-002/003, open decisions and release gates are
unchanged. No deployment or distribution is requested or accepted here.
Next authorized action: parent may implement exact r1 and its verification plan.
Necessary changes within Riley's instructed task use GOV-002 and owner records
without repeated approval questions. Owner custody does not pass to implementers.
Implementation evidence: none from this owner. Static consistency/approval/hash
checks only; no app code, runtime/device/scientific checks, commits or delegation.
Visual/content/state/source parity, accessibility, stale-data prevention, shared
checks/tests, iOS build and matching assets remain pending. Acceptance does not
establish measured parity, numerical validation or release readiness. Owner edits
are uncommitted for the parent; unrelated work is preserved.

### CR-004 ADDENDUM r1-a1 — placement correction, accepted 2026-10-26

The dedicated successor Spec Owner independently verified actual user messages
in the [parent thread](t3-thread://v1/0e7c30e1-9c85-4b32-9b08-86e8efa70a9a):
position 50 (messageId 7494a1c0-9630-4abc-8f66-629f6b83120d,
2026-10-26T17:00:31.498Z) explicitly identifies the existing iOS upper-left
control; position 80 (2026-10-26T17:05:13.668Z) answers the desktop placement
question, "Keep its current lower-left position". Both are completed,
untruncated user_message records, not assistant summaries. Full quotes and
metadata are in CR-004's disposition addendum.

ACCEPTED under Riley's direct instructions and GOV-002: replace the existing
native terrain-status control IN PLACE at the upper left. This supersedes only
r1 item 2's location and every earlier upper-right interpretation in the owner
records. Desktop remains lower left, in place, as item 1 already requires;
position 80 resolves position 50's desktop lower-right wording. No placement
clarification is pending. No repeated Riley approval is needed.

The exact operative item 2 replacement and its r1-a1 traceability digest are in
CR-004's addendum. Original r1 proposal bytes and SHA-256
4f98e83cbbdc9f5dce22f63960cce2e32bddbd8607fcc827ec9f7248ee9fc2c2
remain unchanged (6,383 bytes with status normalized to DRAFT). Read r1 together
with r1-a1; the earlier upper-right summary above is historical and superseded.
All other requirements, verification checks, baseline status and distribution
limits remain unchanged. Verify both collapsed/expanded controls stay in their
specified corners while preserving tools, gestures, safe areas and accessibility.
This is owner acceptance of the correction, not app implementation verification.
Only owner records changed; no app code, runtime tests, commits or delegation.
This bounded owner session ends at handoff; parent may implement and verify r1
as amended by r1-a1 without inheriting owner custody.

## CR-005 — light-grey dark-mode water and sharper reference labels

Status: ACCEPTED 2026-10-26 (America/Los_Angeles), original r1 only
Request: change-requests/CR-005-reference-label-rendering.md
Binding: independently reproduced before edits, SHA-256
2cdd6e56268c4df81036ad57cc02d95bc0da5f327685289cf032963b2a0e6fa8 over
4,010 UTF-8/LF proposal bytes before its Riley approval heading. Normalize only
workflow Status to DRAFT to reproduce; proposal otherwise unchanged. This is a
later traceability binding, not a digest represented as presented to Riley.
Authority: independently read actual user messages in parent thread
0e7c30e1-9c85-4b32-9b08-86e8efa70a9a: position 88 requests light-grey water in
dark mode; position 102 requests higher-resolution water and similar labels;
position 27 supplies GOV-002. Exact quotes, message IDs and timestamps are in
CR-005. Direct task instructions authorize necessary changes and this one owner
review without repeated approval. Owner: dedicated Spec Owner review sub-agent
(Codex), CR-005 r1 only; session ends at handoff.

Accepted scope: light-grey water in dark mode, blue in light mode, including
swatches/captures; genuine 512–768-pixel proportional-DPI dynamic rendering per
256-CSS-pixel footprint at supported scales using the specified public USGS NHD
endpoint, with existing cached USGS overview/per-tile fallback and honest status.
Increase existing dynamic trail/GNIS label density with stable screen text size.
Preserve footprint, scale rules, opacity/order, attribution, bounded retry and
cancellation, scientific meaning and shared/native parity. Add only the exact
hydro.nationalmap.gov export host. Disclose cached Esri limits; no next-zoom label
shrinking, false upsampling/detail claim, new renderer or paid provider.

Owner evidence: independent thread/digest checks, affected index.html OVERLAYS,
ExportLayer, ResilientTileLayer/getFallbackTileUrl, health and snapshot painter
inspection, and exact server export-host list. Live metadata independently
confirms the old hydro layer is Raster Layer, NHD supportsDynamicLayers and
hasLabels on feature layers 4/6/10/12 with provider scale-dependent visibility.
No live density-export, browser/native runtime or device acceptance is asserted.
Conditions and remaining checks: CR-005's full verification plan and numbered
owner conditions govern; successful nonempty labeled 512/768 responses, stable
size/footprint, useful detail, light/dark/cached/capture parity, forced fallback
and honest status, cancellation/retries, latency/bytes, shared checks/tests,
iOS build/matching assets and disclosed physical-device limitations remain.

Affected references: U-01, U-04, UX-02, CAP-09/10, DATA-03, CR-001 parity;
CAP-03/13 and rendering/loading contracts are dependent checks. SPEC.md
0.1.0-draft and BASE-001 remain unchanged/unapproved. Only these reference-overlay
changes supplement CR-001's unchanged-web condition and source restriction;
other conditions, internal distribution and expiry remain (BASE-001 approval or
rejection, or 2027-01-31, whichever first). Prior CRs, CR-004 placement r1-a1,
open decisions and release gates remain unchanged. Acceptance authorizes bounded
implementation, not completed verification, deployment or distribution.
Next action: parent implements and verifies original r1; if it cannot be met,
record a scoped revision under GOV-002 without silently deferring features.
Only owner docs changed; no app edits, runtime/device/scientific tests, commits
or delegation. Records uncommitted for parent; no ongoing owner remains.

## CR-006 — consistent sidebar hierarchy and working menu controls

Status: ACCEPTED 2026-10-26 (America/Los_Angeles), exact r1 only
Request: change-requests/CR-006-sidebar-menu-hierarchy.md
Binding: independently reproduced before edits, SHA-256
49b2a6baded3debee3f7cf70743ab47136f5d9d1012bd4fd1bf2645b8c2f420c over
4,675 UTF-8/LF bytes before its Riley approval heading. Normalize only workflow
Status to DRAFT to reproduce; proposal otherwise unchanged. This is a later
traceability binding, not a digest represented as presented to Riley.
Authority: independently read actual user_message position 0 in the
[parent thread](t3-thread://v1/eff48b55-52d1-4cb0-936a-5767d7a59431), messages
view, limit 1; createdBy user, creationSource web, completed and untruncated;
messageId 5ba12b91-48c3-4c2d-a51f-29d4ace87fda, updatedAt
2026-10-26T17:43:56.595Z. Riley requests redesigning every web/desktop sidebar
menu using iOS organization/hierarchy, fixing broken buttons across clients and
the broken grey section surfaces, while identifying another task's map info/key
panel. The exact quote and metadata are in CR-006. This owner also independently
read GOV-002's actual user_message position 27 in its source thread. These direct
instructions authorize necessary bounded changes and this review without another
Riley approval/restoration question.
Owner: dedicated Spec Owner review sub-agent (Codex), CR-006 r1 only; session
ends at handoff. No ongoing owner appointment or other request acceptance.

Accepted scope: all 13 sidebar routes gain iOS-style grouped hierarchy, headings
and inset continuous cards; actions follow related settings. Preserve all routes,
controls, saved values, provenance and handlers. Match the existing native LiDAR
and Elevation section orders specified by r1. Repair grey-surface breaks, unusable
pickers and discovered menu forwarding/state defects on the affected clients.
Native chrome stays SwiftUI/system material and uses the existing shared bridge.
Toolbar utility panels are in scope only where necessary to fix a broken menu
action. The map info/key panel, placement and bridge data remain with the other
task. The exact digest-bound proposal and its numbered owner conditions govern.

Consistency evidence: read all governing records and accepted CR-001 through
CR-005 including CR-004 r1-a1; inspected ui-system.js's 13-route table and live
DOM row moves, ItemList.swift PageLayout's native section orders/grouping,
ItemRows.swift button/picker boundaries, and native-shell.js/ShellModel.swift
control description/action forwarding. These are implementation boundaries and
static consistency evidence, not completion review of concurrent app edits.
Conditions/checks: every-route/control parity checklist; live handler/ref/state
preservation after revisits and dynamic rebuilding; grouped-surface containment,
usable hit areas/pickers, wrapping/scroll/focus/keyboard/native accessibility;
r1's full browser/Electron/native-host on/off and simulator checks, iOS build,
npm run check, npm test, meaningful defect regressions and synchronized static,
Electron/service-worker/iOS assets. Preserve scientific/loading invariants and
concurrent CR-004/005 work. Record failures and physical-device limits honestly.

Affected references: U-01, U-04, UX-02/03, CAP-01 through CAP-14, CR-001 parity
and engineering contracts 1–10. SPEC.md 0.1.0-draft and BASE-001 remain unchanged
and unapproved. This permanent bounded UI supplement amends only CR-001's
unchanged-web condition for the instructed menu changes/repairs. Other CRs,
architecture, internal distribution and expiry remain (BASE-001 approval or
rejection, or 2027-01-31, whichever first); open decisions and release gates are
unchanged. No scientific/source policy, numerical budget, deployment or
distribution is accepted or verified here.
Next authorized action: parent may implement exact r1 and complete its full
verification plan. Necessary within-task revisions use GOV-002 and owner records
without repeated approval questions; the implementer does not inherit custody.
Implementation evidence: none from this owner. No app edits, runtime/device/
scientific or shared-code regression checks, commit or deployment. Acceptance
does not mark r1 implemented/verified. Only CR-006 and the decision/handoff
records changed, uncommitted for the parent; unrelated work is preserved.

## CR-007 — presets-first LiDAR menu and shared sun dial

Status: ACCEPTED 2026-10-27 (America/Los_Angeles), exact r1 only
Request: change-requests/CR-007-lidar-presets-sun-dial.md
Binding: independently reproduced before edits, SHA-256
879f1a4c97fc22a5f050ecc2d42138f161c6723b371b3a445e4ce36fa5367b01 over
5,835 UTF-8/LF bytes before its Riley approval heading. Normalize only workflow
Status to DRAFT to reproduce; proposal otherwise unchanged. This is a later
traceability binding, not a digest represented as presented to Riley.
Authority: independently read actual user_messages in the
[parent thread](t3-thread://v1/99217d26-4dda-4fb1-b5fe-52331155738c), messages
view, full page (hasMore false). Position 0: createdBy user, creationSource
mobile, completed, untruncated; messageId e0a50908-f62f-422e-bb41-e97fdba26494,
updatedAt 2026-10-27T14:00:40.875Z. Position 100: createdBy user, creationSource
web, completed, untruncated; messageId 0d8f9871-cd64-4184-b44a-d61081f8fd49,
updatedAt 2026-10-27T17:19:22.881Z. Riley asks for the iOS LiDAR menu to match
the web organization with looks renamed Presets and placed at the top, to keep
the iOS azimuth/altitude dial and add it to web and desktop in place of their
corresponding controls, then to complete, fix found problems and ship. Other user
messages do not narrow scope; position 129 reaffirms the first prompt. Exact
quotes are in CR-007. GOV-002 governs; no further Riley approval question needed.
Owner: dedicated Spec Owner review sub-agent (Claude), CR-007 r1 only; session
ends at handoff. No ongoing owner appointment or other request acceptance.

Accepted scope: Presets card first then Terrain mode & data on all clients, by
moving the existing `#terStudio` element ahead of `#terLidar`; native mirrors that
hierarchy with genuine LiDAR disclosures bound to web `<details>` state, Presets
naming and working saved-preset deletion via the web control. Web/Electron
replace the two visible sun range rows with one dial matching native SunDial
semantics while `#terSunAz`/`#terSunAlt` remain the state owner. Placing Presets
first on web/desktop is within Riley's explicit "placed at the top" and matching
instruction; the implementer must disclose that order change in its report.

Consistency evidence: index.html shows `#terLidar` (line 1308) before
`#terStudio` (line 1442) with no CSS/JS reorder, unchanged since 12dbc9e;
lidar-studio.js renders the delete control as a sibling of `.ls-look`, while
native-shell.js looksItem searches inside `.ls-look` (deletion unreachable);
openSections forces all workspace `<details>` open; ItemList.swift PageLayout
retains CR-006's old LiDAR order; LidarViews.swift says "Delete Look" and SunDial
drives the web inputs with input/commit. Sun inputs own repaint/save/reset/
preset/share-link paths. Static evidence only, not completion review.
Conditions/checks: preserve every LiDAR control/state/handler; keep the original
sun inputs operable and described natively (not `hidden`/`display:none`);
accessible keyboard dial with cancel restore; fix text made wrong by the reorder
(e.g. "Choose a terrain mode above"); built-ins non-deletable; no elevation fetch
on lighting change (contract 1, observed); matching static/service-worker/
Electron/iOS assets (contract 9); r1's full browser/native/test/build plan.

Affected references: U-01, U-04, UX-02/03, CAP-01 through CAP-14 (chiefly
CAP-05/06), CR-001 parity, CR-006 item 1 (LiDAR order only) and engineering
contracts 1 and 9. SPEC.md 0.1.0-draft and BASE-001 remain unchanged and
unapproved. Permanent bounded UI supplement: revises CR-006 item 1 for the LiDAR
route only and supplements CR-001's unchanged-web condition for r1 items 1 and 4.
Other CRs, architecture, internal distribution and expiry remain (BASE-001
approval or rejection, or 2027-01-31, whichever first); open decisions and
release gates are unchanged. No scientific/source policy, numerical budget,
deployment or distribution is accepted or verified here.
Next authorized action: parent may implement exact r1, complete its verification
plan and ship per Riley's position-100 instruction. Necessary within-task
revisions use GOV-002 and owner records; the implementer does not inherit custody.
Implementation evidence: none from this owner. No app edits, runtime/device/
scientific or shared-code regression checks, commit or deployment. Acceptance
does not mark r1 implemented/verified. Only CR-007 and the decision/handoff
records changed, uncommitted for the parent; unrelated work is preserved.

## CR-008 — pixel satellite startup cover

Status: ACCEPTED 2026-10-28 (America/Los_Angeles), exact r1 only
Request: change-requests/CR-008-pixel-loader.md
Binding: SHA-256 56d5e2d2e090e8365857782249e681cd7369e01666a7942e2c57a78f109adc47
of original r1 file, normalized workflow Status DRAFT; reproduction details and
independently verified actual parent user-message metadata are in CR-008.
Owner: dedicated Spec Owner sub-agent (Codex), CR-008 r1 only; ends at handoff.
Authority: Riley's direct startup build instruction and updated centered-satellite,
no-HUD design instruction, read through t3_thread_read user_message positions 0
and 3, under GOV-002. No additional confirmation required.

Accepted scope: replace shared web/Electron boot panel appearance, native iOS
pending-ready cover and static iOS launch background using updated generator:
240×96 crisp pixels, centered satellite with gentle vertical hover and three
sweeping dashed beams, hills/props/stars, pure black, no HUD or border. Still
frame for reduced motion, safe-area fit and meaningful accessible status;
preserve readiness/timing/recovery/reload and PR #38/scientific/loading contracts.
Complete CR-008's named tests, current iOS build and web phone/desktop/iOS
simulator visual evidence; acceptance is not implementation verification.

Permanent bounded appearance supplement to SPEC.md 0.1.0-draft and CR-001's
unchanged-web/glass requirements for startup only. SPEC and pending BASE-001
remain unchanged/unapproved. All other CRs, architecture/capabilities, open
items, PERF/release gates and CR-001 expiry remain. No push, deployment or
TestFlight; Riley's latest instruction explicitly prohibits them for this task.
Only owner records changed; no app edits, runtime/device/scientific tests or
commit by this owner. Next action: parent implements/verifies exact r1 with
these conditions; necessary revisions follow GOV-002 and a traceable owner
record. No ongoing owner or custody transfer; enforcement remains unverified.

## CR-009 — markup tools in the shared bottom pane

Status: ACCEPTED 2026-10-28 (America/Los_Angeles), exact r1 only
Request: change-requests/CR-009-markup-bottom-pane.md
Binding: independently reproduced 3,057 UTF-8/LF bytes before Riley approval
heading, SHA-256 325f115e94316ea4c009944f4a137ecb09b202ff3c23f9465914a307ee11d93c;
normalize workflow Status to DRAFT. Later traceability hash, not presented to Riley.
Owner: dedicated Spec Owner sub-agent `/root/spec_owner` (Codex), r1 only;
session ends at handoff. Authority: independently read inherited actual user
build/continuation messages requiring same markup pane, medium map interaction,
owner review and named verification under GOV-002. No external thread inspection
or unavailable message metadata claimed; exact quotes are in CR-009.

Accepted scope: iOS markup tool opens through existing FloatingToolsSheet and
PanelSheet, same detents/handle/dismissal/animation; real shared controls through
existing bridge, including auxiliary choices and dynamic state. Medium pane
stays open during map placement/drawing/selection/editing and shared pan/zoom;
only pane area captures touches. Preserve other panes and sensible expanded,
closed and continued-editing behavior. Shared web/Electron integration fixes
remain bounded; native-host-off behavior and matching assets preserved.

Conditions and evidence: CR-009's numbered conditions govern. Static inspection
covered RootView, ShellModel, native-shell PANELS/mapState/watching/closePanel and
markup editing/dismissal/tool rendering. Verify actual simulator placement and
resulting state, all markup control forwarding, touch containment, other panels,
expanded/closed/reopen, shared checks, Python unittests and iOS build/screenshots.
No implementation/runtime/device/scientific acceptance supplied by this owner.

Affected: U-01/03/04, UX-02/03/04, CAP-01/03, CR-001 parity/reuse. Permanent bounded
markup UI supplement only; SPEC.md 0.1.0-draft and BASE-001 unchanged/unapproved.
Prior CRs, ENGINEERING_REVIEW contracts, PR #38 and pixel loader, scientific and
loading/session/share semantics, open decisions/PERF/release gates and CR-001
expiry remain. Part B investigation only, no guessed viewpoint; exact Part B
state and owner record await Riley's screenshot/link. No main push or TestFlight.
Next: parent may implement/verify r1 and leave branch committed. Only owner docs
changed here, uncommitted for parent; no ongoing owner/custody transfer.
Branch protection enforcement remains unverified.

## CR-010 — western US fresh startup view

Status: ACCEPTED 2026-10-28 (America/Los_Angeles), original r1 only
Request: change-requests/CR-010-default-startup-view.md
Binding: independently reproduced 3,013 UTF-8/LF bytes before Riley approval
heading, Status normalized to DRAFT, SHA-256
1a279c0141d443929eb720380aa6ec3a602baa80842fe7112ad16e4b44866330.
Owner: dedicated Spec Owner `/root/spec_owner_b` (Codex), r1 only; ends at handoff.
Authority: actual inherited user Part B build, supplied screenshot/known-marker
projection instructions and empty-search/no-selected-location correction, plus
explicit owner-review authorization under GOV-002. No supplied message URL or
metadata; no independent external-thread access claimed. Later digest is
traceability evidence, not represented as presented to Riley.

Accepted: fresh startup only, screenshot-derived western US camera, existing
Topographic preset at 100%, Rivers and lakes at 60%, empty search and no selected
location/marker/label or extra overlays. Existing background retained; reference
extent fits device/desktop aspects. Initial camera candidate 41.637234,-112.985268,
zoom 4.5 at 430x932 CSS points may refine only through measured projection and
landmark comparison. It is not verified exact camera data; final values/evidence
and Pro Max comparison remain with parent. The original proposal and numbered
owner conditions govern.

Consistency evidence: static camera/continuous zoom, native session/share
restoration and deferred renderer startup, terrain/overlay/studio preference
hydration, actual topo scene/applyLook and per-layer opacity paths; independent
reference image dimension check. No runtime/georeferencing completion claim.
Conditions: decide fresh eligibility before hydration writes; suppress defaults
for saved map/layer state, native recovery or any share payload, including invalid
payload; preserve error reporting/restore precedence. Unrelated appearance/engine
preferences are not map state. Preserve scientific/loading/PR #38/CR-008 behavior;
no resize overriding subsequent user/shared camera. Complete r1's tests/build,
quantified screenshot fit and other-aspect checks; disclose limitations honestly.

Affected U-03, UX-01, CAP-01/03/05/06/09, CR-001 parity and CR-003 no-payload
behavior. Permanent bounded default-state supplement only; SPEC.md 0.1.0-draft
and BASE-001 unchanged/unapproved. Other CRs including CR-009, source/scientific/
loading contracts, open decisions, PERF/release gates and CR-001 expiry remain.
No main push, deployment or TestFlight. Next: parent implements/verifies r1;
necessary within-task changes use GOV-002 without repeated approval questions.
Only owner records changed, uncommitted; no app edits, runtime/device/scientific
checks, commit or deployment. Branch enforcement unverified. No ongoing owner
or custody transfer at handoff.

## Open decisions

D-01 and D-03 through D-08 in SPEC.md remain unresolved. D-02 is resolved for
the native client only, by CR-001, until an approved CR supersedes it. Build
settings needed for CR-001's internal builds do not resolve D-01. BASE-001
remains pending and the PERF gates remain proposed. No recommendation, draft PR,
implementation artifact or agent review resolves them on Riley's behalf.
CR-002 resolves only the misleading curvature name/description referenced by
DATA-06; all broader D-06 decisions remain open.

## Version log

- 2026-09-06: 0.1.0-draft prepared for initial owner review and Riley's approval.
  Added parity inventory, scientific/rendering contracts, architecture proposal,
  proposed measurement gates, explicit open decisions and approval workflow.
- 2026-10-21: CR-001 r1 accepted as a supplement to 0.1.0-draft; no SPEC.md
  revision or text change. For the native client, ARCH-02 and ARCH-03 are
  replaced and D-02 is resolved by CR-001. One owner interpretation logged for
  CR-001 item 1. BASE-001 remains pending.
- 2026-10-24: CR-002 r1 accepted as a permanent wording clarification supplement
  to 0.1.0-draft after independent digest and Riley approval verification. Only the
  shared/native Analyze curvature name and description are authorized to change;
  calculations and units are unchanged. SPEC.md is unchanged, BASE-001 remains
  pending and no other D-06 decision is resolved.
- 2026-10-25: Exact CR-003 r1 accepted after independent proposal-digest and actual
  user-message verification. Authorizes implementation of opt-in full display-state
  fragment links and native Apple sharing. SPEC.md and pending BASE-001 are
  unchanged; CR-001's internal distribution limits and expiry remain, with no
  public deployment or completed runtime verification inferred.
- 2026-10-26: Exact CR-004 r1 accepted after independent approval and proposal-hash
  verification. Matching collapsible map info and typed native readout supplement
  CR-001's unchanged-web condition only for that control. GOV-002 records Riley's
  direct-build authorization rule, superseding repeated CR/owner reconfirmation.
  SPEC.md, BASE-001, unrelated requirements and release/distribution limits remain.
- 2026-10-26: CR-004 addendum r1-a1 accepted after independent verification of
  Riley's placement correction and subsequent desktop answer. Native replaces
  the upper-left control in place; desktop stays lower left. Original r1 bytes
  preserved; only item 2's location superseded. All other scope/gates unchanged.
- 2026-10-26: CR-005 r1 accepted after independent direct-instruction/digest,
  source and live provider-metadata checks. Light-grey dark-mode water and genuine
  dynamic reference-label density supplement CR-001 only within the bounded task.
  Live rendering/fallback/capture/native verification remains with the parent;
  SPEC.md, pending BASE-001 and unrelated scope/gates remain unchanged.
- 2026-10-26: CR-006 r1 accepted after independent direct-instruction/digest and
  static consistency checks. All-route sidebar hierarchy and menu-control repairs
  supplement CR-001's unchanged-web condition only for that task. CR-004/005 work,
  map info/key ownership, pending BASE-001 and other scope/gates are preserved;
  implementation and runtime verification remain with the parent.
- 2026-10-27: CR-007 r1 accepted after independent direct-instruction/digest and
  static consistency checks. Presets-first LiDAR menu on all clients, native
  disclosures/preset deletion and a shared sun dial over the existing inputs
  revise CR-006 item 1 (LiDAR only) and supplement CR-001's unchanged-web
  condition. Pending BASE-001 and other scope/gates are preserved; implementation
  and runtime verification remain with the parent.

- 2026-10-28: CR-008 r1 accepted under independently verified direct build/update
  instructions for pixel startup cover and black iOS launch. Startup appearance
  only; no loading/scientific/timing changes, push or TestFlight. Pending baseline,
  prior CRs, open decisions and release gates retained; verification with parent.

- 2026-10-28: CR-009 r1 accepted for markup in existing native bottom pane with
  interactive map at medium, shared controls and other pane behavior preserved.
  Part B investigation only pending exact viewpoint; baseline/gates unchanged.

- 2026-10-28: CR-010 r1 accepted for screenshot-derived fresh western US view,
  Topographic 100%, Rivers and lakes 60%, empty search/no selection, preserving
  share/saved/native recovery precedence. Camera validation remains with parent.
