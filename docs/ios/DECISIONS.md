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
(accepted 2026-10-24) and CR-003 (accepted 2026-10-25), supplements to this draft;
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
