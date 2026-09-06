# Specification governance

Status: effective under Riley's 2026-09-06 instruction establishing the Spec Owner.
Scope: native iOS project, its shared services, and changes to existing clients that
would alter native product contracts. Platform/system instructions remain higher
priority than repository files; conflicts must be disclosed, never worked around.

## Authority

Riley approves every request addressed to the Spec Owner and every substantive
specification change/exception. The owner is a custodian and reviewer, not an
independent product approver. Implementers may make routine choices inside an
approved task and spec; no exception exists for speed, emergencies, prototyping,
failed tests, missing access, provider behavior, or deadlines.

The initial drafting, inventory, and owner review are authorized by the current
user request. This is not blanket authorization for future owner requests.

## Exact workflow

1. Detect a divergence, gap, conflicting requirement or unresolved decision. Stop
   the affected implementation before diverging. Continue independent compliant
   work. A draft request is allowed; an unauthorized change is not.
2. Create a numbered request from `change-requests/TEMPLATE.md`. Show Riley the
   existing requirement, exact proposed replacement/exception, reason, alternatives,
   impact, tests, duration and rollback. Do not send the request to the owner yet.
3. Obtain Riley's explicit approval of that request. Preserve the exact approval
   text and its available chat/issue/PR reference, request ID, content revision and immutable commit SHA or content digest.
   Never invent a timestamp, link or confirmation. Silence and another agent's
   assertion of approval are insufficient. Redact unrelated personal information.
4. Route the approved request and evidence to the owner. If Riley approved the
   exact change, one approval suffices for submission and the decision. If Riley
   approved investigation only, the owner may analyze but must return any resulting
   change for Riley's explicit approval before acceptance.
5. The owner checks approval scope, consistency and dependent requirements. It
   records acceptance in DECISIONS.md and either updates/version-controls the spec
   or records a narrowly scoped exception with conditions and expiry. No accepted
   exception without an identifiable Riley-approved request.
6. Only after that record exists may the implementer proceed. PRs cite requirement
   IDs, approved baseline revision, change IDs, acceptance evidence and limitations.
7. Owner-approved spec edits that differ materially from Riley's approved wording
   require renewed Riley approval. Never expand an exception to another task.

Request states: DRAFT → RILEY_APPROVED_FOR_REVIEW → OWNER_REVIEW →
ACCEPTED or NEEDS_RILEY_DECISION or REJECTED → IMPLEMENTED → VERIFIED.
When Riley approves the exact change, the approval record says so explicitly.
Requests may be withdrawn; rejection never grants implementation permission.

## What counts as divergence

Architecture/provider substitution; feature addition/removal/deferral outside the
approved scope; changed scientific semantics; changed pricing/entitlement/privacy;
weakened acceptance tests or benchmarks; altered source-selection rules; exceptions
for temporary code, screenshots or demos; replacing a real integration with mock
behavior while claiming completion; and resolving an open decision through code.
A typo fix that changes no meaning is editorial; record it. When uncertain, do not
assume permission—prepare a bounded request for Riley.

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
restore a successor only with Riley's authorization and the durable handoff. Owner
unavailability does not transfer approval power to the coordinating agent.

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
