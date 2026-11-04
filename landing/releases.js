/* The published desktop releases, shared by the download page and the sketchbook
   landing page. Bump the version and tag here when a release goes out. */
export const REPO = "https://github.com/RileyG44/clear-skies-portal/releases/download";
export const WIN = { version: "1.0.2", tag: "desktop-v1.0.2" };
export const MAC = { version: "1.0.0", tag: "build-2026-11-03a" };
export const FILES = {
  "win-setup": `${REPO}/${WIN.tag}/ClearSkies-Setup-${WIN.version}-x64.exe`,
  "win-guided": `${REPO}/${WIN.tag}/ClearSkies-Guided-Setup-${WIN.version}-x64.exe`,
  "win-zip": `${REPO}/${WIN.tag}/ClearSkies-${WIN.version}-x64.zip`,
  "win-sums": `${REPO}/${WIN.tag}/SHA256SUMS-Windows.txt`,
  "mac-dmg": `${REPO}/${MAC.tag}/Clear.Skies.Portal-${MAC.version}-arm64.dmg`,
  "mac-zip": `${REPO}/${MAC.tag}/Clear.Skies.Portal-${MAC.version}-arm64-mac.zip`,
  "mac-sums": `${REPO}/${MAC.tag}/SHA256SUMS.txt`
};
