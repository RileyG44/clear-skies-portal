# ClearSkies landing and download pages

A marketing landing page (`index.html`) and download page (`download.html`),
built with three.js. These are concept mockups: the landing page carries three
switchable directions so they can be compared live.

| Direction | Hash | Idea |
| --- | --- | --- |
| A · Bare Earth | `#sweep` | An airborne LiDAR pass reveals the point cloud. The next pass strips canopy returns to bare earth, then they come back, alternating. Teal/navy relative-elevation palette. |
| B · Watershed | `#watershed` | Rain traces itself downhill across a dark hillshade with contour lines until the drainage network glows. |
| C · Relight | `#relight` | A solid canyon terrain in ember/oxblood. The cursor holds the sun: horizontal position sets azimuth, vertical sets altitude, as in the app's lighting controls. |

Press 1, 2 or 3 to switch. The download page reads the same hash so its
palette follows the chosen direction, highlights the visitor's platform, and
links to the published GitHub release assets (edit `WIN` and `MAC` in
`download.html` when a release goes out). The App Store and Google Play badges
are placeholders until the apps are listed.

The terrain is procedural (`scenes.js`), and the HUD says so: it's never
presented as survey data.

## Preview

```
cd landing && python3 -m http.server 8790
```

Then open http://localhost:8790/#sweep. three.js loads from jsDelivr
(`three@0.170.0`); Inter and IBM Plex Mono from Google Fonts; Pacifico is
bundled in `fonts/`.

These pages aren't in `site.json`, so they aren't deployed to GitHub Pages
yet. Once a direction is chosen, the plan is to vendor three.js, trim to the
chosen scene, and decide where the page is hosted.
