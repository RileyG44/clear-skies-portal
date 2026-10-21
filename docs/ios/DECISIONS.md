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
Accepted change requests/exceptions: CR-001 (accepted 2026-10-21), a supplement
to this draft; SPEC.md text unchanged.
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

## Open decisions

D-01 and D-03 through D-08 in SPEC.md remain unresolved. D-02 is resolved for
the native client only, by CR-001, until an approved CR supersedes it. Build
settings needed for CR-001's internal builds do not resolve D-01. BASE-001
remains pending and the PERF gates remain proposed. No recommendation, draft PR,
implementation artifact or agent review resolves them on Riley's behalf.

## Version log

- 2026-09-06: 0.1.0-draft prepared for initial owner review and Riley's approval.
  Added parity inventory, scientific/rendering contracts, architecture proposal,
  proposed measurement gates, explicit open decisions and approval workflow.
- 2026-10-21: CR-001 r1 accepted as a supplement to 0.1.0-draft; no SPEC.md
  revision or text change. For the native client, ARCH-02 and ARCH-03 are
  replaced and D-02 is resolved by CR-001. One owner interpretation logged for
  CR-001 item 1. BASE-001 remains pending.
