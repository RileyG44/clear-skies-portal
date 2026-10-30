> **RETIRED 2026-10-29 by Riley.** The change-request / Spec Owner process is no longer used. This file is a historical record only — do not follow it. See AGENTS.md.

# Specification governance

Status: effective under Riley's 2026-09-06 instruction establishing the Spec Owner.
Scope: native iOS project, its shared services, and changes to existing clients that
would alter native product contracts. Platform/system instructions remain higher
priority than repository files; conflicts must be disclosed, never worked around.

## Authority

Riley remains the product authority. His 2026-10-26 instruction (GOV-002 in
DECISIONS.md) authorizes all changes necessary to complete a direct build task,
including its change requests and dedicated Spec Owner review. Do not ask him
repeatedly for CR approval or owner restoration within that instructed task.
Unrelated tasks remain unauthorized. Investigation-only permission remains
investigation-only. A model, silence or a successful test cannot supply authority.

The owner remains the specification custodian and consistency reviewer;
implementers do not approve their own exceptions. Routine implementation choices
inside approved constraints need no request. Necessary specification changes
still receive a bounded, traceable owner record before implementation. This rule
supersedes older per-request reconfirmation wording in records and templates,
including interpretations of SPEC.md U-06; it does not approve BASE-001 or alter
unrelated requirements.

## Exact workflow

1. Detect a divergence, gap, conflict or unresolved decision. Stop only affected
   implementation pending its owner record; continue independent compliant work.
2. Create a numbered request from `change-requests/TEMPLATE.md`. Record the
   existing requirement, precise change, reason, alternatives, impact, tests,
   duration and rollback. Identify the direct build instruction and explain why
   the change is necessary for that task, or cite approval of the exact proposal.
3. Preserve Riley's exact instruction and available chat/issue/PR reference, plus
   the request ID, revision and immutable commit SHA or content digest. Distinguish
   a digest presented to Riley from one recorded later for traceability. Never
   invent evidence. No repeated approval question is needed when the task already
   authorizes the change. Ask only when required scope is outside that authority.
4. Route the request and evidence to the dedicated owner. The build instruction
   authorizes the necessary owner session and review; exact-proposal approval also
   covers submission and decision. Investigation alone does not authorize a build.
5. The owner checks authorization scope, consistency and dependent requirements,
   then records acceptance in DECISIONS.md and updates the spec or records the
   scoped supplement/exception, with conditions and expiry where applicable.
6. Only after that record exists may the implementer proceed. PRs cite requirement
   IDs, baseline revision/status, change IDs, acceptance evidence and limitations.
7. Material changes remain traceable through revised requests and owner records.
   Changes necessary within Riley's build instruction do not trigger another
   approval loop; work outside that instruction needs Riley's authorization.

Request states: DRAFT → RILEY_APPROVED_FOR_REVIEW → OWNER_REVIEW →
ACCEPTED or NEEDS_RILEY_DECISION or REJECTED → IMPLEMENTED → VERIFIED.
RILEY_APPROVED_FOR_REVIEW may be supported by the direct build instruction or
approval of the exact proposal; record which. Rejection does not authorize
implementation, and a request cannot expand its own task authorization.

## What counts as divergence

Architecture/provider substitution; feature addition/removal/deferral outside the
approved scope; changed scientific semantics; changed pricing/entitlement/privacy;
weakened acceptance tests or benchmarks; altered source-selection rules; exceptions
for temporary code, screenshots or demos; replacing a real integration with mock
behavior while claiming completion; and resolving an open decision through code.
A typo fix that changes no meaning is editorial; record it. When uncertain, prepare
a bounded request and check existing task authority before asking Riley again.

## Baselines and continuity

The initial product spec remains DRAFT until Riley approves its exact revision
and immutable commit SHA or content digest. A revision label alone is insufficient.
The owner then records approval and marks that revision approved. Unresolved items
remain unresolved; baseline approval is not implicit acceptance of future defaults.
Increment spec versions and log changed IDs. An accepted exception supplements the
baseline and must be included in implementation handoffs even if the spec text is
unchanged. Expired exceptions require removal or a new approved request.

One owner session at a time. Persist role, current version, approvals, open requests
and review evidence in git; do not rely on agent memory. If the owner disappears,
restore a successor under Riley's task authorization and the durable handoff,
without a repeated restoration question for that task. Owner unavailability does
not transfer approval power to the coordinating agent.

## Enforcement boundary

AGENTS.md and the PR template enforce a working process for cooperating agents;
they cannot technically prevent an arbitrary actor from bypassing it. Branch
protection and mandatory Riley review of spec/governance paths are not configured
by this documentation change. GitHub account permissions/rulesets are needed for
that enforcement; the owner must report this gap until configuration is verified.
Automated checks can verify IDs and records, but cannot authenticate free-form
approval text or prove semantic compliance. Never represent them as doing so.

Spec approval is distinct from purchase, production deploy, merge, or App Store
submission approval. Apply existing user authorization where it actually covers
that action; otherwise prepare a concrete reviewable result before asking.
