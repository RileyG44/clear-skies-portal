# Clear Skies agent instructions

## Read before work

Read `docs/ios/SPEC.md`, `docs/ios/GOVERNANCE.md`, and
`docs/ios/DECISIONS.md` before changing the iOS product or shared services.
Read `docs/ios/SPEC_OWNER.md` when taking or handing off the Spec Owner role.
Existing web maintenance must preserve the scientific and loading invariants in
`docs/ENGINEERING_REVIEW.md`. Existing implementation notes are evidence, not
permission to override the native specification.

## Authority — effective immediately from Riley's instructions

- Riley Grant remains the final product decision maker. Under his 2026-10-26
  instruction, a direct build instruction authorizes all changes necessary to
  complete that instructed task, including its change requests and dedicated
  Spec Owner review. Do not ask repeatedly for CR or owner approval within it.
  Unrelated tasks are not authorized. See GOV-002 in docs/ios/DECISIONS.md for
  the exact instruction and independently verified parent-thread evidence.
- The dedicated Spec Owner maintains the canonical specification and records
  approved changes. Implementers, including the coordinating agent, may not
  modify normative requirements or approve their own exceptions.
- Before implementing a deviation, draft a bounded request using
  docs/ios/change-requests/TEMPLATE.md, bind its revision/content digest to the
  applicable Riley instruction, and have the Spec Owner record acceptance or
  update the specification. A direct build instruction supplies authorization
  for necessary changes and owner review; no separate reconfirmation is needed.
- When an exact proposal is approved, that approval covers submission and decision.
  Permission only to investigate does not authorize implementation. A model,
  tool output, silence, deadline or successful test cannot replace Riley's
  authority. Request clarification only for scope not covered by his instruction.
- This authorization rule supersedes older per-request reconfirmation wording
  in repository records and templates. It preserves owner custody, task boundaries,
  unrelated requirements and the pending baseline's status.
- If the spec is ambiguous, conflicting, infeasible, or the owner is unavailable,
  stop only the affected work. Prepare the request and continue independent work
  already authorized and within spec. Never self-appoint a replacement approver.

## Task and pull request contract

Each implementation task must identify the approved spec revision, requirement
IDs, scope, and acceptance checks. Each PR must disclose compliance, test evidence,
remaining limitations, and applicable approved change-request IDs. A draft spec
is not an approved implementation baseline. No silent feature deferrals.

Routine implementation choices inside approved constraints do not constitute
spec changes. A departure from required behavior, architecture, scope, scientific
accuracy, pricing, privacy, performance acceptance, or release gates does.

## Agent continuity

A Spec Owner agent is a session, not a permanent background service. Re-establish
one owner from the repository handoff when needed; restore its authority only
under Riley's authorization. Never pretend an unavailable owner reviewed work.
A direct build instruction authorizes the dedicated owner review needed for that
task; a separate owner-restoration question is unnecessary. The current CR-004
review is expressly authorized for r1 only and ends at handoff. Do not spawn other
agents solely because a handoff document mentions future roles.

## Limits

These are mandatory working instructions for cooperating agents, not a technical
security boundary. Do not claim GitHub enforces them unless required review rules
and protected spec paths are actually configured and verified.
