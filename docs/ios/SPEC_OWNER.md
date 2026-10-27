# Dedicated Spec Owner — role and handoff

Project: Clear Skies Native iOS
Appointed by: Riley Grant, current 2026-09-06 user request
Initial agent: /root/spec_owner (session handle, not a permanent service)
Current owner session: none after this handoff. The dedicated Spec Owner review
sub-agent (Claude) recorded CR-007 r1 acceptance on 2026-10-27 under Riley's direct
LiDAR menu/sun dial instruction and GOV-002. This bounded session ended at handoff;
it is not a running service and the implementer does not inherit owner custody.
Current baseline: SPEC.md 0.1.0-draft (commit 142fdf47) — not approved by
Riley; BASE-001 pending
Accepted requests: CR-001 r1 (2026-10-21), CR-002 r1 (2026-10-24), CR-003 r1
(2026-10-25), CR-004 r1 with r1-a1, CR-005 r1 and CR-006 r1 (2026-10-26),
CR-007 r1 (2026-10-27); see DECISIONS.md.
Current authority: GOV-002, Riley's direct build instruction authorizes necessary
task changes and dedicated owner review without repeated CR/restoration questions.
Current task: CR-007 r1 accepted for bounded implementation/verification by its
parent: Presets-first LiDAR menu on all clients, native LiDAR disclosures and
saved-preset deletion, and the native sun dial brought to web/desktop over the
existing `#terSunAz`/`#terSunAlt` inputs. Only CR-007 r1 was reviewed for
acceptance by this session. CR-007 revises CR-006 item 1 for the LiDAR route only;
CR-006's other routes, CR-004 r1+r1-a1 and CR-005 r1 remain as recorded. Runtime
verification is not supplied by this handoff.

## Start here

Read root AGENTS.md, SPEC.md, GOVERNANCE.md, DECISIONS.md and all accepted,
unexpired change requests. Inspect affected source and tests, not just README.
Read OWNER_REVIEW.md for the initial independent review and known limitations.

## Responsibilities

- Own the canonical spec; prevent assumptions from becoming silent requirements.
- Maintain stable requirement IDs, parity matrix, open decisions, acceptance gates,
  version log, approved exceptions and traceable Riley approval evidence.
- Review only owner requests authorized by Riley. Initial draft review is expressly
  authorized by the appointment; necessary requests/review sessions within a direct
  build instruction use its existing authorization under GOV-002.
- Advise Riley candidly on tradeoffs; never approve a deviation on Riley's behalf.
- After Riley approves the exact change, accept/reject for consistency and apply
  the corresponding spec change or scoped exception. Necessary changes within a
  direct build instruction use its authority and a traceable revised owner record;
  ask Riley only for work outside that authority, not repeated within-task approval.
- For approved implementation-review requests, distinguish code completion, measured
  acceptance, live provider verification, scientific validation and release readiness.
- At handoff, record current spec/revision, approved request IDs, outstanding blockers,
  implementation evidence and the next authorized action. Do not spawn successors
  or assume perpetual execution without Riley's authorization.

## Review checklist

1. Is this bounded revision/digest covered by Riley's direct build instruction or
   exact-proposal approval, with independently checked evidence under GOV-002?
2. Does the proposed change preserve or explicitly amend feature parity?
3. Are source validity, units, datum, acquisition dates and scientific meaning honest?
4. Are loading, cache, offline, lifecycle and failure contracts maintained?
5. Are native/device and cost claims backed by relevant measurements?
6. Are all affected requirements and tests accounted for, including temporary code?
7. Is acceptance or refusal recorded with scope, conditions and follow-up?

An agent's confident assertion, a green CI result, or Riley approving a different
request does not establish approval for this one.

## Handoff — 2026-10-21

- Spec: SPEC.md 0.1.0-draft, unchanged since commit 142fdf47. CR-001 r1
  supplements it: for the native client it replaces ARCH-02 and ARCH-03 and
  resolves D-02. Read the request, its disposition and DECISIONS.md together.
- Accepted requests: CR-001 r1 (digest in DECISIONS.md), with conditions 1–7.
  Its exception expires when BASE-001 is approved or rejected, or 2027-01-31,
  whichever comes first.
- Implementation evidence: none yet. Riley's approval and this acceptance are
  not test, device or field evidence.
- Next authorized action: the implementer may do CR-001 item 3 (local archive
  commit), Stage 1, Stage 2 and internal TestFlight builds for Riley's own
  devices, within the stated scope and conditions. Anything else needs a new
  request approved by Riley.
- Outstanding blockers:
  - BASE-001 is pending. On 2026-10-21 Riley said the September draft reflects
    an outdated app; a refresh or decision is his call. Approving or rejecting
    BASE-001 ends the CR-001 exception. If BASE-001 is withdrawn or replaced
    instead, return the expiry question to Riley.
  - Before any baseline goes to Riley, reconcile ARCH-02, ARCH-03 and D-02 with
    CR-001.
  - D-01 and D-03 to D-08 are open; the PERF gates are proposed.
  - CR-001 and this session's record edits are uncommitted. They must be
    committed for the record to live in git.
  - Branch protection and required Riley review of spec paths were not verified
    in this session.
  - The archive branch will contain Riley's tailnet hostname. Publishing it
    needs his decision.

## Handoff — 2026-10-24 (CR-002 r1 only)

- Authority: Riley answered "Approve CR-002 r1" in the
  [parent T3 Code thread](t3-thread://v1/12850bd3-bebe-4837-b8d1-0ed4492f4146).
  This owner independently inspected activity position 1548 (question) and 1561
  (actual user response), including the express authorization to restore one
  Spec Owner session to record this exact correction. The approval of r1 covers
  both restoration and recording; no second approval is needed for that scope.
- Spec: SPEC.md 0.1.0-draft is unchanged from the pending package at commit
  142fdf4748baddf6cb03d6cdde1c9f67fe012d50 and remains unapproved. Read it with
  accepted supplements CR-001 r1 and CR-002 r1. CR-001's conditions 1–7 and
  exception expiry are unchanged.
- CR-002 binding: SHA-256
  808d43d5bf10a8d1c7e5846f5d42b4864f6261623c121bf23cc8db2877dd919f over the
  UTF-8/LF proposal bytes before its "## Riley approval" heading, normalizing
  only the workflow status to the original "Status: DRAFT". Independently
  reproduced here; the request records exact approval and review evidence.
- Accepted scope: permanent shared Analyze curvature name/description correction
  with the exact native mirror. CAP-08, DATA-06, D-06 (this label only) and
  CR-001 parity conditions are the affected references. No other D-06 decision
  is resolved. The request's original digest-bound proposal governs.
- Review evidence: static source inspection confirms result.laplacian is the
  displayed curvature product, computed as the sum of east-west and north-south
  elevation second derivatives. The existing legend conversion is v * .3048 with
  a /ft suffix. No calculation, unit, product identifier or behavior change is
  authorized by this correction.
- Implementation evidence for CR-002: none from this session. The owner changed
  no app code and ran no runtime/numerical regression checks. Acceptance records
  permission to implement; F11 is not marked implemented or verified.
- Next authorized action: the coordinating implementer may apply the two exact
  shared UI strings in CR-002, preserve their exact native mirror, and verify
  the strings, unchanged result.laplacian selection and /ft conversion, and the
  research-analysis/scientific regressions. CR-001's shared-code checks and
  matching iOS bundle still apply. Leave these owner records uncommitted for
  the parent to include with its work.
- Outstanding: BASE-001 remains pending; D-01 and D-03 through D-08 remain open
  except the narrow CR-002 curvature wording correction. PERF gates remain
  proposed. This review does not establish device/scientific validation or
  release readiness. Branch protection and required Riley review of spec paths
  were not verified in this session.
- Continuity: this one-request owner session ends at this handoff. A future
  request or owner restoration needs Riley's authorization under GOVERNANCE.md;
  the coordinating implementer does not inherit owner approval authority.

## Handoff — 2026-10-25 (CR-003 r1 only)

- Authority: the owner directly inspected the
  [parent T3 Code thread](t3-thread://v1/8fd7298a-b4d3-4648-b7e1-e9cb407df1ea)
  through t3_thread_read, view: activity, afterPosition: 780, limit: 3. Actual
  user_message position 781 contains the full digest-bound question and Riley's
  exact response, "Approve CR-003 r1 and its Spec Owner review" (createdBy: user;
  updatedAt: 2026-10-26T05:33:40.320Z, 2026-10-25 in America/Los_Angeles). The
  request records the exact evidence. This one approval covers exact r1 and this
  one owner review; no second approval is required within that scope.
- Binding: independently reproduced SHA-256
  709c7650e3f6b23ec7025f8d54239f4c216cea63854052af6300ccbdb74c9ecd over the
  original 3,400 bytes before CR-003's "## Riley approval" heading. Only the
  workflow status changes above it; normalize to "Status: DRAFT" to reproduce.
- Disposition: exact r1 ACCEPTED, with no substantive proposal adjustment. Add
  opt-in versioned, validated full map display-state fragment links and native
  Apple sharing from the selected-location stack. The approved proposal governs
  all included state, private-field exclusions, failure reporting and unchanged
  no-payload behavior; no silent omission or new cap is accepted.
- Spec: SPEC.md 0.1.0-draft and pending BASE-001 are unchanged and unapproved.
  Read them with CR-001, CR-002 and CR-003. CR-003 expressly supplements only
  the opt-in sharing behavior under CR-001's web behavior constraint. Remaining
  CR-001 conditions, internal TestFlight scope and exception expiry remain:
  BASE-001 approval/rejection or 2027-01-31, whichever comes first. No public
  deployment, new service/account/source, purchase or release is approved.
- Review evidence: inspected actual shared bridge/session/layer and control
  state, native adapter/bridge and WebHost.swift's export share sheet, plus
  markup, LiDAR Studio/render model and point-cloud state support. Current
  session recovery is camera/location only; full state sharing still needs
  implementation. No substantive consistency issue requires Riley to amend r1.
- Implementation evidence: none from this owner session. No app code changes,
  runtime/device/scientific or shared-code regression tests, commits or deployment.
  Acceptance authorizes implementation, not a claim of completed restoration or
  validation. The current public site's support for the new format is unverified.
- Next authorized action: the parent may implement exact r1 and run its stated
  verification plan, including full-state fresh-session roundtrips, invalid and
  unavailable-state reporting, private-field exclusion, native share UI,
  no-payload startup, shared checks/tests and matching iOS assets. Preserve the
  approved existing rendering/source-selection/scientific functions. A
  substantive departure returns through Riley and the owner workflow.
- Record handling: CR-003, DECISIONS.md and SPEC_OWNER.md are left uncommitted
  for the parent. All prior dirty work is preserved. BASE-001, other open
  decisions and proposed PERF gates remain unresolved; branch protection and
  required Riley review of spec paths were not verified in this session.
- Continuity: this CR-003-only owner session ends at this handoff. No other
  request is reviewed, and the parent does not inherit owner approval authority.

## Handoff — 2026-10-26 (CR-004 r1 only)

- Authority: independently inspected parent thread
  0e7c30e1-9c85-4b32-9b08-86e8efa70a9a, messages (one full page, limit 100,
  hasMore false) and activity (afterPosition 24, limit 4). Position 25 asks
  approval of CR-004 r1 and one dedicated owner review; actual user_message
  position 27 grants it and directs no repeated approval requests. Exact text,
  metadata and reference are recorded in CR-004 and DECISIONS.md GOV-002.
- Binding: independently verified 6,383 bytes before the approval heading as
  Status: DRAFT, SHA-256
  4f98e83cbbdc9f5dce22f63960cce2e32bddbd8607fcc827ec9f7248ee9fc2c2.
  Only workflow status changes above the heading; normalize it to DRAFT to
  reproduce. The approval linked r1 but did not present this hash; the local
  matching digest was supplied in the owner brief and checked before editing.
- Disposition: exact r1 ACCEPTED. Matching bubble/rounded-tile information controls
  combine all existing desktop readout content with shared terrain status, reuse
  shared sampling/legends/calculations through typed native data and use each
  toolbar's actual glass. Desktop remains bottom-left; the existing iOS status
  control is replaced in r1's upper-right area. Its current upper-left placement
  was independently confirmed. Preserve toolbar access and native chrome.
- Spec: SPEC.md 0.1.0-draft unchanged, BASE-001 pending. Read CR-004 with accepted
  CR-001/002/003. Only the information-control/bridge behavior supplements
  CR-001's unchanged-web condition. Existing scientific/loading contracts,
  shared checks/matching iOS assets and internal distribution limits/expiry
  remain. No deployment/distribution, numerical policy or release gate is passed.
- Governance: GOV-002 records Riley's exact latest instruction. Direct builds
  authorize all necessary within-task changes, CRs and dedicated owner review;
  do not ask repeated approval/restoration questions. AGENTS.md and GOVERNANCE.md
  reflect it. This supersedes older reconfirmation wording in this handoff and
  other records/templates. Owner review/custody still applies; unrelated work
  remains unauthorized. This session accepts no other request.
- Evidence: static source review of index.html shared readout/sampling/analysis/
  legend/status, ui-system.css surfaces, native-shell.js, ShellTypes.swift and
  MapChrome.swift. No app code, runtime/device/scientific checks, commits or
  delegation. Acceptance authorizes implementation and does not verify it.
- Next authorized action: parent may implement r1, preserving all existing desktop
  information and actual source/no-data/refinement/offline meanings, and complete
  r1's full browser/native, state/legend parity, stale-sample, accessibility,
  shared check/test, matching-bundle and iOS build verification. Report physical
  device limits honestly. Necessary within-task revisions follow GOV-002 and
  the owner record process without another Riley approval loop.
- Record handling: CR-004, DECISIONS.md, SPEC_OWNER.md, GOVERNANCE.md and AGENTS.md
  left uncommitted for the parent. Unrelated work preserved. BASE-001, unresolved
  decisions and proposed PERF gates remain; branch protection/required reviews
  were not verified. This dedicated CR-004-only owner session ends at handoff.

## Handoff — 2026-10-26 (CR-004 placement addendum r1-a1 only)

- Authority: Riley's existing direct build instruction and GOV-002 authorize this
  bounded successor owner review without reconfirmation. Independently read the
  parent thread's newest messages through position 82 (afterPosition 49,
  limit 100, hasMore false). Actual user_message position 50 explicitly identifies
  the iOS upper-left status control. Actual user_message position 80 answers the
  desktop placement question: "Keep its current lower-left position". Exact
  quotes/metadata are in CR-004's addendum; these are direct user records, not
  the parent's summary. No desktop placement question remains pending.
- Disposition: r1-a1 ACCEPTED. Replace the existing iOS upper-left terrain-status
  control IN PLACE; do not move it to the upper right. Only r1 item 2's location
  is superseded. Desktop stays lower left, in place, confirming item 1 and
  superseding position 50's lower-right wording. Prior owner upper-right
  statements, including the earlier handoff above, are historical and superseded.
- Binding: original r1 proposal bytes preserved and independently rechecked:
  6,383 UTF-8/LF bytes with status normalized to DRAFT, SHA-256
  4f98e83cbbdc9f5dce22f63960cce2e32bddbd8607fcc827ec9f7248ee9fc2c2.
  CR-004 records the exact operative replacement and its r1-a1 traceability hash;
  that later hash was not presented to Riley. Read r1 with this addendum.
- Consistency: inspected the native leading status control/Spacer/MapTools order
  and desktop mapReadout left/bottom CSS. The correction preserves the existing
  allocated areas, native chrome and shared scientific/loading logic. All other
  r1 requirements, accepted CRs, SPEC.md 0.1.0-draft, pending BASE-001, CR-001
  distribution limits/expiry and release gates are unchanged.
- Next authorized action: parent may implement r1 as amended by r1-a1 and run its
  full verification plan. Check both collapsed and expanded controls remain in
  the specified corners, with tools, gestures, safe areas, text scaling,
  accessibility and landscape/short-height access preserved.
- Evidence/limits: direct message verification, proposal-hash reproduction and
  static placement inspection only. No app code, app acceptance/runtime/device/
  scientific tests, commits or delegation by this follow-up owner. Parent's
  concurrent app changes were not reviewed for acceptance. Only CR-004,
  DECISIONS.md and SPEC_OWNER.md changed here, left uncommitted for the parent;
  all unrelated dirty work preserved.
- Continuity: this bounded successor session ends at handoff. No ongoing owner
  remains and the parent does not inherit owner custody. Existing unresolved
  decisions/PERF gates and unverified branch-protection enforcement remain as
  recorded in prior handoffs.

## Handoff — 2026-10-26 (CR-005 r1 only)

- Authority: independently inspected actual parent-thread user messages 88 and
  102 requesting light-grey water in dark mode and sharper river/lake/similar
  labels, plus position 27's GOV-002. Exact quotes, IDs and timestamps are in
  CR-005. Direct instructions authorize this bounded owner session and necessary
  task changes without repeated Riley approval/restoration questions.
- Binding: independently computed before editing, SHA-256
  2cdd6e56268c4df81036ad57cc02d95bc0da5f327685289cf032963b2a0e6fa8 over
  4,010 UTF-8/LF proposal bytes before the approval heading. Normalize only Status
  to DRAFT to reproduce. Proposal otherwise byte-identical; the later digest is
  traceability evidence and was not represented as presented to Riley.
- Disposition: original CR-005 r1 ACCEPTED. Light-grey dark-mode water/blue light
  mode, matching swatches/captures, genuine 512–768-pixel proportional-DPI dynamic
  NHD rendering at supported scales, cached overview/per-tile fallback with
  honest health, increased existing trail/GNIS density, exact hydro.nationalmap.gov
  export-host addition and shared/native parity. Cached Esri limits disclosed;
  no next-zoom text shrinking, upsampling claim, new renderer or paid provider.
  The original proposal and its numbered owner conditions govern.
- Evidence: independent thread/digest checks; static OVERLAYS, ExportLayer,
  ResilientTileLayer/getFallbackTileUrl/health and snapshot painter inspection;
  existing exact server host list. Independently fetched live metadata confirms
  cached water is Raster Layer and NHD dynamic capability/scale-dependent labeled
  layers 4/6/10/12. Metadata establishes a viable integration boundary, not
  successful labeled images or measured sharpness/performance.
- Next action: parent may implement original r1 and complete its full plan:
  successful labeled 512/768 responses with stable screen size/footprint and
  useful detail; representative WA/scales; light/dark map/swatches/capture parity;
  cached overview/forced fallback and honest status; cancellation/retries,
  latency/bytes, native comparison, shared checks/tests/build and matching assets.
  Real density samples are being obtained by the parent; this owner did not
  verify them. Disclose physical-device and cached-Esri limits. If r1 cannot be
  met, stop only the affected work and record a scoped revision under GOV-002;
  do not silently defer the requested improvement or ask repeated approval.
- Scope: SPEC.md 0.1.0-draft and pending BASE-001 unchanged/unapproved; accepted
  CR-001/002/003 and CR-004 r1+r1-a1 retained. Only these reference-overlay changes
  supplement CR-001's web/source constraints. Its remaining conditions, internal
  distribution and expiry (BASE-001 approval/rejection or 2027-01-31, whichever
  first), open decisions, proposed PERF gates and release gates remain unchanged.
  No deployment/distribution or scientific accuracy claim is accepted.
- Record handling: only CR-005, DECISIONS.md and SPEC_OWNER.md changed here,
  uncommitted for the parent. No app code, runtime/device/scientific tests,
  commits, deployment or delegation. Preserve all unrelated work. Acceptance
  does not mark r1 implemented/verified. Branch protection/required spec reviews
  remain unverified. This CR-005-only session ends here with no ongoing owner;
  custody does not pass to the parent implementer.

## Handoff — 2026-10-26 (CR-006 r1 only)

- Authority: independently read the actual user_message at position 0 in the
  [parent thread](t3-thread://v1/eff48b55-52d1-4cb0-936a-5767d7a59431), messages
  view, limit 1; completed, untruncated, createdBy user, creationSource web,
  messageId 5ba12b91-48c3-4c2d-a51f-29d4ace87fda, updatedAt
  2026-10-26T17:43:56.595Z. Riley directly requests every web/desktop sidebar
  menu be reorganized like iOS, broken buttons fixed across clients and grey
  section-tile breaks repaired, while leaving another task's map info/key panel
  alone. Exact quote/metadata are in CR-006. Also independently read GOV-002's
  actual user_message position 27 in its source thread. No repeated Riley
  approval/restoration question is needed for exact r1 and this bounded review.
- Binding: independently reproduced before edits, SHA-256
  49b2a6baded3debee3f7cf70743ab47136f5d9d1012bd4fd1bf2645b8c2f420c over
  4,675 UTF-8/LF bytes before CR-006's Riley approval heading. Normalize only
  workflow Status to DRAFT to reproduce. Proposal otherwise unchanged; this
  later traceability hash was not represented as presented to Riley.
- Disposition: exact CR-006 r1 ACCEPTED without substantive proposal changes.
  All 13 routes retain every control, saved value, provenance and handler while
  gaining iOS-style grouped hierarchy and inset continuous surfaces. Native
  LiDAR/Elevation order follows r1. Repair full-width actions, constrained
  pickers and discovered menu forwarding/state defects through the shared
  bridge, preserving native SwiftUI/system materials. R1 and its numbered owner
  conditions govern. Utility-panel work is limited to necessary menu repairs.
- Evidence: governing/accepted-request reads and static inspection of the
  ui-system.js route table/live-control moves, ItemList.swift PageLayout,
  ItemRows.swift button/picker rows and native-shell.js/ShellModel.swift action
  boundaries. No runtime acceptance or completion review of concurrent app edits.
- Next action: parent may implement exact r1 and run its complete plan. Maintain
  an every-route/control checklist, verify handler/ref/live-state persistence
  across revisits and dynamic rebuilding, continuous cards/actions, usable
  pickers/hit areas, wrapping/scrolling, keyboard/focus/native accessibility and
  light/dark/wide/narrow layouts. Exercise web/Electron/native-host on/off and
  native simulator, build iOS, run npm run check/npm test and meaningful defect
  regressions, and synchronize static/Electron/service-worker/iOS assets.
  Disclose failures and unavailable physical-device checks. Representative
  interactions alone cannot establish every-control parity.
- Scope: SPEC.md 0.1.0-draft and pending BASE-001 unchanged/unapproved. CR-006
  supplements only CR-001's unchanged-web condition for this task. All other
  accepted CRs, scientific/loading contracts, open decisions, proposed PERF and
  release gates remain. CR-001's internal distribution/expiry still applies:
  BASE-001 approval/rejection or 2027-01-31, whichever first. No deployment,
  distribution, numerical budget or scientific/source-policy change accepted.
- Concurrent work: preserve CR-004 r1+r1-a1 and CR-005 r1 records and app changes.
  The map info/key panel, placement and bridge data remain the other task's
  responsibility; iOS upper-left/desktop lower-left placement is unchanged.
  CR-002 exact wording/math and CR-003 sharing also remain intact.
- Record handling and limits: only CR-006, DECISIONS.md and SPEC_OWNER.md owner
  records changed here, uncommitted for the parent. No app edits, runtime/device/
  scientific or shared-code regression checks, commit or deployment by this
  owner. Acceptance does not mark r1 IMPLEMENTED or VERIFIED. Branch protection
  and required spec reviews remain unverified. Necessary within-task revisions
  use GOV-002 and traceable owner records without repeated approval questions.
- Continuity: this dedicated CR-006-r1-only session ends at this handoff. No
  ongoing owner remains; the parent implementer does not inherit owner custody.

## Handoff — 2026-10-27 (CR-007 r1 only)

- Authority: independently read actual user_messages in the
  [parent thread](t3-thread://v1/99217d26-4dda-4fb1-b5fe-52331155738c), messages
  view, full page (hasMore false). Position 0: createdBy user, creationSource
  mobile, completed, untruncated, messageId e0a50908-f62f-422e-bb41-e97fdba26494,
  updatedAt 2026-10-27T14:00:40.875Z. Position 100: createdBy user,
  creationSource web, completed, untruncated, messageId
  0d8f9871-cd64-4184-b44a-d61081f8fd49, updatedAt 2026-10-27T17:19:22.881Z.
  Exact quotes in CR-007. Other user messages do not narrow scope. GOV-002 governs.
- Binding: independently reproduced before and after the owner edits, SHA-256
  879f1a4c97fc22a5f050ecc2d42138f161c6723b371b3a445e4ce36fa5367b01 over 5,835
  UTF-8/LF bytes before CR-007's Riley approval heading (Status normalized to
  DRAFT). Later traceability hash, not represented as presented to Riley.
- Disposition: exact CR-007 r1 ACCEPTED without substantive proposal changes.
  Presets-first on all clients is within Riley's "placed at the top" and matching
  instruction; the implementer must disclose the web/desktop order change.
  CR-007's numbered owner conditions govern.
- Evidence: static inspection of index.html terrain pane order and sun inputs,
  lidar-studio.js render/renderPresets, native-shell.js looksItem/openSections/
  sunItem, ItemList.swift PageLayout and LidarViews.swift LooksRow/SunDial at
  HEAD 3dd560a. No runtime acceptance or completion review of concurrent edits.
- Scope: SPEC.md 0.1.0-draft and pending BASE-001 unchanged/unapproved. CR-007
  revises CR-006 item 1 for LiDAR only and supplements CR-001's unchanged-web
  condition for r1 items 1 and 4. Other CRs, contracts, open decisions, PERF and
  release gates, internal distribution and expiry remain.
- Record handling and limits: only CR-007, DECISIONS.md and SPEC_OWNER.md owner
  records changed here, uncommitted for the parent. No app edits, runtime/device/
  scientific checks, commit or deployment by this owner. Acceptance does not mark
  r1 IMPLEMENTED or VERIFIED. Branch protection and required spec reviews remain
  unverified.
- Continuity: this dedicated CR-007-r1-only session ended at this handoff. No
  ongoing owner remains; the parent implementer does not inherit owner custody.
