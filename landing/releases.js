/* The published desktop releases, shared by the download page and the sketchbook
   landing page.

   The values below are the newest builds at the time of writing, so every link
   works with no network calls. On load, refresh() asks the GitHub API for the
   newest published mac-v* and desktop-v* releases and swaps in their versions
   and asset URLs, so the pages keep pointing at the latest packages without an
   edit. If the API is unreachable or rate-limited, the values below stay. */
export const OWNER_REPO = "RileyG44/clear-skies-portal";
export const REPO = `https://github.com/${OWNER_REPO}/releases/download`;
export const RELEASES_PAGE = `https://github.com/${OWNER_REPO}/releases`;
export const WIN = { version: "1.0.7", tag: "desktop-v1.0.7" };
export const MAC = { version: "1.0.7", tag: "mac-v1.0.7" };
export const FILES = {};

function setStatic() {
  Object.assign(FILES, {
    "win-setup": `${REPO}/${WIN.tag}/ClearSkies-Setup-${WIN.version}-x64.exe`,
    "win-guided": `${REPO}/${WIN.tag}/ClearSkies-Guided-Setup-${WIN.version}-x64.exe`,
    "win-zip": `${REPO}/${WIN.tag}/ClearSkies-${WIN.version}-x64.zip`,
    "win-sums": `${REPO}/${WIN.tag}/SHA256SUMS-Windows.txt`,
    "mac-dmg": `${REPO}/${MAC.tag}/ClearSkies-Setup-${MAC.version}-arm64.dmg`,
    "mac-zip": `${REPO}/${MAC.tag}/ClearSkies-${MAC.version}-arm64.zip`,
    "mac-dmg-x64": `${REPO}/${MAC.tag}/ClearSkies-Setup-${MAC.version}-x64.dmg`,
    "mac-zip-x64": `${REPO}/${MAC.tag}/ClearSkies-${MAC.version}-x64.zip`,
    "mac-sums": `${REPO}/${MAC.tag}/SHA256SUMS-Mac.txt`
  });
}
setStatic();

// asset name patterns for each link, per release family
const MATCH = {
  win: { prefix: "desktop-v", rel: WIN, files: {
    "win-setup": /^ClearSkies-Setup-.*x64\.exe$/i,
    "win-guided": /Guided-Setup.*\.exe$/i,
    "win-zip": /x64\.zip$/i,
    "win-sums": /^SHA256SUMS.*\.txt$/i } },
  mac: { prefix: "mac-v", rel: MAC, files: {
    "mac-dmg": /arm64\.dmg$/i,
    "mac-zip": /arm64(-mac)?\.zip$/i,
    "mac-dmg-x64": /x64\.dmg$/i,
    "mac-zip-x64": /x64(-mac)?\.zip$/i,
    "mac-sums": /^SHA256SUMS.*\.txt$/i } }
};

function apply(list) {
  let changed = false;
  for (const m of Object.values(MATCH)) {
    const r = list.find(x => !x.draft && !x.prerelease && x.tag_name.startsWith(m.prefix));
    if (!r) continue;
    const found = {};
    for (const [key, re] of Object.entries(m.files)) {
      const a = r.assets.find(x => re.test(x.name));
      // a file missing from the newest release points at that release's page,
      // so one page never mixes versions
      found[key] = a ? a.browser_download_url : `${RELEASES_PAGE}/tag/${r.tag_name}`;
    }
    if (!r.assets.length) continue;
    m.rel.tag = r.tag_name;
    m.rel.version = r.tag_name.slice(m.prefix.length);
    Object.assign(FILES, found);
    changed = true;
  }
  return changed;
}

const CACHE = "clearskies-releases";
/* Resolves true when newer release data was applied. Never rejects. */
export async function refresh() {
  try {
    const hit = JSON.parse(sessionStorage.getItem(CACHE) || "null");
    if (hit && Date.now() - hit.at < 10 * 60e3) return apply(hit.list);
  } catch {}
  try {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 5000);
    const res = await fetch(`https://api.github.com/repos/${OWNER_REPO}/releases?per_page=30`,
      { headers: { Accept: "application/vnd.github+json" }, signal: ctl.signal });
    clearTimeout(t);
    if (!res.ok) return false;
    const list = (await res.json()).map(r => ({ tag_name: r.tag_name, draft: r.draft, prerelease: r.prerelease,
      assets: (r.assets || []).map(a => ({ name: a.name, browser_download_url: a.browser_download_url })) }));
    try { sessionStorage.setItem(CACHE, JSON.stringify({ at: Date.now(), list })); } catch {}
    return apply(list);
  } catch { return false; }
}
