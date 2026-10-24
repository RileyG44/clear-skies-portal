# CR-002 — truthful surface curvature label

Status: ACCEPTED
Request content revision: r1
Author / task: coordinating implementer; Opus audit F11 repair
Current approved supplement: CR-001 r1; SPEC.md 0.1.0-draft remains unapproved.
Affected IDs: CAP-08, DATA-06, D-06 (this label only), CR-001 parity conditions.
Type: clarification

## Existing requirement and conflict

SPEC.md DATA-06: "Existing curvature UI claims profile/plan while code returns
surface Laplacian; resolve the intended outputs in D-06. Never copy the misleading
label as parity."

Analyze currently offers "Profile / plan curvature" but displays result.laplacian.
The current calculation is not profile or plan curvature. This request corrects
only the visible name/description; the broader D-06 decisions remain open.

## Exact requested change

In the shared web Analyze menu replace "Profile / plan curvature" with
"Surface curvature (Laplacian)". Replace that product's description with:
"Show local surface bending as the elevation Laplacian. Profile and plan
curvature are not displayed."

The native Analyze control mirrors those exact shared strings. Keep the product
identifier, calculations, values, sign, units, colors and export behavior unchanged.
Do not add profile/plan products or resolve any other D-06 question. This permanent
wording correction is effective after Riley approves r1 and the Spec Owner records
acceptance. That same approval authorizes re-establishing one Spec Owner session to
record and review this exact request.

## Alternatives and impact

The existing label remains misleading if no change is approved. Exposing separate
profile/plan products requires its own scoped design and validation and is not
requested here. No source, numerical, performance, cost, pricing, permission or
location-retention change. Rollback is restoring the two UI strings.

## Verification plan

Confirm the shared menu/description and native mirrored control match the approved
strings. Run research-analysis and scientific regression checks and confirm the
curvature product still reads result.laplacian with the existing /ft conversion.

## Riley approval — required before routing to Spec Owner

Request binding SHA-256 (text above this heading, UTF-8/LF):
`808d43d5bf10a8d1c7e5846f5d42b4864f6261623c121bf23cc8db2877dd919f`

Exact approval text: Riley answered "Approve CR-002 r1" to this structured question:

> Approve [CR-002 r1](/Users/riley/Documents/ChatGPT/Clear%20Skies%20Portal/docs/ios/change-requests/CR-002-curvature-label.md) to rename “Profile / plan curvature” to “Surface curvature (Laplacian),” clarify the description, keep all calculations unchanged, and authorize a Spec Owner to record this exact correction?

Available reference: [parent T3 Code thread](t3-thread://v1/12850bd3-bebe-4837-b8d1-0ed4492f4146),
activity position 1548 (user_input_request) and position 1561 (user_message,
createdBy: user). The answer record's updatedAt is 2026-10-24T17:39:29.933Z.
The owner independently read both records with t3_thread_read, view: activity;
position 1561 was the newest user response through position 1566. This evidence
comes from the actual user response, not the coordinating agent's transcription.
Approved request revision: r1, bound to the SHA-256 above. The owner independently
recomputed it over the 2,130 UTF-8/LF bytes before this heading as presented to
Riley, including the original "Status: DRAFT" line. Later status changes record
workflow state only; reproduce the binding by normalizing that line to DRAFT:
`awk '/^## Riley approval/{exit} {print}' CR-002-curvature-label.md | sed '1,/^Status:/s/^Status:.*/Status: DRAFT/' | shasum -a 256`
Scope: the exact r1 wording correction and re-establishment of one dedicated
Spec Owner session to review and record it. This one approval covers submission
and the decision; no second approval is required within that exact scope.

## Spec Owner disposition — only after Riley authorization

Owner identity and review date: dedicated Spec Owner review sub-agent (Codex),
re-established 2026-10-24 under Riley's CR-002 r1 authorization. This session ends
at the handoff below; it is not a permanent background service.
Decision / rationale: ACCEPTED 2026-10-24, for the exact digest-bound r1 only.
- Approval and owner restoration are explicit in the independently inspected
  question and Riley's actual answer. The proposal digest matches exactly.
- Source consistency: research-analysis.js selects result.laplacian for product
  "curvature". glacial-research-core.js finiteDifferenceCurvature computes that
  output as the east-west plus north-south elevation second derivatives (r + t).
  Separate profileSecondDerivative and planSecondDerivative arrays exist but are
  not selected for this displayed product. The approved description is accurate
  for the displayed output and removes the misleading profile/plan claim.
- Unit preservation: research-analysis.js supplies metre horizontal/vertical
  units, and the existing index.html researchLegacyColours legend uses
  `(v * .3048).toPrecision(3)` with the `/ft` suffix for curvature. This conversion
  and all calculations, values, sign, colors, identifiers and export behavior
  remain unchanged under this request.
Accepted scope: replace the shared Analyze name with "Surface curvature
(Laplacian)" and its description with "Show local surface bending as the elevation
Laplacian. Profile and plan curvature are not displayed." Native mirrors those
exact shared strings. CAP-08, DATA-06, D-06 (this label only) and CR-001's parity
conditions are the affected cross-references. No other D-06 decision is resolved.
Spec treatment and duration: permanent wording clarification supplement to
SPEC.md 0.1.0-draft; its text and pending BASE-001 package remain unchanged and
unapproved. CR-001 r1 and its conditions and exception expiry remain unchanged.
Next authorized action: the coordinating implementer may now apply these two
shared UI strings, preserve their exact native mirror, and perform the request's
verification plan within CR-001's existing scope. Any substantive departure from
the approved r1 requires a new Riley-approved request.

## Implementation and verification

Owner recording complete; implementation and verification remain with the
coordinating implementer. No app code was changed in this owner session. Approval
and acceptance do not mark F11 implemented or verified.
Owner evidence: independent digest reproduction, direct parent-thread approval
inspection and static source review described above. Numerical/runtime regression
checks and shared/native string verification were not run in this owner session.
Before marking verified, confirm both exact strings in shared and native Analyze,
run the research-analysis and scientific regression checks, and confirm the
result.laplacian selection and existing /ft conversion remain unchanged. CR-001's
required shared-code checks and matching iOS bundle still apply.
Handoff: leave this request, DECISIONS.md and SPEC_OWNER.md edits uncommitted for
the parent. No broader baseline, implementation, release or D-06 approval is
inferred from this record.
