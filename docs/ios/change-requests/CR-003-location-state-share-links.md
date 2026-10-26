# CR-003 — Location and map-state share links

Status: ACCEPTED
Request content revision and immutable commit/content digest: r1; SHA-256 of all bytes before the Riley approval heading
Author / task: coordinating agent (Codex), Riley's 2026-10-25 collapsed location action request
Current approved spec revision: SPEC.md 0.1.0-draft remains unapproved; CR-001 r1 supplements it
Affected requirement IDs: U-01, U-04, UX-02, CAP-01 through CAP-12, CR-001 Stage 2
Type: bounded feature addition to native sharing and the existing web client

## Existing requirement and conflict

CR-001 authorizes native "share/export and location" integration and says that
"With the mode off, web and Electron behavior is unchanged." The existing web
client can receive an engine-address link but has no location/layer-state share
format. Restoring the state Riley requested therefore adds an opt-in web behavior.

## Exact requested change

Add a Share action to the collapsed map's selected-location action stack. It
opens Apple's native share sheet with a link to the existing Clear Skies web app
at https://rileyg44.github.io/clear-skies-portal/. The link opens centered on the
selected search location and restores the sender's active map layers and their
parameters, including visibility, opacity and ordering; satellite scene identity,
Auto-fill choice and search filters; terrain, elevation and analysis settings;
overlay settings; annotations and any active 3D/point-cloud view settings.

Use a versioned, validated URL-fragment payload generated and restored by the
existing shared JavaScript engine. Reuse the existing renderers, source-selection
functions and scientific calculations. Include display state only: never include
the engine address, credentials, device identifiers or unrelated preferences.
No new service, account, source, purchase or public deployment is authorized.
An invalid/unsupported link or unavailable layer must be reported instead of
silently presented as a complete restoration. Pages without a share payload
retain their existing behavior. Native distribution stays within CR-001's
internal TestFlight scope and expiry. Record one dedicated Spec Owner's review
of this exact request; that authorization does not create an ongoing owner.

## Alternatives and impact

A coordinate-only link would not satisfy Riley's requested active-layer parity.
A server-backed link would introduce an unnecessary hosting dependency and is
outside this request. Fragment links keep state on the user's chosen sharing
channel; the location and included annotations are intentionally visible to a
recipient. Large states may produce long links; never silently drop layers or
parameters to shorten them. Recipients still need access to the existing data
sources and any locally configured optional engine. Rollback removes the Share
action and opt-in fragment reader without altering ordinary map use.

## Verification plan

Roundtrip a selected location and representative multi-layer states, parameters,
order, scene identity, Auto-fill on/off, 2D/3D and point-cloud state through fresh
web sessions. Exercise invalid versions, malformed payloads and unavailable
sources. Check no engine/credential fields are emitted. Verify native Apple
share-sheet presentation, preserve existing no-payload startup, run shared checks
and tests, and bundle identical shared assets in the internal iOS build.

## Riley approval — required before routing to Spec Owner

Request binding SHA-256 (all bytes before this heading as presented, UTF-8/LF):
`709c7650e3f6b23ec7025f8d54239f4c216cea63854052af6300ccbdb74c9ecd`

Exact question and response, independently read from the actual user message:

> Approve [CR-003 r1](/Users/riley/Documents/ChatGPT/Clear%20Skies%20Portal/docs/ios/change-requests/CR-003-location-state-share-links.md) for full location/layer-state share links and one dedicated Spec Owner review? Your AGENTS.md and GOVERNANCE.md require this record because the web app currently has no state-link reader. The link will include map display settings, exclude engine addresses and credentials, and use the existing renderers. Other UI fixes are continuing. Proposal SHA-256: 709c7650e3f6b23ec7025f8d54239f4c216cea63854052af6300ccbdb74c9ecd.
>
> Approve CR-003 r1 and its Spec Owner review

Available reference: [parent T3 Code thread](t3-thread://v1/8fd7298a-b4d3-4648-b7e1-e9cb407df1ea),
activity position 781, type: user_message, createdBy: user, creationSource: server,
status: completed, visibility: local. The record's updatedAt is
2026-10-26T05:33:40.320Z (2026-10-25 in America/Los_Angeles). The owner directly
called t3_thread_read with that threadId, view: activity, afterPosition: 780,
limit: 3; position 781 contains the full question and answer, untruncated. This
is direct approval evidence, not the coordinating agent's assertion.

Approved request revision: r1. Before making any edits, the owner independently
reproduced the binding above over exactly 3,400 bytes before this heading,
including the original "Status: DRAFT" line. Only that line changes above the
heading, to record workflow status. To reproduce the original binding, normalize
only that status line to DRAFT:
`awk '/^## Riley approval/{exit} {print}' CR-003-location-state-share-links.md | sed '1,/^Status:/s/^Status:.*/Status: DRAFT/' | shasum -a 256`
Scope: the exact digest-bound r1 feature addition and restoration of one dedicated
Spec Owner session to review and record it. This single approval covers submission
and the decision; no second approval is required within that exact scope.

## Spec Owner disposition — only after Riley authorization

Owner identity and review date: dedicated Spec Owner review sub-agent (Codex),
restored under Riley's exact CR-003 r1 approval; reviewed 2026-10-25
(America/Los_Angeles). This one-request owner session ends at this handoff.
Decision / rationale: ACCEPTED for the exact digest-bound r1, without substantive
adjustment to its proposal.

- Approval scope, owner restoration and proposal digest were independently
  verified as recorded above.
- CR-001's existing web/Electron behavior constraint is expressly supplemented
  only by r1's opt-in display-state fragment behavior. Pages without a share
  payload retain their existing behavior. CR-001's shared-engine architecture,
  parity, scientific/loading invariants, shared checks, matching iOS bundle,
  internal distribution scope and expiry continue to apply.
- Actual source inspection confirms the intended integration boundary.
  index.html owns committedLocation/searchState, scene selection and Auto-fill,
  terrain/elevation/research settings, overlay settings and layer mutation/order.
  ui-system.js retains the active-layer order. The existing sessionState and
  restoreSession bridge currently carries camera/location state only; it is not
  evidence that full display-state sharing already exists. takeSharedServerBase
  reads the separate engine fragment; the new payload must exclude that address
  as r1 requires.
- ios/Resources/native-shell.js mirrors shared controls and invokes the shared
  bridge. WebHost.swift already presents UIActivityViewController for completed
  file exports; NativeBridge.swift currently has no state-link share message.
  These are existing integration points, not a completed link-sharing path.
- markup.js retains annotation documents and visibility/opacity/rank, renders
  them in 2D/3D, and also has engine synchronization. lidar-studio.js exposes its
  live state and uses lidar-render.js's normalized layer/effect model.
  point-cloud-viewer.js owns active project, camera, linked mode, class, color,
  sizing, budget and lighting controls. These modules do not currently expose a
  complete share roundtrip. Their current persistence or camera-only recovery
  cannot substitute for the full approved display-state scope.

Accepted scope: exactly the proposal above, including selected-location centering,
full included display-state restoration, native Apple share UI, versioned and
validated fragments, reuse of existing rendering/source-selection/calculation
functions, excluded private configuration, and explicit reporting of invalid,
unsupported or unavailable state. The proposal's no-silent-drop rule remains in
force. This record adds no omission, parameter cap, device budget or source policy.
Affected references: U-01, U-04, UX-02, CAP-01 through CAP-12 and CR-001 Stage 2,
as listed in r1. CR-002's exact curvature wording and unchanged math remain intact.
Spec treatment and duration: supplement to SPEC.md 0.1.0-draft; SPEC.md and the
pending BASE-001 package are unchanged and unapproved. Native distribution remains
within CR-001's internal TestFlight scope and exception expiry: BASE-001 approval
or rejection, or 2027-01-31, whichever comes first. This does not approve a public
deployment, service, account, source, purchase or release. The proposal governs;
this disposition does not broaden or restrict it.
Next authorized action: the parent implementer may implement exact r1 and perform
its verification plan now that this acceptance is recorded. A substantive departure
needs Riley's approval and an owner record under GOVERNANCE.md.

## Implementation and verification

Owner recording complete; implementation and verification are handed back to the
parent. This session changed no app code, ran no runtime, device, scientific or
shared-code regression tests, and made no commit or deployment. Acceptance grants
implementation permission; it does not mark the feature implemented or verified.

Remaining verification is r1's plan above: fresh-session full-state roundtrips,
invalid/unsupported/malformed payloads, unavailable sources, private-field
exclusion, native share-sheet presentation, unchanged no-payload startup, shared
checks/tests and the matching internal iOS bundle. Existing module state support
is static consistency evidence only. The target public site's ability to restore
the new payload is not established; public deployment is outside this approval.

Handoff: leave this request, DECISIONS.md and SPEC_OWNER.md edits uncommitted for
the parent. Preserve all prior dirty work. This CR-003-only owner session ends
here; it neither restores an ongoing owner nor accepts another request.
