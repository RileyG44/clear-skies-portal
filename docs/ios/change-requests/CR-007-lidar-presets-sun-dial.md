# CR-007 — Presets-first LiDAR menu and shared sun dial

Status: ACCEPTED 2026-10-27 (America/Los_Angeles), exact r1 only
Request content revision and immutable commit/content digest: r1; SHA-256 of the UTF-8/LF proposal before the Riley approval heading, recorded below for traceability.
Author / task: implementation sub-agent (Claude Opus), 2026-10-27; update the native iOS LiDAR menu to the web organization with Presets first, keep the native azimuth/altitude dial and bring it to web and desktop in place of their separate sun controls.
Current approved spec revision: SPEC.md 0.1.0-draft remains unapproved; CR-001 through CR-006 supplement it.
Affected requirement IDs: U-01, U-04, UX-02/03, CAP-01 through CAP-14 (existing control parity), CR-001 shared-client constraint, CR-006 item 1 (LiDAR order); engineering contracts 1, 9.
Type: bounded shared UI change supplementing CR-001 and revising CR-006 item 1 for the LiDAR route only.

## Existing requirement and conflict

CR-006 r1 item 1 states: "LiDAR follows the existing native order: layers, looks, appearance/effects, lighting, source/opacity, downloads." Later shared commits (12dbc9e, c3c3135, 84d4bdc) reorganized the web LiDAR route into two peer cards — "Terrain mode & data" (mode, legend, Layer settings and Data sources & offline use disclosures, reset) and "Presets" (preset carousel, Save current, and a Customize preset disclosure holding layers and effects) — while native ItemList.swift still orders the obsolete Layers/Looks/appearance/lighting/source/downloads groups. CR-001 condition 4 states that with native-host mode off, web and Electron behavior is unchanged; Riley now asks for the native sun dial to replace the corresponding web/Electron controls.

Defects found in the current native adapter: saved-preset deletion is not reachable natively (native-shell.js looks for the delete button inside `.ls-look`, but it is now a sibling inside `.ls-preset-option`); native UI still says "Delete Look"/"Looks"; native forces every web `<details>` open and flattens them, so the web disclosures have no native expand/collapse.

## Exact requested change

1. LiDAR route, all clients: the Presets card is first, followed by the Terrain mode & data card. Web/Electron move the existing `#terStudio` element ahead of `#terLidar` (no control cloned or removed). Within Presets the carousel and Save current precede the Customize preset disclosure (layers, palettes/ramps, effects).
2. Native iOS mirrors that hierarchy: a Presets section (preset carousel with native horizontal scrolling, save/undo, Customize preset as a native disclosure), then Terrain mode & data (mode, hint, legend, Layer settings disclosure containing source/opacity, Appearance, Lighting & 3D relief; Data sources & offline use disclosure containing offline save, WA downloads and rendered source details; Reset all terrain settings). The three LiDAR disclosures use genuine native expand/collapse bound to the web `<details>` open state; other routes keep their current forced-open grouping. Redundant web carousel previous/next buttons are not drawn natively.
3. User-visible native naming uses "Presets"/"Delete Preset"; native preset deletion uses the web's own delete control for saved presets only (built-ins remain non-deletable). Internal persisted identifiers (e.g. `look`) are unchanged.
4. Web and Electron replace the two visible "Sun direction"/"Sun height" range rows with one combined dial matching the native SunDial semantics: north up, clockwise azimuth 0–359°, horizon at the rim and zenith at the center, altitude limited to the existing 5–90° range, live `input` while dragging and a committed `change` at the end, pointer cancellation restoring the previous values, and readouts with compass direction. The original `#terSunAz`/`#terSunAlt` inputs remain in the DOM as the state owner (visually hidden but keyboard/assistive-technology operable), so existing handlers, reset, saved preferences, share links/restoration, the lighting note and the native adapter keep working. Shadow fill, 3D relief and Reset lighting are unchanged. Lighting changes make no elevation request (contract 1).
5. Ship matching shared assets (version stamp, service worker, Electron, iOS bundle). No new runtime file, data source, renderer, scientific semantics, pricing, permission or deployment change.

This revises only CR-006 item 1's LiDAR order and supplements CR-001's unchanged-web condition for items 1 and 4. Other CRs, pending BASE-001, internal distribution limits and CR-001 expiry remain unchanged.

## Alternatives and impact

Keeping the web order (Terrain first) contradicts Riley's explicit "presets being placed at the top" and would leave iOS and web mismatched if only iOS moved. Keeping two web sliders contradicts his request for the dial on web/desktop. A native-only dial or a cloned web control would duplicate state; driving the original inputs keeps one owner. Rollback reverts this task's markup order, dial, adapter and native layout changes and rebuilds matching assets.

## Verification plan

- Browser (light/dark, desktop and narrow widths): Presets first; carousel, save/apply/undo/delete preset; Customize preset, Layer settings and Data sources disclosures open/close/persist; dial drag/keyboard/cancel, reset lighting, reset all, preset change and share-link restoration keep dial and outputs in sync; no elevation fetch on lighting change.
- Native simulator: Presets-first hierarchy, native disclosures expand/collapse and reopen, every LiDAR control still described (route-by-route bridge probe), saved preset deletion after rebuild/revisit, sun dial adjusts web inputs, other routes unchanged.
- npm run check, npm test with new regression checks for preset delete extraction, LiDAR disclosure description and dial geometry/events; current iOS build; matching asset versions.

## Riley approval — direct build authority under GOV-002

Direct build instruction, parent T3 thread 99217d26-4dda-4fb1-b5fe-52331155738c,
position 0, user_message e0a50908-f62f-422e-bb41-e97fdba26494 (2026-10-27T14:00:40.875Z):

> I'd like to go ahead and update the iOS app LIDAR menu to reflect the changes that we made on the web app in terms of organization and the hierarchy and everything like that.  I really like the astimuth and altitude tool that we use here on iOS, so I'd like to keep that.  In fact, I'd really actually like to add that to the web app, as well, and to the desktop app, in place of the corresponding controls that are on those as well.  But in terms of, like, the overall arrangement, with, like, the looks being renamed of presets and presets being placed at the top, and going with that multi-window design.  That's kind of what I want to, I want to update the LIDAR menu to, uh, match that between, you know, update the lighter menu on iOS to match that.  Yeah, let me know if you have any questions.  Thanks.

Shipping instruction, same thread, position 100, user_message
0d8f9871-cd64-4184-b44a-d61081f8fd49 (2026-10-27T17:19:22.881Z):

> Okay, go ahead and pick up where Opus left off, complete the intended work, address the problem items you found, and push all code to main, push a testflight update, and update all local clear skies apps/tooling.

Scope: direct build instruction authorizes necessary bounded changes and this
dedicated owner review under GOV-002. No further Riley confirmation requested.
Binding: SHA-256 `879f1a4c97fc22a5f050ecc2d42138f161c6723b371b3a445e4ce36fa5367b01`
over exactly 5,835 UTF-8/LF bytes before this Riley approval heading (Status line
as `Status: DRAFT`). This is a later traceability hash, not a digest presented to
or explicitly approved by Riley.

## Spec Owner disposition — accepted

Owner: dedicated Spec Owner review sub-agent (Claude), CR-007 r1 only;
reviewed 2026-10-27 (America/Los_Angeles). This bounded session ends at handoff.
Decision: ACCEPTED for the exact digest-bound r1, without substantive adjustment.
Riley's direct instruction covers the LiDAR menu reorganization, the Presets
rename and top placement, keeping the native sun dial and bringing it to web and
desktop in place of their separate controls, and the necessary owner review under
GOV-002. No further approval question is needed for exact r1.

Authority evidence (independently read, not taken from the implementer):
- Parent thread 99217d26-4dda-4fb1-b5fe-52331155738c ("Align LiDAR Menus Across
  Apps"; thread createdBy user, creationSource mobile), messages view.
- Position 0: createdBy user, creationSource mobile, user_message, completed,
  untruncated; messageId e0a50908-f62f-422e-bb41-e97fdba26494, updatedAt
  2026-10-27T14:00:40.875Z. Text matches the quote above exactly.
- Position 100: createdBy user, creationSource web, user_message, completed,
  untruncated; messageId 0d8f9871-cd64-4184-b44a-d61081f8fd49, updatedAt
  2026-10-27T17:19:22.881Z. Text matches the quote above exactly.
- All other user messages (positions 46, 74, 118, 121, 129; full messages page,
  hasMore false) concern tooling, review and handoff to Opus; none narrows scope.
  Position 129 (messageId 11bc3bcc-aa22-473e-9449-dd0ba25ab9cc) reaffirms the
  first prompt. GOV-002 in DECISIONS.md is the governing authorization rule.
- Binding: independently reproduced before edits, SHA-256
  879f1a4c97fc22a5f050ecc2d42138f161c6723b371b3a445e4ce36fa5367b01 over 5,835
  UTF-8/LF bytes (no CR bytes) before the Riley approval heading, with only the
  workflow Status line normalized to `Status: DRAFT`. This is a later
  traceability binding, not a digest presented to Riley.

Static consistency evidence (HEAD 3dd560a; working tree had no app edits when read):
- index.html places `#terLidar` ("Terrain mode & data", line 1308) before
  `#terStudio` (presets/customization, line 1442). No CSS order or ui-system.js
  move changes that; ui-system.js states LiDAR owns its two-card workflow. The
  same order holds at 12dbc9e, c3c3135 and 84d4bdc. Web therefore shows Presets
  second, so the conflict with Riley's "presets being placed at the top" is real.
- Ordering interpretation: Riley asks for presets "placed at the top" and for
  iOS to match the web arrangement. Moving only iOS would break matching;
  keeping the web order would contradict his explicit placement. Moving the
  existing `#terStudio` element ahead of `#terLidar` on all clients satisfies both
  with no control added, cloned or removed, and is within his instruction. The
  implementer must disclose this web/desktop order change in its report to Riley.
- lidar-studio.js render/renderPresets builds the Presets card (Save current,
  carousel, Undo preset, Customize preset disclosure holding layers and effects).
  Saved presets add `.ls-look-remove[data-remove-look]` as a sibling of `.ls-look`
  inside `.ls-preset-option`.
- native-shell.js looksItem searches `[data-remove-look]` inside each `.ls-look`,
  so saved-preset deletion is unreachable natively (defect confirmed).
  openSections forces every closed `<details>` in the workspace open, so web
  disclosures have no native collapse (confirmed). sunItem is triggered from
  `#terSunAz`; the dial drives `#terSunAz`/`#terSunAlt` via input then commit.
- ItemList.swift PageLayout "terrain" still orders #terLidar, Looks,
  #terAppearance/Terrain effects, #terLighting, source/opacity, Downloads.
- LidarViews.swift LooksRow labels deletion "Delete Look"; SunDial maps north up,
  clockwise azimuth 0–359, rim horizon/center zenith, altitude clamped to the
  web input's min/max (5–90), throttled `input` during drag and `commit` on end,
  with Slider accessibility fallbacks. r1 item 4 matches these semantics.
- index.html sun inputs feed repaintTerrainLighting on input and saveTerrainPrefs
  on change; reset, preset restore and share restoration write those inputs.
  Keeping them as the state owner preserves those paths and contract 1.

Acceptance conditions (apply r1 and the existing contracts):
1. Preserve every LiDAR control, saved value, preset, provenance disclosure and
   handler; carry a LiDAR control checklist across web, Electron, native-host on
   and native. Only order/grouping and the sun control presentation change.
2. `#terSunAz`/`#terSunAlt` stay the single state owner. Visually hide them in a
   way that keeps them focusable/operable and still described by the native
   adapter (not `hidden`/`display:none`), or have the native adapter target them
   explicitly. The web dial must be keyboard and assistive-technology usable;
   pointer cancel restores prior values; outputs, lighting note, reset, saved
   prefs, presets and share links stay in sync. Lighting changes never fetch
   elevation (contract 1); verify with network observation, not inspection only.
3. Update user-visible text made inaccurate by the reorder (for example the
   lidar-studio GPU-unavailable note "Choose a terrain mode above"). Internal
   persisted identifiers stay unchanged; saved presets and preferences migrate
   without loss.
4. Native deletion uses the web's own delete control for saved presets only;
   built-ins remain non-deletable. Native LiDAR disclosures reflect and set the
   web `<details>` open state and survive revisits/rebuilds; other routes keep
   their current grouping.
5. Ship matching static, service-worker, Electron and iOS assets (contract 9)
   and complete r1's verification plan, including npm run check, npm test with
   the named regressions, a current iOS build and simulator checks. Record
   failures and physical-device limits honestly; this record supplies none.

Affected IDs: U-01, U-04, UX-02/03, CAP-01 through CAP-14 (control parity, chiefly
CAP-05/06), CR-001 shared-client constraint, CR-006 item 1 (LiDAR order only) and
engineering contracts 1 and 9; contracts 2–8 and 10 unchanged. Spec treatment:
permanent bounded UI supplement to SPEC.md 0.1.0-draft, whose text and pending
BASE-001 remain unchanged and unapproved. CR-006 item 1's LiDAR order is revised
for the LiDAR route only; CR-001's unchanged-web condition is supplemented only
for r1 items 1 and 4. All other CR-001 conditions, CR-002 through CR-006 scope,
internal distribution and expiry (BASE-001 approval/rejection or 2027-01-31,
whichever first), open decisions and release gates remain. No scientific/source
policy, numerical budget, pricing, privacy, deployment or distribution is
approved or passed by this record.

Next authorized action: the coordinating implementer may implement exact r1 and
execute its full verification plan within these bounds, then ship as Riley's
position-100 instruction directs. Necessary within-task revisions follow GOV-002
and a traceable owner record, without repeated Riley approval questions. This
session accepts no other request and grants the implementer no Spec Owner custody.

## Implementation and verification

Acceptance recorded only; implementation and verification remain with the parent.
This owner changed no app code, ran no runtime/device/scientific or shared-code
regression checks, and made no commit or deployment. Evidence is independent
thread/digest verification and static consistency inspection above. Do not mark
r1 IMPLEMENTED or VERIFIED from this record.

Handoff: only CR-007, DECISIONS.md and SPEC_OWNER.md owner records changed here,
left uncommitted for the parent. Preserve all unrelated and concurrent work. The
bounded CR-007-r1-only owner session ends at this handoff; no ongoing owner
remains. Branch protection and mandatory spec review enforcement were not
verified by this session.
