//! Deterministic raster objects, ported from glacial-segment-core.js and
//! glacial-zone-core.js. Pixel centres, tie order and skeleton graph topology
//! are part of the science contract.

use std::f64::consts::{PI, SQRT_2};

pub(super) type Point = [f64; 2];
const DX: [isize; 8] = [1, 1, 0, -1, -1, -1, 0, 1];
const DY: [isize; 8] = [0, 1, 1, 1, 0, -1, -1, -1];

/// The JS binary heap's equal-key ordering is deliberate: skeleton diameters
/// can have equal-cost alternatives, and changing their order changes profiles.
pub(super) struct Heap(Vec<(f64, usize)>);
impl Heap {
    pub fn new() -> Self {
        Self(Vec::new())
    }
    pub fn push(&mut self, key: f64, value: usize) {
        let mut i = self.0.len();
        self.0.push((key, value));
        while i > 0 {
            let parent = (i - 1) / 2;
            if self.0[parent].0 <= key {
                break;
            }
            self.0[i] = self.0[parent];
            i = parent;
        }
        self.0[i] = (key, value);
    }
    pub fn pop(&mut self) -> Option<(f64, usize)> {
        let top = *self.0.first()?;
        let last = self.0.pop().unwrap();
        let size = self.0.len();
        if size > 0 {
            let mut i = 0;
            loop {
                let (left, right) = (2 * i + 1, 2 * i + 2);
                let mut smallest = i;
                let mut key = last.0;
                if left < size && self.0[left].0 < key {
                    smallest = left;
                    key = self.0[left].0;
                }
                if right < size && self.0[right].0 < key {
                    smallest = right;
                }
                if smallest == i {
                    break;
                }
                self.0[i] = self.0[smallest];
                i = smallest;
            }
            self.0[i] = last;
        }
        Some(top)
    }
}

pub(super) fn neighbours(i: usize, w: usize, h: usize) -> impl Iterator<Item = usize> {
    let (x, y) = ((i % w) as isize, (i / w) as isize);
    (-1..=1).flat_map(move |dy| {
        (-1..=1).filter_map(move |dx| {
            let (nx, ny) = (x + dx, y + dy);
            (dx != 0 || dy != 0).then_some(())?;
            (nx >= 0 && ny >= 0 && nx < w as isize && ny < h as isize).then(|| ny as usize * w + nx as usize)
        })
    })
}

pub(super) struct Component {
    pub pixels: Vec<usize>,
    pub bbox: [usize; 4],
}
pub(super) fn components(mask: &[u8], w: usize, h: usize, minimum: f64) -> Vec<Component> {
    let mut seen = vec![false; mask.len()];
    let mut found = Vec::new();
    let mut queue = Vec::new();
    for seed in 0..mask.len() {
        if seen[seed] || mask[seed] == 0 {
            continue;
        }
        queue.clear();
        queue.push(seed);
        seen[seed] = true;
        let mut bbox = [w, h, 0, 0];
        let mut head = 0;
        while head < queue.len() {
            let i = queue[head];
            head += 1;
            bbox[0] = bbox[0].min(i % w);
            bbox[2] = bbox[2].max(i % w);
            bbox[1] = bbox[1].min(i / w);
            bbox[3] = bbox[3].max(i / w);
            for nb in neighbours(i, w, h) {
                if !seen[nb] && mask[nb] != 0 {
                    seen[nb] = true;
                    queue.push(nb);
                }
            }
        }
        if (queue.len() as f64) < minimum {
            continue;
        }
        queue.sort_unstable();
        found.push(Component { pixels: queue.clone(), bbox });
    }
    found.sort_by(|a, b| b.pixels.len().cmp(&a.pixels.len()).then(a.pixels[0].cmp(&b.pixels[0])));
    found
}

/// Exact separable squared Euclidean distance transform.
pub(super) fn distance_to(mask: &[u8], w: usize, h: usize, target: u8) -> Vec<f64> {
    fn edt(f: &[f64], d: &mut [f64], v: &mut [usize], z: &mut [f64]) {
        let mut k = 0;
        v[0] = 0;
        z[0] = f64::NEG_INFINITY;
        z[1] = f64::INFINITY;
        for q in 1..f.len() {
            let crossing = |at: usize| {
                ((f[q] + (q * q) as f64) - (f[v[at]] + (v[at] * v[at]) as f64)) / (2.0 * q as f64 - 2.0 * v[at] as f64)
            };
            let mut s = crossing(k);
            while s <= z[k] {
                k -= 1;
                s = crossing(k);
            }
            k += 1;
            v[k] = q;
            z[k] = s;
            z[k + 1] = f64::INFINITY;
        }
        k = 0;
        for (q, out) in d.iter_mut().enumerate().take(f.len()) {
            while z[k + 1] < q as f64 {
                k += 1;
            }
            *out = (q as f64 - v[k] as f64).powi(2) + f[v[k]];
        }
    }
    let mut g: Vec<f64> = mask.iter().map(|&b| if b == target { 0.0 } else { 1e20 }).collect();
    let n = w.max(h);
    let (mut f, mut d, mut v, mut z) = (vec![0.0; n], vec![0.0; n], vec![0; n], vec![0.0; n + 1]);
    for x in 0..w {
        for y in 0..h {
            f[y] = g[y * w + x];
        }
        edt(&f[..h], &mut d[..h], &mut v, &mut z);
        for y in 0..h {
            g[y * w + x] = d[y];
        }
    }
    for row in g.chunks_exact_mut(w) {
        f[..w].copy_from_slice(row);
        edt(&f[..w], &mut d[..w], &mut v, &mut z);
        row.copy_from_slice(&d[..w]);
    }
    g
}

/// Fill only interior four-connected gaps. A padded ridge crop can additionally
/// limit the hole area so a true ring stays open.
fn fill_holes(buf: &mut [u8], w: usize, h: usize, max_area: f64) {
    let mut seen = vec![false; buf.len()];
    let mut queue = Vec::new();
    for seed in 0..buf.len() {
        if buf[seed] != 0 || seen[seed] {
            continue;
        }
        queue.clear();
        queue.push(seed);
        seen[seed] = true;
        let (mut head, mut outside) = (0, false);
        while head < queue.len() {
            let i = queue[head];
            head += 1;
            let (x, y) = (i % w, i / w);
            outside |= x == 0 || y == 0 || x + 1 == w || y + 1 == h;
            let ns = [
                x.checked_sub(1).map(|_| i - 1),
                (x + 1 < w).then_some(i + 1),
                y.checked_sub(1).map(|_| i - w),
                (y + 1 < h).then_some(i + w),
            ];
            for nb in ns.into_iter().flatten() {
                if !seen[nb] && buf[nb] == 0 {
                    seen[nb] = true;
                    queue.push(nb);
                }
            }
        }
        if !outside && queue.len() as f64 <= max_area {
            for &i in &queue {
                buf[i] = 1;
            }
        }
    }
}

pub(super) fn closed_zones(mask: &[u8], w: usize, h: usize, cell: f64) -> Vec<Component> {
    let radius = (60.0 / cell).ceil() as usize;
    let pad = radius + 1;
    let (pw, ph) = (w + 2 * pad, h + 2 * pad);
    let mut padded = vec![0; pw * ph];
    for y in 0..h {
        padded[(y + pad) * pw + pad..(y + pad) * pw + pad + w].copy_from_slice(&mask[y * w..(y + 1) * w]);
    }
    let distance = distance_to(&padded, pw, ph, 1);
    let r2 = (radius * radius) as f64;
    for (b, d) in padded.iter_mut().zip(distance) {
        *b = u8::from(d <= r2);
    }
    let distance = distance_to(&padded, pw, ph, 0);
    let mut closed = mask.to_vec();
    for y in 0..h {
        for x in 0..w {
            if distance[(y + pad) * pw + x + pad] > r2 {
                closed[y * w + x] = 1;
            }
        }
    }
    drop(distance);
    drop(padded);
    fill_holes(&mut closed, w, h, f64::INFINITY);
    components(&closed, w, h, 20000.0 / (cell * cell))
}

fn thin(buf: &mut [u8], w: usize) {
    let mut active: Vec<usize> = (0..buf.len()).filter(|&i| buf[i] != 0).collect();
    let mut removed = Vec::new();
    loop {
        let mut changed = false;
        for step in 0..2 {
            removed.clear();
            for &i in &active {
                if buf[i] == 0 {
                    continue;
                }
                let p = [
                    buf[i - w],
                    buf[i - w + 1],
                    buf[i + 1],
                    buf[i + w + 1],
                    buf[i + w],
                    buf[i + w - 1],
                    buf[i - 1],
                    buf[i - w - 1],
                ];
                if !(2..=6).contains(&p.iter().sum::<u8>()) {
                    continue;
                }
                if (0..8).filter(|&j| p[j] == 0 && p[(j + 1) % 8] != 0).count() != 1 {
                    continue;
                }
                let blocked = if step == 0 {
                    p[0] * p[2] * p[4] != 0 || p[2] * p[4] * p[6] != 0
                } else {
                    p[0] * p[2] * p[6] != 0 || p[0] * p[4] * p[6] != 0
                };
                if !blocked {
                    removed.push(i);
                }
            }
            for &i in &removed {
                buf[i] = 0;
            }
            changed |= !removed.is_empty();
        }
        if !changed {
            break;
        }
        active.retain(|&i| buf[i] != 0);
    }
}

struct Graph {
    at: Vec<usize>,
    edges: Vec<Vec<(usize, f64)>>,
}
impl Graph {
    fn new(buf: &[u8], w: usize) -> Self {
        let at: Vec<usize> = (0..buf.len()).filter(|&i| buf[i] != 0).collect();
        let mut node = vec![usize::MAX; buf.len()];
        for (j, &i) in at.iter().enumerate() {
            node[i] = j;
        }
        let edges = at
            .iter()
            .map(|&i| {
                let mut links = Vec::with_capacity(3);
                for d in 0..8 {
                    let next = (i as isize + DY[d] * w as isize + DX[d]) as usize;
                    if buf[next] == 0 {
                        continue;
                    }
                    if d % 2 == 1
                        && (buf[(i as isize + DX[d]) as usize] != 0
                            || buf[(i as isize + DY[d] * w as isize) as usize] != 0)
                    {
                        continue;
                    }
                    links.push((node[next], if d % 2 == 1 { SQRT_2 } else { 1.0 }));
                }
                links
            })
            .collect();
        Self { at, edges }
    }
    fn dijkstra(&self, source: usize) -> (Vec<f64>, Vec<usize>) {
        let mut dist = vec![f64::INFINITY; self.at.len()];
        let mut prev = vec![usize::MAX; self.at.len()];
        let mut heap = Heap::new();
        dist[source] = 0.0;
        heap.push(0.0, source);
        while let Some((key, node)) = heap.pop() {
            if key > dist[node] {
                continue;
            }
            for &(other, cost) in &self.edges[node] {
                let next = key + cost;
                if next < dist[other] {
                    dist[other] = next;
                    prev[other] = node;
                    heap.push(next, other);
                }
            }
        }
        (dist, prev)
    }
    fn pieces(&self) -> (Vec<usize>, Vec<usize>, usize) {
        let mut labels = vec![usize::MAX; self.at.len()];
        let (mut sizes, mut best) = (Vec::new(), 0);
        for seed in 0..self.at.len() {
            if labels[seed] != usize::MAX {
                continue;
            }
            let mut stack = vec![seed];
            let mut size = 0;
            labels[seed] = sizes.len();
            while let Some(i) = stack.pop() {
                size += 1;
                for &(nb, _) in &self.edges[i] {
                    if labels[nb] == usize::MAX {
                        labels[nb] = sizes.len();
                        stack.push(nb);
                    }
                }
            }
            sizes.push(size);
            if size > sizes[best] {
                best = sizes.len() - 1;
            }
        }
        (labels, sizes, best)
    }
}

fn width_from_distance(d: f64) -> f64 {
    (2.0 * d - 0.5).max(1.0)
}

fn prune(skel: &mut [u8], w: usize, dist: &[f64]) -> Graph {
    type Spurs = Vec<(Vec<usize>, f64)>;
    let mut graph = Graph::new(skel, w);
    for _ in 0..8 {
        // Vec in node order reproduces JS Map insertion ordering.
        let mut groups: Vec<(usize, Spurs)> = Vec::new();
        let mut group_of = std::collections::HashMap::new();
        for end in 0..graph.at.len() {
            if graph.edges[end].len() != 1 {
                continue;
            }
            let (mut chain, mut prev, mut at, mut length) = (vec![end], usize::MAX, end, 0.0);
            let mut stop = usize::MAX;
            for _ in 0..graph.at.len() {
                let Some(&(next, cost)) = graph.edges[at].iter().find(|&&(nb, _)| nb != prev) else {
                    break;
                };
                length += cost;
                if graph.edges[next].len() != 2 {
                    stop = next;
                    break;
                }
                chain.push(next);
                prev = at;
                at = next;
            }
            if stop == usize::MAX || graph.edges[stop].len() < 3 {
                continue;
            }
            let group = *group_of.entry(stop).or_insert_with(|| {
                groups.push((stop, Vec::new()));
                groups.len() - 1
            });
            groups[group].1.push((chain, length));
        }
        let mut removed = false;
        for (junction, spurs) in groups {
            let radius = dist[graph.at[junction]];
            let mut short: Vec<_> = spurs
                .into_iter()
                .filter(|(chain, len)| len + dist[graph.at[chain[0]]] - radius < width_from_distance(radius))
                .collect();
            short.sort_by(|a, b| b.1.total_cmp(&a.1));
            let keep = 2usize.saturating_sub(graph.edges[junction].len() - short.len());
            for (cut, _) in short.iter().skip(keep) {
                for &node in cut {
                    skel[graph.at[node]] = 0;
                }
                removed = true;
            }
        }
        if !removed {
            break;
        }
        graph = Graph::new(skel, w);
    }
    graph
}

fn farthest(dist: &[f64]) -> usize {
    let (mut best, mut maximum) = (0, -1.0);
    for (i, &d) in dist.iter().enumerate() {
        if d.is_finite() && d > maximum {
            best = i;
            maximum = d;
        }
    }
    best
}

fn longest_path(g: &Graph) -> (Vec<usize>, bool, bool, bool) {
    if g.at.is_empty() {
        return (Vec::new(), false, false, false);
    }
    let (labels, sizes, largest) = g.pieces();
    if sizes.len() == 1 && g.at.len() >= 4 && g.edges.iter().all(|e| e.len() == 2) {
        let (mut path, mut prev, mut at) = (vec![0], usize::MAX, 0);
        for _ in 0..g.at.len() {
            let next = if g.edges[at][0].0 != prev { g.edges[at][0].0 } else { g.edges[at][1].0 };
            path.push(next);
            if next == 0 {
                break;
            }
            prev = at;
            at = next;
        }
        return (path, true, true, false);
    }
    let mut start = labels.iter().position(|&l| l == largest).unwrap();
    for (i, &l) in labels.iter().enumerate() {
        if l == largest && g.edges[i].len() == 1 {
            start = i;
            break;
        }
    }
    let a = farthest(&g.dijkstra(start).0);
    let (dist, prev) = g.dijkstra(a);
    let mut path = Vec::new();
    let mut at = farthest(&dist);
    while at != usize::MAX {
        path.push(at);
        at = prev[at];
    }
    path.reverse();
    let mut on_path = vec![false; g.at.len()];
    for &node in &path {
        on_path[node] = true;
    }
    let off = labels.iter().enumerate().filter(|&(i, &l)| l == largest && !on_path[i]).count();
    let branched = off as f64 / g.at.len() as f64 > 0.05;
    let mut closed = false;
    if path.len() >= 3 {
        let mut blocked = vec![false; g.at.len()];
        for &node in &path[..path.len() - 1] {
            blocked[node] = true;
        }
        let target = *path.last().unwrap();
        let mut stack = vec![path[0]];
        while let Some(node) = stack.pop() {
            for &(nb, _) in &g.edges[node] {
                if nb == target {
                    closed = true;
                    break;
                }
                if !blocked[nb] {
                    blocked[nb] = true;
                    stack.push(nb);
                }
            }
            if closed {
                break;
            }
        }
    }
    (path, closed, false, branched)
}

pub(super) fn length(points: &[Point]) -> f64 {
    points.windows(2).map(|p| (p[1][0] - p[0][0]).hypot(p[1][1] - p[0][1])).sum()
}
fn smooth(points: &[Point], window: usize) -> Vec<Point> {
    let half = window.max(1) / 2;
    points
        .iter()
        .enumerate()
        .map(|(i, &p)| {
            let reach = half.min(i).min(points.len() - 1 - i);
            if reach == 0 {
                return p;
            }
            let (mut x, mut y) = (0.0, 0.0);
            for p in &points[i - reach..=i + reach] {
                x += p[0];
                y += p[1];
            }
            [x / (2 * reach + 1) as f64, y / (2 * reach + 1) as f64]
        })
        .collect()
}
fn resample(points: &[Point], spacing: f64) -> Vec<Point> {
    let mut out = vec![points[0]];
    let mut carried = 0.0;
    for pair in points.windows(2) {
        let (dx, dy) = (pair[1][0] - pair[0][0], pair[1][1] - pair[0][1]);
        let segment = dx.hypot(dy);
        let mut along = spacing - carried;
        while along <= segment {
            out.push([pair[0][0] + dx * along / segment, pair[0][1] + dy * along / segment]);
            along += spacing;
        }
        carried = segment - (along - spacing);
    }
    let (last, tail) = (points.last().unwrap(), out.last().unwrap());
    if (last[0] - tail[0]).hypot(last[1] - tail[1]) >= spacing / 2.0 {
        out.push(*last);
    }
    out
}
fn ramp(v: f64, a: f64, b: f64) -> f64 {
    ((v - a) / (b - a)).clamp(0.0, 1.0)
}
fn arc(path: &[Point], len: f64, width: f64, cell: f64) -> (f64, f64) {
    if path.len() < 3 || len < 4.0 {
        return (0.0, 0.0);
    }
    let points = resample(path, width.min(len / 4.0).max(2.0));
    if points.len() < 3 {
        return (0.0, 0.0);
    }
    let (mut net, mut absolute, mut previous) = (0.0f64, 0.0, None);
    for pair in points.windows(2) {
        let heading = (pair[1][1] - pair[0][1]).atan2(pair[1][0] - pair[0][0]);
        if let Some(prev) = previous {
            let diff: f64 = heading - prev;
            let turn = diff.sin().atan2(diff.cos());
            net += turn;
            absolute += turn.abs();
        }
        previous = Some(heading);
    }
    let consistency = if absolute > 0.0 { net.abs() / absolute } else { 0.0 };
    let deg = PI / 180.0;
    let bend = ramp(net.abs(), 10.0 * deg, 45.0 * deg).min(1.0 - ramp(net.abs(), 200.0 * deg, 330.0 * deg));
    let radius = if net.abs() > 1e-9 { len * cell / net.abs() } else { f64::INFINITY };
    let factor = if !radius.is_finite() {
        0.0
    } else if radius < 50.0 {
        1.0 - (50.0 / radius).log2()
    } else if radius > 20000.0 {
        1.0 - (radius / 20000.0).log2()
    } else {
        1.0
    };
    ((consistency * bend * factor.clamp(0.0, 1.0)).clamp(0.0, 1.0), net)
}

pub(super) struct Segment {
    pub pixels: Vec<usize>,
    pub bbox: [usize; 4],
    pub centroid: Point,
    pub path: Vec<Point>,
    pub width: f64,
    pub length: f64,
    pub elongation: f64,
    pub orientation: f64,
    pub arc_score: f64,
    pub net_bend: f64,
    pub closed: bool,
    pub branched: bool,
}

pub(super) fn moments(pixels: &[usize], w: usize) -> (Point, f64, f64, f64) {
    let (mut sx, mut sy) = (0.0, 0.0);
    for &i in pixels {
        sx += (i % w) as f64;
        sy += (i / w) as f64;
    }
    let mean = [sx / pixels.len() as f64, sy / pixels.len() as f64];
    let (mut xx, mut yy, mut xy) = (0.0, 0.0, 0.0);
    for &i in pixels {
        let (x, y) = ((i % w) as f64 - mean[0], (i / w) as f64 - mean[1]);
        xx += x * x;
        yy += y * y;
        xy += x * y;
    }
    (mean, xx, yy, xy)
}
pub(super) fn orientation(xx: f64, yy: f64, xy: f64) -> f64 {
    let mut a = 0.5 * (2.0 * xy).atan2(xx - yy);
    if a < 0.0 {
        a += PI;
    }
    if a >= PI { 0.0 } else { a }
}

pub(super) fn describe(c: Component, w: usize, cell: f64) -> Segment {
    let [x0, y0, x1, y1] = c.bbox;
    let (centroid, xx, yy, xy) = moments(&c.pixels, w);
    let (bw, bh) = (x1 - x0 + 3, y1 - y0 + 3);
    let mut skel = vec![0; bw * bh];
    for &i in &c.pixels {
        skel[(i / w - y0 + 1) * bw + i % w - x0 + 1] = 1;
    }
    let mut perimeter = 0;
    for i in 0..skel.len() {
        if skel[i] != 0 {
            for nb in [i - 1, i + 1, i - bw, i + bw] {
                if skel[nb] == 0 {
                    perimeter += 1;
                }
            }
        }
    }
    let wall = if perimeter > 0 { 2.0 * c.pixels.len() as f64 / perimeter as f64 } else { 1.0 };
    fill_holes(&mut skel, bw, bh, (wall * wall).max(1.0));
    let dist: Vec<f64> = distance_to(&skel, bw, bh, 0).into_iter().map(f64::sqrt).collect();
    thin(&mut skel, bw);
    let graph = prune(&mut skel, bw, &dist);
    let (nodes, closed, cycle, branched) = longest_path(&graph);
    let original: Vec<Point> = nodes
        .iter()
        .map(|&n| {
            let i = graph.at[n];
            [(i % bw + x0 - 1) as f64, (i / bw + y0 - 1) as f64]
        })
        .collect();
    let mut path = Vec::new();
    if let Some(first) = original.first() {
        path.push(*first);
        for i in 1..original.len().saturating_sub(1) {
            let a = path.last().unwrap();
            let b = original[i + 1];
            if (a[0] - b[0]).abs().max((a[1] - b[1]).abs()) > 1.0 {
                path.push(original[i]);
            }
        }
        if original.len() > 1 {
            path.push(*original.last().unwrap());
        }
    }
    if path.is_empty() {
        let mut best = c.pixels[0];
        let mut distance = f64::INFINITY;
        for &i in &c.pixels {
            let d = ((i % w) as f64 - centroid[0]).hypot((i / w) as f64 - centroid[1]);
            if d < distance {
                best = i;
                distance = d;
            }
        }
        path.push([(best % w) as f64, (best / w) as f64]);
    }
    if path.last().unwrap()[0] < path[0][0]
        || (path.last().unwrap()[0] == path[0][0] && path.last().unwrap()[1] < path[0][1])
    {
        path.reverse();
    }
    let mut samples: Vec<f64> =
        path.iter().map(|p| dist[(p[1] as usize - y0 + 1) * bw + p[0] as usize - x0 + 1]).collect();
    samples.sort_by(f64::total_cmp);
    let mid = samples.len() / 2;
    let median = if samples.len() % 2 == 1 { samples[mid] } else { (samples[mid - 1] + samples[mid]) / 2.0 };
    let width = width_from_distance(median);
    let skeleton_length = length(&path);
    let len = if cycle { skeleton_length } else { skeleton_length + width };
    let (mut arc_score, net_bend) =
        arc(&smooth(&path, super::super::js_round(width) as usize), skeleton_length, width, cell);
    if closed || branched {
        arc_score = 0.0;
    }
    Segment {
        pixels: c.pixels,
        bbox: c.bbox,
        centroid,
        path,
        width: width * cell,
        length: len * cell,
        elongation: len / width,
        orientation: orientation(xx, yy, xy),
        arc_score,
        net_bend,
        closed,
        branched,
    }
}
