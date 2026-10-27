# CR-006 — Consistent sidebar hierarchy and working menu controls

Status: ACCEPTED
Request content revision and immutable commit/content digest: r1; SHA-256 of the UTF-8/LF proposal before the Riley approval heading, recorded below for traceability.
Author / task: coordinating implementer, 2026-10-26; redesign every web/Electron sidebar menu using the existing iOS hierarchy and repair menu defects across clients.
Current approved spec revision: SPEC.md 0.1.0-draft remains unapproved; CR-001 through CR-005 supplement it.
Affected requirement IDs: U-01, U-04, UX-02/03, CAP-01 through CAP-14 (existing control parity), CR-001 shared-client constraint; engineering contracts 1–10.
Type: bounded shared UI change supplementing CR-001.

## Existing requirement and conflict

CR-001 condition 4 states: "with native-host mode off, web and Electron behavior is unchanged" and requires shared checks and the matching iOS bundle. Riley now explicitly requests a web/desktop menu redesign using the iOS layout, organization and hierarchy, and fixes for broken menu buttons on all clients. The unchanged-web wording needs this bounded supplement; source selection, scientific meaning, loading and rendering remain governed by existing contracts.

## Exact requested change

1. Reorganize all 13 existing sidebar routes into clear iOS-style grouped sections, with readable section headings, consistent inset cards, related settings together and actions after their related settings. Preserve all routes, controls, saved values, source/provenance information and existing control handlers. LiDAR follows the existing native order: layers, looks, appearance/effects, lighting, source/opacity, downloads. Elevation follows reference/range/opacity, palette, highlights. Other pages follow their existing iOS task groupings.
2. Repair full-width actions that interrupt the continuous grey section surface. Buttons remain inside their group with consistent inset padding and hit areas; disclosures and nested groups retain clear hierarchy. Apply equivalent containment to native grouped-list actions without replacing native SwiftUI/system materials.
3. Repair menu controls discovered during the audit, including constrained segmented pickers, missing/dead action forwarding or stale control state. Reuse existing shared handlers through the existing native bridge. Do not reimplement scientific/rendering logic in Swift or remove unsupported actions silently.
4. Keep changes scoped to sidebar/navigation/menu controls and their existing toolbar utility panels where needed to repair a broken menu action. Preserve the map info/key panel, its placement and bridge data, which another task owns. No new data source, renderer, pricing, permissions, entitlement, feature deferral, numerical budget or public deployment.
5. Ship the shared assets consistently for static web, Electron packaging and the iOS bundled website; retain every current route and verify both native-host on/off behavior.

This supplements only CR-001's unchanged-web constraint for this instructed UI task. Other CRs, baseline status, internal distribution limits and CR-001 expiry (BASE-001 approval/rejection or 2027-01-31, whichever first) remain unchanged.

## Alternatives and impact

Retaining the current web order fails Riley's direct request. Copying current native button defects also fails it. Prefer moving existing DOM controls instead of cloning them, preserving IDs/listeners and native refs. Do not hide overflow as a substitute for fitting controls. Existing preference values and source/analysis semantics remain unchanged. Local layout changes add no service cost or location retention. Rollback restores only this task's menu layout/styles/native row changes and rebuilds matching assets, preserving unrelated work.

## Verification plan

- Review all 13 routes on wide desktop and narrow/mobile web: section order, wrapping, consistent card edges, containment, scrolling, focus and keyboard behavior in light/dark appearances.
- Exercise representative actions, resets, disclosures, switches, sliders, pickers, and dynamic content through real shared handlers; verify returning to routes and rebuilding custom views retains working controls and current state.
- Native simulator: verify grouped action backgrounds, segmented/menu picker selection and hit areas, disabled state, section hierarchy and bridge actions. Build the iOS target and check matching bundled assets. Disclose unavailable physical-device checks.
- Run npm run check and npm test, plus meaningful menu regression checks for discovered defects. Preserve scientific/loading tests and the other task's info/key panel work.

## Riley approval — direct build authority under GOV-002

Exact instruction in parent T3 thread eff48b55-52d1-4cb0-936a-5767d7a59431:

> Please redesign all menus in the left side menu on the web and desktop app to resemble the layout, organization, and hierarchy of elements used on the iOS app. The desktop menus are all currently highly unorganized, frequently illogical or non-intuitive in the placement and order of their menu items, and include broken buttons on both iOS and desktop. With regards to the broken buttons, do not copy these, fix them on iOS and implement the redesign on desktop and web as well. Currently, many full width buttons break the grey background tile that sits behind the menu text and controls, and cuts off the tiles abruptly. This is bad UI. Let me know if you have any questions. Be aware that another agent is working in a separate thread on this machine redesigning the info/key panel that overlays the map, so while unrelated, it is something to be aware of.

Scope: direct build instruction authorizes necessary bounded changes and this dedicated owner review under GOV-002. No further Riley confirmation requested. The proposal digest is a later traceability binding, not a hash presented to Riley.

Independent verification by the CR-006-only owner: called t3_thread_read on the
[parent thread](t3-thread://v1/eff48b55-52d1-4cb0-936a-5767d7a59431), messages
view, limit 1. Position 0 is the complete, untruncated user_message quoted above:
createdBy user; creationSource web; status completed;
messageId 5ba12b91-48c3-4c2d-a51f-29d4ace87fda;
updatedAt 2026-10-26T17:43:56.595Z. This is actual user evidence, not the
coordinating implementer's summary. The owner also independently read GOV-002's
actual user_message at activity position 27 in thread
0e7c30e1-9c85-4b32-9b08-86e8efa70a9a, messageId
cb0288b1-a6d6-452c-a479-740d29f70376, updatedAt
2026-10-26T16:57:39.610Z, confirming the instruction recorded in DECISIONS.md.

Binding: independently reproduced before edits, SHA-256
`49b2a6baded3debee3f7cf70743ab47136f5d9d1012bd4fd1bf2645b8c2f420c`
over exactly 4,675 UTF-8/LF bytes before this Riley approval heading. Normalize
only the workflow Status line to `Status: DRAFT` to reproduce. The proposal is
otherwise unchanged. This later traceability hash is not represented as a digest
presented to or explicitly approved by Riley.

## Spec Owner disposition — accepted

Owner: dedicated Spec Owner review sub-agent (Codex), CR-006 r1 only;
reviewed 2026-10-26 (America/Los_Angeles). This bounded session ends at handoff.
Decision: ACCEPTED for the exact digest-bound r1, without substantive adjustment.
Riley's direct instruction covers the requested menu organization, cross-client
button repairs and necessary owner review under GOV-002. It expressly identifies
the other task's map info/key panel as outside this work. No further approval
question is needed for exact r1.

Static consistency evidence:
- Read AGENTS.md, SPEC.md, GOVERNANCE.md, DECISIONS.md, SPEC_OWNER.md,
  OWNER_REVIEW.md, ENGINEERING_REVIEW.md and accepted CR-001 through CR-005,
  including CR-004 placement addendum r1-a1. No prior accepted request is changed.
- ui-system.js retains the 13 routes named by CR-001. Its existing field-row
  transformation moves live DOM controls, preserving IDs and attached handlers;
  that is a suitable integration boundary for the requested reorganization.
- ItemList.swift PageLayout explicitly orders native LiDAR as layers, looks,
  appearance/effects, lighting, source/opacity and downloads, and Elevation as
  reference/range/opacity, palette and highlights. Other sections retain their
  task grouping. The proposal's two explicit orders match this source.
- ItemList.swift uses native inset-grouped sections; ItemRows.swift contains the
  native ButtonRow and PickerRow boundaries. native-shell.js describes live DOM
  controls and forwards click/input/change/select operations to those controls;
  ShellModel.swift sends those operations through the existing bridge. These
  support repairing layout/forwarding without duplicating scientific logic.
  Ref/state refresh after dynamic DOM rebuilding remains an acceptance check.
- These observations establish consistency and implementation boundaries only.
  Concurrent app edits are not reviewed for completion or runtime acceptance.

Acceptance conditions (apply r1 and the existing contracts):
1. Preserve every route and control, saved value, source/provenance disclosure
   and existing capability. Carry a route-by-route control checklist for all
   13 routes; representative interaction checks alone cannot establish complete
   parity. Keep CR-002's exact scientific wording, CR-003 sharing and CR-005's
   accepted overlay semantics intact.
2. Use existing shared handlers/state through the native bridge. Moving controls
   must preserve IDs, listener behavior, native refs and live values. Verify
   action forwarding, resets, disabled/selected state, route revisits and dynamic
   view rebuilding. No dead substitute, stub or silently hidden action is accepted.
3. Verify continuous grouped surfaces, inset full-width actions, usable pickers,
   hit areas, disclosures, wrapping, scrolling, focus/keyboard and native
   accessibility in the appearances and sizes in r1's plan. Preserve native
   SwiftUI/system materials. Clipping overflow is not a substitute for fitting.
4. Limit toolbar utility-panel changes to repairs necessary for a broken menu
   action. Leave the map info/key panel, placement and bridge data to its owning
   task; CR-004 r1+r1-a1 still specifies iOS upper left and desktop lower left.
   Preserve concurrent CR-004/005 work and all scientific/loading contracts.
5. Complete r1's full verification plan: web/Electron and native-host on/off,
   native simulator, iOS build, npm run check, npm test, meaningful discovered-
   defect regressions and matching static/Electron/service-worker/iOS assets.
   Record remaining failures and physical-device limitations honestly; acceptance
   here does not supply any of that evidence or weaken CR-001's checks.

Affected IDs: r1's U-01, U-04, UX-02/03, CAP-01 through CAP-14, CR-001 parity
and engineering contracts 1–10. Spec treatment: permanent bounded UI supplement
to SPEC.md 0.1.0-draft, whose text and pending BASE-001 remain unchanged and
unapproved. Only CR-001's unchanged-web condition is supplemented for this task's
menu layout and necessary control repairs. Remaining CR-001 conditions, shared
architecture, internal distribution and exception expiry remain: BASE-001
approval/rejection or 2027-01-31, whichever first. No open decision, numerical
budget, scientific/source policy, release gate, deployment or distribution is
approved or passed by this record.

Next authorized action: the coordinating implementer may implement exact r1 and
execute its full verification plan within these bounds. Necessary within-task
revisions follow GOV-002 and a traceable owner record, without repeated Riley
approval questions. This session accepts no other request and grants the
implementer no Spec Owner custody.

## Implementation and verification

Acceptance recorded only; implementation and verification remain with the parent.
This owner changed no app code, ran no runtime/device/scientific or shared-code
regression checks, and made no commit or deployment. Evidence is independent
thread/digest verification and static consistency inspection above. Do not mark
r1 IMPLEMENTED or VERIFIED from this record.

Handoff: only CR-006, DECISIONS.md and SPEC_OWNER.md owner records changed here,
left uncommitted for the parent. Preserve all unrelated work, including concurrent
CR-004/005 changes. The bounded CR-006-r1-only owner session ends at this handoff;
no ongoing owner remains. Branch protection and mandatory spec review enforcement
were not verified by this session.
