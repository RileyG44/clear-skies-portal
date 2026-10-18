# UI annotation numbers

The original context was unavailable; the table preserves received labels,
including truncation. Riley clarified #1–3 and #7 on 2026-10-17; see below.
Do not infer the remaining targets or missing instructions from labels alone.

| Number | Original reference suffix | Received label |
|---|---|---|
| 1 | annotation_2 | Can we put a light background behind this or so… |
| 2 | annotation_e | move all of these to the bottom of this pop out… |
| 3 | annotation_g | Make these layer titles selectable, where click… |
| 4 | annotation_i | Get ride of this. |
| 5 | annotation_k | Include this with the info were putting at the … |
| 6 | annotation_m | The icons are too wide here causing the whole s… |
| 7 | annotation_o | These 3D buttons are too busy. Can we make them… |
| 8 | annotation_q | Let's actually get rid of this mode selection p… |
| 9 | annotation_s | Lets change out the drop down menu here for sel… |
| 10 | annotation_v | We need a second button here below select area … |
| 11 | annotation_x | Get rid of this explainer text. |
| 12 | annotation_z | Add a way to clear the current selection and an… |
| 13 | annotation_11 | Same thing here re a way to clear the entry and… |
| 14 | annotation_13 | Move copy coordinates to the top of this list, … |
| 15 | annotation_15 | Move this and ALL base layer related menu items… |
| 16 | annotation_17 | turn these into on/off style graphical buttons … |
| 17 | annotation_19 | This doesn't need to be here/doesnt belong here… |
| 18 | annotation_1b | This looks Terrible. Lets swap it our for a tog… |

Original references have the prefix `preview-annotation_`.
UI worktree: `t3/implement-preview-ui-annotations`, initial inventory commit
`95c23c7`. The first pass implements #1–3 and #7.

## Clarified first pass

1. Desktop bottom-left map info and layer key: add a pale background for readability.
2. Toolbar Layers pop-out: move metadata beneath layer names into a Sources footer.
3. Toolbar Layers pop-out: make titles open matching layer settings; sidebar titles do the same.
7. Sidebar menu hover/selected rows: use flat fills, without raised rims or scaling.

#4–6 are deferred because Riley is unsure of the original targets. #8–18 await further descriptions.
