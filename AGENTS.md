# Clear Skies agent instructions

Riley Grant owns the product. When he asks for a fix or feature, build it and
ship it: branch, commit, PR, merge. No change requests, Spec Owner reviews,
approval records or extra sign-off steps. Ask only when the request is genuinely
unclear.

## Working rules

- Keep changes focused on what was asked. Unrelated work needs its own request.
- Run the tests that cover what you touched plus `npm run check`. The full suite
  isn't needed for every change. Riley tests live, and we fix what breaks.
- Bump the build stamp (`version.js`, `sw.js`, `?build=` in `index.html`) for
  every deployed web change.
- Keep the scientific and loading contracts in `docs/ENGINEERING_REVIEW.md`:
  never label overview data as LiDAR, and don't let late lower-quality data
  overwrite detail.
- Don't spawn extra agents unless Riley asks.
- PR descriptions: what changed, what was tested, known limitations. Keep it short.

## Reference

`docs/ios/SPEC.md` describes the intended native iOS product. Treat it as
background, not a gate. `docs/ios/GOVERNANCE.md`, `SPEC_OWNER.md`,
`DECISIONS.md` and `change-requests/` are a historical record of the retired
change-request process. Don't follow them or add to them.
