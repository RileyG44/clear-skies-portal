# Initial Spec Owner review

Date: 2026-09-06
Reviewer: dedicated Spec Owner, `/root/spec_owner`
Authorization: Riley's explicit request to establish the specification and owner
Reviewed proposal: SPEC.md 0.1.0-draft and accompanying governance, role, decision
register, change-request template, root AGENTS.md and PR template
Disposition: **reviewed, pending Riley approval**; no owner acceptance on Riley's
behalf

## Findings

The draft preserves the intended native capability-parity goal and does not
silently reclassify advanced analysis or point clouds as optional future products.
It separates Riley's direction from proposed frameworks, numerical targets and
commercial design. SwiftUI/MapLibre, a smaller paid release, device limits and a
replacement for the proposed paid seven-day introduction remain unapproved.

The governance implements both required gates: Riley authorizes a request before
it is routed to the owner; the owner records acceptance or modifies the spec before
implementation. The owner cannot waive a requirement independently. Investigation
permission, silence, test success and another agent's assurance do not approve a
change. Exceptions are scoped, recorded and time-limited; handoffs include them.

The documents correctly state that repository instructions are cooperative working
rules, not verified GitHub enforcement, and that this agent session is not a
permanent background service. No branch protection configuration was verified in
this review.

## Source inventory and parity checks

Inspection covered README.md, docs/ENGINEERING_REVIEW.md, sources.json, the actual
index.html controls and overlay definitions, ui-system.js routes,
research-analysis.js, glacial-research-core.js, point-cloud-core.js and
point-cloud-viewer.js. This was source inspection, not a new runtime or field test.

- Search includes date/cloud/type/viewability filters, source and acquisition
  context, location/coordinate actions, scene selection and surrounding mosaics.
- Terrain includes 2D rotation, 3D draping, source selection, lighting, exaggeration,
  hillshade/multidirectional/tint/slope/aspect/exposure/contours, elevation spectrum
  and independent threshold bands. Layer order, visibility and opacity matter.
- Research includes landform fabric, local relief, terrain position, ruggedness,
  multi-scale residuals, aspect components, curvature and glacial/flood screening.
  Existing code, numerical meaning and UI labels need separate verification.
- Point clouds include linked/unlinked cameras, point budgets/sizing, color modes,
  Eye-Dome Lighting, canopy and ASPRS class filters, and resource disposal.
- Conditions, geology/hazards, point identification, past landscapes, archaeology
  context and reference overlays are existing app categories, not expendable extras.
- Export preserves geographic extent and offers bounded PNG resolution choices.
  Current offline area caching lives on the terrain engine's disk; autonomous
  on-device iPhone packages and commercial entitlements are new work.

The 46 source-catalog entries are a discovery inventory, not 46 working
integrations. Historical prose contains stale or overly broad claims and cannot
establish commercial data rights, numerical correctness or actual mobile behavior.
The approved release matrix must enumerate sources, geography, parameters and any
deferrals before implementation can claim parity.

## Initial-review refinements incorporated

The coordinating agent incorporated the following feedback under the initial setup
authorization. I verified the resulting text; these are not changes to an approved
baseline:

1. DATA-07 explicitly requires geological outputs to remain observational morphology
   screening unless a separately validated model supports a stronger statement.
   Labels, explanations and exports must preserve that scientific distinction.
2. GOVERNANCE.md and the request template bind approval to an immutable commit or
   content digest as well as a human-readable revision. DECISIONS.md identifies the
   initial package commit as the approval target. Reusing a draft revision string
   cannot make an old approval apply to changed content.

The final recorded proposal content remains subject to Riley's approval.

## Outstanding gates

BASE-001 has no Riley approval evidence. D-01 through D-08 remain unresolved.
No native implementation, field validation, paid-release scope reduction,
commercial provider permission, subscription offer substitution, or deployment is
approved by this review. The next authorized step is to present the immutable
initial baseline package to Riley for approval; no implementation is authorized.
The dedicated owner remains the assigned custodian in this conversation. Future
owner requests require Riley's authorization under GOVERNANCE.md.
