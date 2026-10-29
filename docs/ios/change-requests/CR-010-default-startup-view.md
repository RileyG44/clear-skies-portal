# CR-010 — western US fresh startup view

Status: ACCEPTED
Request revision: r1. Binding is SHA-256 of bytes before Riley approval heading.
Author/task: coordinating implementer, 2026-10-28, Part B of markup pane/default view.
Current approved spec revision: SPEC.md 0.1.0-draft unapproved; CR-001 and accepted CR-002–009 supplements apply.
Affected IDs: U-03, UX-01, CAP-01/03/05/06/09, CR-001 parity, CR-003 no-payload behavior.
Type: permanent bounded default-state supplement.

## Existing requirement and conflict

Existing fresh camera opens at 45,-100 zoom 3, while existing preference and share
restores own later state. Riley directly requests a new fresh default only. This
amends the no-payload default under CR-003 without changing restore precedence.

## Exact requested change

For a fresh session lacking saved map/layer state, shared payload or native recovery,
open the western US region shown in Riley's two supplied images, with the existing
Topographic LiDAR preset at 100% and Rivers and lakes at 60%. No extra overlays,
selected location, marker, label or search text. Keep the existing background map.
Reference image pixel dimensions are 1290x2796 (3x phone) and 430x932 (export).
Derive reference camera with Web Mercator: known marker 40.63089,-113.07849,
phone ring centroid near 640.5,1462.5 physical pixels; Canada/US 49-degree border
provides independent scale. Initial derivation: center 41.637234,-112.985268,
zoom 4.5 for 430x932 CSS points. Refine these camera numbers only from measured
projection/landmark comparison, recording final values/evidence. Fit the same
reference geographic extent across screen sizes so a Pro Max portrait matches
and desktop/landscape shows a sensible region. Do not add selection to derive view.
Use real existing preset, layer opacity and camera APIs. Apply fresh defaults
before optional startup rendering, respecting share payloads, stored preferences,
native recovery, PR #38 first-load map selection and pixel-loader readiness.
Do not clear saved preferences or rewrite a shared/restored camera/layer stack.
No scientific calculations, source-selection, loading policy or release changes.
Shared web/Electron/native assets stay synchronized. No main push or TestFlight.

## Alternatives and impact

Guessing from the region description or using the incidental marker as map center
fails Riley's direction. Bounds derived from the reference preserve region fit
across aspect ratios. No provider/cost/privacy change; rollback restores the old
fresh defaults. Existing saved states remain untouched.

## Verification plan

Meaningful tests: fresh default camera/preset/opacities, empty search/no selection;
saved preferences, native recovery, valid/invalid share payload precedence; responsive
extent fitting and PR #38/loader regressions. npm run check, npm test, Python tests,
iOS build, Pro Max simulator reference/landmark screenshots and desktop/other aspect
ratio inspection. Report measured camera and precision/visual limits honestly.

## Riley approval

Authority: actual current-conversation user build instructions, 2026-10-28, GOV-002.
Exact relevant text:
> Required default for a fresh launch: this map viewpoint (center and zoom), the topographic LiDAR preset at 100%, and the "Rivers and lakes" layer at 60% opacity. Nothing else extra on by default.
> derive center and zoom by matching these screenshots to the app's own projection and the known marker coordinates (use the app's normal portrait iPhone viewport and aspect ratio), then confirm by loading the new default in the iOS simulator at an iPhone Pro Max size and comparing it with the reference screenshot
> the search bar must be empty on a fresh launch. Don't prefill it with coordinates, and don't show the location marker or label from the screenshot.
References: current inherited user messages; images at ~/t3-tots/out/assets/default-view-iphone.png and default-view-export.png. No message URL supplied.
Binding: SHA-256 1a279c0141d443929eb720380aa6ec3a602baa80842fe7112ad16e4b44866330; later traceability digest, not presented to Riley.
Scope: direct implementation and necessary dedicated owner review.

## Spec Owner disposition

Owner: dedicated Spec Owner sub-agent `/root/spec_owner_b` (Codex), CR-010 r1
only, 2026-10-28 (America/Los_Angeles); session ends at handoff.
Decision: ACCEPTED for original exact r1, under these conditions applying its
bounded scope. Independently reproduced before edits: 3,013 UTF-8/LF bytes before
Riley approval heading, SHA-256
`1a279c0141d443929eb720380aa6ec3a602baa80842fe7112ad16e4b44866330`.
Normalize only Status to DRAFT to reproduce; proposal text otherwise unchanged.
The digest is later traceability evidence, not a hash presented to Riley.

Authority: independently read inherited actual user messages for original Part B,
subsequent screenshot/known-marker derivation instructions, and latest correction
requiring empty search/no marker, label or selected location. The user authorizes
necessary owner review explicitly in the continuation; GOV-002 applies without
another Riley approval/restoration question. Actual inherited user text, not only
the parent summary, supplies evidence; no message URL/metadata was supplied and
no external thread inspection is claimed.

Static evidence: read governing specification, governance, decision/handoff and
accepted request scopes. Inspected app/map.js's initial Leaflet camera and
continuous zoom; app/bridge.js's validated share restoration, native session
restore and deferred initial GPU/render path; app/elevation.js preference
hydration; app/spectrum.js restoration/refresh; app/overlays.js saved visibility,
per-layer opacity and application; lidar-render.js's built-in `topo` scene and
100% preset opacity; lidar-studio.js applyLook; native-shell.js recovery startup.
Independently confirmed reference dimensions 1290x2796 and 430x932. These establish
integration boundaries, not a completed georeferencing or runtime verification.

Conditions:
1. Decide fresh-default eligibility before startup hydration/actions can save
   preferences. Existing saved map/layer preferences, native recovery and a `csp`
   share payload (including an invalid payload) must suppress the new defaults;
   retain existing error reporting and restore precedence. Do not clear or replace
   persisted user state to make a session appear fresh.
2. Use existing `topo` preset and layer opacity/state handlers. A genuinely fresh
   session has only requested terrain at 100% and Rivers and lakes at 60% over the
   existing background, with empty search and no selected location/marker/label.
   An engine address, appearance preference or UI layout alone is not a selected
   map viewpoint; distinguish map/layer state from unrelated preferences.
3. The proposed camera values are an initial screenshot-derived candidate, not
   verified exact coordinates. Refine only from projection/landmark evidence as
   r1 allows. Record final center, zoom, reference viewport and fitting method,
   comparison/error evidence for coastline/Baja/Great Salt Lake/Rockies, and
   screenshot quantization limits. If projection cannot be pinned down
   confidently, report that and stop only camera implementation; do not claim an
   inferred value is Riley-supplied. Pro Max, desktop and other aspect checks
   remain required; resizing must not overwrite subsequent user/shared cameras.
4. Preserve PR #38 initial map selection, readiness/error/recovery/pixel-loader
   behavior and ENGINEERING_REVIEW contracts. A default preset must not create a
   competing startup render/restore race or alter scientific/source rules. Run
   r1's named tests/build plus meaningful fresh/saved/share/recovery regressions,
   with matching shared packaging; disclose environmental failures honestly.

Spec treatment: permanent bounded fresh-default supplement to SPEC.md
0.1.0-draft and CR-001/CR-003 no-payload behavior only for Riley's requested
startup state. SPEC.md and BASE-001 stay unchanged/unapproved. CR-009 and other
accepted scopes, loading/scientific/source contracts, open decisions, PERF and
release gates remain. CR-001 expiry stays BASE-001 approval/rejection or
2027-01-31, whichever first. No main push, production deployment or TestFlight.
Next authorized action: parent implements and verifies exact r1 under these
conditions. Necessary within-task revisions follow GOV-002; implementer does
not inherit owner custody.

## Implementation and verification

Owner acceptance only. No app edits, runtime/device/scientific checks, commit,
push or deployment by this owner. Only CR-010, DECISIONS.md and SPEC_OWNER.md
changed, left uncommitted for parent. Actual screenshot fit and runtime acceptance
remain with implementer. Branch protection/spec-review enforcement unverified.
This dedicated CR-010-r1-only session ends at handoff.

Implementer evidence: final reference camera 41.637234,-112.985268 at zoom 4.5
for 430x932 points; responsive fitting, real topo 100% / water 60% and empty query/no
selection implemented. See ../../verification/markup-default-view/README.md
for projection evidence, screenshots, checks and limitations. This evidence
does not amend the owner's disposition or approve the draft baseline.
