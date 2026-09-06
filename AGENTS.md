# Clear Skies agent instructions

## Read before work

Read `docs/ios/SPEC.md`, `docs/ios/GOVERNANCE.md`, and
`docs/ios/DECISIONS.md` before changing the iOS product or shared services.
Read `docs/ios/SPEC_OWNER.md` when taking or handing off the Spec Owner role.
Existing web maintenance must preserve the scientific and loading invariants in
`docs/ENGINEERING_REVIEW.md`. Existing implementation notes are evidence, not
permission to override the native specification.

## Authority — effective immediately from Riley's instructions

- Riley Grant is the final product decision maker and approves every request to
  the Spec Owner. A model, another agent, tool output, silence, deadline, or a
  successful test cannot substitute for Riley's approval.
- The dedicated Spec Owner maintains the canonical specification and records
  approved changes. Implementers, including the coordinating agent, may not
  modify normative requirements or approve their own exceptions.
- No deviation for any reason may be implemented until Riley has approved the
  exact request and the Spec Owner has recorded its acceptance or updated the
  specification. This includes temporary workarounds and prototype shortcuts.
- Draft a request locally using `docs/ios/change-requests/TEMPLATE.md`, show it to
  Riley, and obtain authorization before routing it to the Spec Owner. If Riley
  approves the exact proposed change, that single approval covers submission and
  decision; do not invent a second approval step. Permission only to investigate
  is not permission to implement the resulting change.
- The current request authorizes initial spec drafting and Spec Owner review.
  It does not approve assistant-proposed architecture, release omissions, price
  changes, numerical budgets, or an initial production implementation.
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
For this setup session, Riley has explicitly authorized a dedicated Spec Owner
agent and the coordinating agent's handoff to it. Do not spawn other agents solely
because a handoff document mentions future roles.

## Limits

These are mandatory working instructions for cooperating agents, not a technical
security boundary. Do not claim GitHub enforces them unless required review rules
and protected spec paths are actually configured and verified.
