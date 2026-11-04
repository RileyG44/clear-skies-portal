# ClearSkies landing, Explore and download pages

- `index.html`: the landing page. The hero is a side-view, segmented
  point-cloud forest along the bottom of the window, swaying in a breeze. Moving
  the cursor (or a finger) through the canopy sends gusts that ripple through
  neighbouring trees. "Explore ClearSkies" opens the Explore page; the
  Download link in the nav opens the download page.
- `explore.html`: features and capabilities, real app captures and screenshots
  (`media/`), and two live demos: terrain relighting with the app's four
  lighting controls, and a point-cloud forest with All returns / Bare earth
  and colour modes.
- `download.html`: per-platform downloads with platform detection. It links
  the published GitHub release assets (edit `WIN` and `MAC` in the page when a
  release goes out). The App Store and Google Play badges are placeholders
  until the apps are listed.

All 3D content is procedural (`scenes.js`). The demos say so; nothing is
presented as survey data.

## Preview

```
cd landing && python3 -m http.server 8790
```

Then open http://localhost:8790/. three.js loads from jsDelivr
(`three@0.170.0`); Inter and IBM Plex Mono from Google Fonts; Pacifico is
bundled in `fonts/`.

These pages aren't in `site.json`, so they aren't deployed to GitHub Pages yet.
