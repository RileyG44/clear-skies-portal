"use strict";

/* One-shot migration, kept in the tree so the mapping stays reviewable.
 *
 * ui-system.css shipped with every colour written as a literal and no custom
 * properties of its own, while index.html already carried a complete semantic
 * token set. Two palettes in one app is what made a dark theme impossible to
 * add without editing every rule in the file.
 *
 * This maps each literal onto a semantic token, so the redesign styles a role
 * ("the raised surface", "muted text") rather than a value. Dark mode is then a
 * second set of values, not a second set of rules.
 */

const fs = require("fs");
const path = require("path");

const file = path.resolve(__dirname, "..", "ui-system.css");

/* Literal -> token, grouped by the role the value plays. The dark values in
   ui-system.css were chosen by role, not by inverting these numbers. */
const MAP = new Map(Object.entries({
  // surfaces, lightest first
  "#ffffff": "--ui-surface",
  "#fff": "--ui-surface",
  "#fdfdfc": "--ui-surface",
  "#fbfbfa": "--ui-rail",
  "#faf9f8": "--ui-rail",
  "#f7f7f5": "--ui-rail",
  "#f5f5f3": "--ui-sunken",
  "#f4f4f2": "--ui-sunken",
  "#f0f0ee": "--ui-selected",
  "#ededea": "--ui-selected",
  "#eaeae7": "--ui-hover",
  "#e8e8e4": "--ui-hover",

  // hairlines
  "#e6e6e2": "--ui-line",
  "#e4e4e0": "--ui-line",
  "#e2e2de": "--ui-line",
  "#dcdcd8": "--ui-line-strong",
  "#d9d9d4": "--ui-line-strong",
  "#d4d4cf": "--ui-line-strong",

  // ink
  "#171716": "--ui-text",
  "#1c1c1b": "--ui-text",
  "#232322": "--ui-text",
  "#3a3a38": "--ui-text-2",
  "#44443f": "--ui-text-2",
  "#5c5c56": "--ui-text-2",
  "#6c6c66": "--ui-text-muted",
  "#71716b": "--ui-text-muted",
  "#7a7a74": "--ui-text-muted",
  "#8c8c86": "--ui-text-faint",
  "#94948e": "--ui-text-faint",

  // controls that invert against the surface
  "#111110": "--ui-control",
  "#0f0f0e": "--ui-control",
  "#000": "--ui-control",
  "#000000": "--ui-control",

  // status
  "#1f7a4d": "--ui-ok",
  "#b4451f": "--ui-warn",
  "#a11d1d": "--ui-danger"
}));

/* Shadows are alpha over an assumed backdrop. A black 8% shadow on white is not
   the same object as on near-black, so they get their own tokens rather than a
   value remap. */
const ALPHA = new Map(Object.entries({
  "rgba(0,0,0,.03)": "--ui-shadow-1",
  "rgba(0,0,0,.04)": "--ui-shadow-1",
  "rgba(0,0,0,.05)": "--ui-shadow-1",
  "rgba(0,0,0,.06)": "--ui-shadow-2",
  "rgba(0,0,0,.07)": "--ui-shadow-2",
  "rgba(0,0,0,.08)": "--ui-shadow-2",
  "rgba(0,0,0,.1)": "--ui-shadow-3",
  "rgba(0,0,0,.12)": "--ui-shadow-3",
  "rgba(0,0,0,.14)": "--ui-shadow-3",
  "rgba(0,0,0,.2)": "--ui-shadow-4",
  "rgba(0,0,0,.24)": "--ui-shadow-4"
}));

function run() {
  let css = fs.readFileSync(file, "utf8");
  const unmapped = new Map();
  let replaced = 0;

  css = css.replace(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g, (raw) => {
    const key = raw.toLowerCase().replace(/\s+/g, "");
    const token = MAP.get(key) || ALPHA.get(key);
    if (token) { replaced++; return `var(${token})`; }
    unmapped.set(key, (unmapped.get(key) || 0) + 1);
    return raw;
  });

  fs.writeFileSync(file, css);
  const report = {
    replaced,
    unmapped: [...unmapped].sort((a, b) => b[1] - a[1])
  };
  fs.writeFileSync(path.resolve(__dirname, "..", ".tokenise-report.json"),
                   JSON.stringify(report, null, 1));
  return report;
}

run();
