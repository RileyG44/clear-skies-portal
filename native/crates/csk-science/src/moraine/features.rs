//! DEM observations used by the ridge and belt verdicts. Only live classifier
//! inputs are retained: per-ridge display-only LRM rasters are not cached.

use std::collections::HashMap;

use super::geometry::{Heap, Point, Segment, neighbours};
use crate::{glacial, js_round};

pub(super) fn quantile(sorted: &[f64], p: f64) -> f64 {
    if sorted.is_empty() {
        return 0.0;
    }
    let pos = (sorted.len() - 1) as f64 * p;
    let lo = pos.floor() as usize;
    let hi = pos.ceil() as usize;
    sorted[lo] * (1.0 - (pos - lo as f64)) + sorted[hi] * (pos - lo as f64)
}
fn median(values: &mut [f64]) -> f64 {
    values.sort_by(f64::total_cmp);
    quantile(values, 0.5)
}

struct Tree {
    index: usize,
    axis: usize,
    left: Option<Box<Tree>>,
    right: Option<Box<Tree>>,
}
impl Tree {
    fn new(points: &[Point], mut indices: Vec<usize>, depth: usize) -> Option<Box<Self>> {
        if indices.is_empty() {
            return None;
        }
        let axis = depth % 2;
        // Stable ties preserve the JS nearest-vertex tie ordering.
        indices.sort_by(|&a, &b| points[a][axis].total_cmp(&points[b][axis]));
        let middle = indices.len() / 2;
        Some(Box::new(Self {
            index: indices[middle],
            axis,
            left: Self::new(points, indices[..middle].to_vec(), depth + 1),
            right: Self::new(points, indices[middle + 1..].to_vec(), depth + 1),
        }))
    }
    fn nearest(&self, points: &[Point], target: Point) -> (usize, f64) {
        fn visit(node: &Tree, points: &[Point], target: Point, best: &mut (usize, f64)) {
            let p = points[node.index];
            let (dx, dy) = (target[0] - p[0], target[1] - p[1]);
            let squared = dx * dx + dy * dy;
            if squared < best.1 {
                *best = (node.index, squared);
            }
            let diff = target[node.axis] - p[node.axis];
            let (first, other) = if diff < 0.0 { (&node.left, &node.right) } else { (&node.right, &node.left) };
            if let Some(n) = first {
                visit(n, points, target, best);
            }
            if diff * diff <= best.1
                && let Some(n) = other
            {
                visit(n, points, target, best);
            }
        }
        let mut best = (0, f64::INFINITY);
        visit(self, points, target, &mut best);
        best
    }
}

fn sample(grid: &[f32], w: usize, h: usize, p: Point) -> f64 {
    let [x, y] = p;
    if x < 0.0 || y < 0.0 || x > (w - 1) as f64 || y > (h - 1) as f64 {
        return f64::NAN;
    }
    let (x0, y0) = (x.floor() as usize, y.floor() as usize);
    let (x1, y1) = ((x0 + 1).min(w - 1), (y0 + 1).min(h - 1));
    let (fx, fy) = (x - x0 as f64, y - y0 as f64);
    let mut result = 0.0;
    for (i, weight) in [
        (y0 * w + x0, (1.0 - fx) * (1.0 - fy)),
        (y0 * w + x1, fx * (1.0 - fy)),
        (y1 * w + x0, (1.0 - fx) * fy),
        (y1 * w + x1, fx * fy),
    ] {
        if weight == 0.0 {
            continue;
        }
        if !grid[i].is_finite() {
            return f64::NAN;
        }
        result += weight * f64::from(grid[i]);
    }
    result
}

pub(super) struct Blob {
    pub point: Point,
    pub index: usize,
}
pub(super) fn depressions(grid: &[f32], w: usize, h: usize, cell: f64) -> Vec<Blob> {
    let mut filled: Vec<f64> = grid.iter().map(|&v| f64::from(v)).collect();
    let mut seen = vec![false; grid.len()];
    let mut heap = Heap::new();
    for i in 0..grid.len() {
        if !filled[i].is_finite() {
            continue;
        }
        let (x, y) = (i % w, i / w);
        let outlet =
            x == 0 || y == 0 || x + 1 == w || y + 1 == h || neighbours(i, w, h).any(|j| !filled[j].is_finite());
        if outlet {
            seen[i] = true;
            heap.push(filled[i], i);
        }
    }
    while let Some((_, i)) = heap.pop() {
        for nb in neighbours(i, w, h) {
            if seen[nb] || !filled[nb].is_finite() {
                continue;
            }
            seen[nb] = true;
            filled[nb] = filled[nb].max(filled[i]);
            heap.push(filled[nb], nb);
        }
    }
    seen.fill(false);
    let mut blobs = Vec::new();
    let mut queue = Vec::new();
    for seed in 0..grid.len() {
        let depth = filled[seed] - f64::from(grid[seed]);
        if seen[seed] || !depth.is_finite() || depth <= 0.5 {
            continue;
        }
        seen[seed] = true;
        queue.clear();
        queue.push(seed);
        let (mut head, mut sx, mut sy) = (0, 0.0, 0.0);
        while head < queue.len() {
            let i = queue[head];
            head += 1;
            sx += (i % w) as f64;
            sy += (i / w) as f64;
            for nb in neighbours(i, w, h) {
                if !seen[nb] && filled[nb] - f64::from(grid[nb]) > 0.5 {
                    seen[nb] = true;
                    queue.push(nb);
                }
            }
        }
        if queue.len() as f64 * (cell * cell) >= 5000.0 {
            continue;
        }
        let point = [sx / queue.len() as f64, sy / queue.len() as f64];
        blobs.push(Blob { point, index: js_round(point[1]) as usize * w + js_round(point[0]) as usize });
    }
    blobs
}

struct Valley {
    low: f64,
    range: f64,
    angle: f64,
    anisotropy: f64,
}
fn valley(grid: &[f32], w: usize) -> Option<Valley> {
    let mut elevations: Vec<f64> = grid.iter().filter(|v| v.is_finite()).map(|&v| f64::from(v)).collect();
    elevations.sort_by(f64::total_cmp);
    if elevations.is_empty() {
        return None;
    }
    let low = quantile(&elevations, 0.25);
    let range = quantile(&elevations, 0.95) - quantile(&elevations, 0.05);
    if range <= 1e-9 {
        return None;
    }
    let (mut count, mut mx, mut my, mut xx, mut yy, mut xy) = (0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
    for (j, &v) in grid.iter().enumerate() {
        if !v.is_finite() || f64::from(v) > low {
            continue;
        }
        let (x, y) = ((j % w) as f64, (j / w) as f64);
        count += 1.0;
        let (dx, dy) = (x - mx, y - my);
        mx += dx / count;
        my += dy / count;
        xx += dx * (x - mx);
        yy += dy * (y - my);
        xy += dx * (y - my);
    }
    if count < 3.0 || xx + yy <= 0.0 {
        return None;
    }
    Some(Valley {
        low,
        range,
        angle: 0.5 * (2.0 * xy).atan2(xx - yy),
        anisotropy: ((xx - yy).hypot(2.0 * xy) / (xx + yy)).clamp(0.0, 1.0),
    })
}

pub(super) struct Context {
    pub blobs: Vec<Blob>,
    slope: Vec<f32>,
    valley: Option<Valley>,
}
impl Context {
    pub fn new(grid: &[f32], w: usize, h: usize, cell: f64) -> Self {
        fn derivative(a: f64, c: f64, b: f64, cell: f64) -> f64 {
            match (a.is_finite(), b.is_finite()) {
                (true, true) => (b - a) / (2.0 * cell),
                (true, false) => (c - a) / cell,
                (false, true) => (b - c) / cell,
                _ => f64::NAN,
            }
        }
        let mut slope = vec![f32::NAN; grid.len()];
        for i in 0..grid.len() {
            if !grid[i].is_finite() {
                continue;
            }
            let (x, y) = (i % w, i / w);
            let at = |idx: Option<usize>| idx.map_or(f64::NAN, |j| f64::from(grid[j]));
            let p = derivative(
                at(x.checked_sub(1).map(|_| i - 1)),
                f64::from(grid[i]),
                at((x + 1 < w).then_some(i + 1)),
                cell,
            );
            let q = derivative(
                at(y.checked_sub(1).map(|_| i - w)),
                f64::from(grid[i]),
                at((y + 1 < h).then_some(i + w)),
                cell,
            );
            slope[i] = (p.hypot(q).atan() * 180.0 / std::f64::consts::PI) as f32;
        }
        Self { blobs: depressions(grid, w, h, cell), slope, valley: valley(grid, w) }
    }
}

struct Vertex {
    point: Point,
    tangent: Point,
    normal: Point,
    crest: f64,
}
fn vertices(grid: &[f32], w: usize, h: usize, path: &[Point]) -> Vec<Vertex> {
    let mut points = Vec::new();
    for &p in path {
        if points.last() != Some(&p) {
            points.push(p);
        }
    }
    points
        .iter()
        .enumerate()
        .map(|(i, &point)| {
            let (a, b) = (points[i.saturating_sub(2)], points[(i + 2).min(points.len() - 1)]);
            let (dx, dy) = (b[0] - a[0], b[1] - a[1]);
            let length = dx.hypot(dy);
            let tangent = if length > 0.0 { [dx / length, dy / length] } else { [0.0, 0.0] };
            Vertex { point, tangent, normal: [-tangent[1], tangent[0]], crest: sample(grid, w, h, point) }
        })
        .collect()
}
fn displaced(p: Point, n: Point, d: f64) -> Point {
    [p[0] + n[0] * d, p[1] + n[1] * d]
}

fn profiles(grid: &[f32], w: usize, h: usize, points: &[Vertex], width: f64) -> (f64, f64) {
    let (mut prominences, mut asymmetries) = (Vec::new(), Vec::new());
    for p in points {
        if p.tangent[0].hypot(p.tangent[1]) == 0.0 {
            continue;
        }
        let (mut crest, mut offset) = (p.crest, 0.0);
        let steps = width.ceil().max(1.0) as isize;
        for step in -steps..=steps {
            let distance = width * step as f64 / (2 * steps) as f64;
            let z = sample(grid, w, h, displaced(p.point, p.normal, distance));
            if z.is_finite() && (!crest.is_finite() || z > crest) {
                crest = z;
                offset = distance;
            }
        }
        if !crest.is_finite() {
            continue;
        }
        let snapped = displaced(p.point, p.normal, offset);
        let plus = sample(grid, w, h, displaced(snapped, p.normal, width));
        let minus = sample(grid, w, h, displaced(snapped, p.normal, -width));
        if !plus.is_finite() || !minus.is_finite() || plus >= crest || minus >= crest {
            continue;
        }
        let prominence = crest - (plus + minus) / 2.0;
        prominences.push(prominence);
        let crossing = |side: f64| {
            let steps = (width * 2.0).ceil().max(1.0) as usize;
            let (mut prev_d, mut prev_h) = (0.0, prominence);
            let target = prominence / 2.0;
            for step in 1..=steps {
                let distance = width * step as f64 / steps as f64;
                let signed = side * distance;
                let z = sample(grid, w, h, displaced(snapped, p.normal, signed));
                if !z.is_finite() {
                    return f64::NAN;
                }
                let fraction = (signed / width + 1.0) / 2.0;
                let height = z - (minus * (1.0 - fraction) + plus * fraction);
                if height <= target {
                    let interval = prev_h - height;
                    return prev_d
                        + (distance - prev_d)
                            * if interval > 0.0 { ((prev_h - target) / interval).clamp(0.0, 1.0) } else { 0.0 };
                }
                prev_h = height;
                prev_d = distance;
            }
            f64::NAN
        };
        let (left, right) = (crossing(-1.0), crossing(1.0));
        if left.is_finite() && right.is_finite() && left + right > 0.0 {
            asymmetries.push(((left - right) / (left + right)).abs());
        }
    }
    (if prominences.is_empty() { f64::NAN } else { median(&mut prominences) }, median(&mut asymmetries))
}

pub(super) struct RidgeFeatures {
    pub prominence: f64,
    pub asymmetry: f64,
    pub kettles: usize,
    pub apron: f64,
    pub crossing: f64,
}
pub(super) fn ridge(grid: &[f32], w: usize, h: usize, s: &Segment, cell: f64, context: &Context) -> RidgeFeatures {
    let points = vertices(grid, w, h, &s.path);
    let coords: Vec<Point> = points.iter().map(|v| v.point).collect();
    let tree = Tree::new(&coords, (0..coords.len()).collect(), 0).unwrap();
    let mut mask = vec![false; grid.len()];
    for &i in &s.pixels {
        mask[i] = true;
    }
    let (prominence, asymmetry) = profiles(grid, w, h, &points, s.width.max(cell) / cell);
    let footprint: Vec<Point> = s.pixels.iter().map(|&i| [(i % w) as f64, (i / w) as f64]).collect();
    let mut footprint_tree = None;
    let mut kettles = 0;
    for blob in &context.blobs {
        if mask[blob.index] {
            kettles += 1;
            continue;
        }
        let ft =
            footprint_tree.get_or_insert_with(|| Tree::new(&footprint, (0..footprint.len()).collect(), 0).unwrap());
        if ft.nearest(&footprint, blob.point).1 <= (s.width / cell).powi(2) {
            kettles += 1;
        }
    }
    let radius = (s.length.min(300.0) + s.width / 2.0) / cell;
    let x0 = (s.bbox[0] as f64 - radius).floor().max(0.0) as usize;
    let x1 = (s.bbox[2] as f64 + radius).ceil().min((w - 1) as f64) as usize;
    let y0 = (s.bbox[1] as f64 - radius).floor().max(0.0) as usize;
    let y1 = (s.bbox[3] as f64 + radius).ceil().min((h - 1) as f64) as usize;
    let (mut totals, mut flats) = ([0usize; 2], [0usize; 2]);
    for y in y0..=y1 {
        for x in x0..=x1 {
            let i = y * w + x;
            if mask[i] || !grid[i].is_finite() || !context.slope[i].is_finite() {
                continue;
            }
            let (nearest, squared) = tree.nearest(&coords, [x as f64, y as f64]);
            let p = &points[nearest];
            if squared > radius * radius || !p.crest.is_finite() {
                continue;
            }
            let (dx, dy) = (x as f64 - p.point[0], y as f64 - p.point[1]);
            let along = dx * p.tangent[0] + dy * p.tangent[1];
            let across = dx * p.normal[0] + dy * p.normal[1];
            if (nearest == 0 && along < 0.0)
                || (nearest + 1 == points.len() && along > 0.0)
                || across.abs() <= 1e-9
                || f64::from(grid[i]) > p.crest
            {
                continue;
            }
            let side = usize::from(across > 0.0);
            totals[side] += 1;
            if context.slope[i] < 3.0 {
                flats[side] += 1;
            }
        }
    }
    let fractions = [0, 1].map(|side| if totals[side] > 0 { flats[side] as f64 / totals[side] as f64 } else { 0.0 });
    let mut crossing = 0.0;
    if let Some(v) = &context.valley {
        let tangent = &points[tree.nearest(&coords, s.centroid).0].tangent;
        let transverse = (tangent[0] * v.angle.sin() - tangent[1] * v.angle.cos()).abs();
        let elevation = sample(grid, w, h, s.centroid);
        if elevation.is_finite() {
            let ridge_height = if prominence.is_finite() { prominence.max(0.0) } else { 0.0 };
            let affinity = (1.0 - (elevation - ridge_height - v.low).max(0.0) / v.range).clamp(0.0, 1.0);
            crossing = (transverse * v.anisotropy * affinity).clamp(0.0, 1.0);
        }
    }
    RidgeFeatures { prominence, asymmetry, kettles, apron: fractions[0].max(fractions[1]), crossing }
}

/// Whole-view O(n) maximum filter, carrying the lowest raster index on ties.
fn local_maxima(grid: &[f32], w: usize, h: usize, radius: usize) -> Vec<usize> {
    let mut source: Option<Vec<usize>> = None;
    for pass in 0..2 {
        let mut output = vec![usize::MAX; grid.len()];
        let (lines, length, stride) = if pass == 0 { (h, w, 1) } else { (w, h, w) };
        let mut deque = vec![0; length];
        for line in 0..lines {
            let base = if pass == 0 { line * w } else { line };
            let (mut head, mut tail, mut end) = (0, 0, 0);
            let index = |pos: usize| source.as_ref().map_or(base + pos * stride, |s| s[base + pos * stride]);
            for pos in 0..length {
                while head < tail && deque[head] + radius < pos {
                    head += 1;
                }
                let limit = (pos + radius).min(length - 1);
                while end <= limit {
                    let i = index(end);
                    if i != usize::MAX && grid[i].is_finite() {
                        while head < tail {
                            let prev = index(deque[tail - 1]);
                            if grid[prev] > grid[i] || (grid[prev] == grid[i] && prev < i) {
                                break;
                            }
                            tail -= 1;
                        }
                        deque[tail] = end;
                        tail += 1;
                    }
                    end += 1;
                }
                if head < tail {
                    output[base + pos * stride] = index(deque[head]);
                }
            }
        }
        source = Some(output);
    }
    source.unwrap()
}
pub(super) struct BeltContext {
    pub tpi: Vec<f32>,
    pub lrm: Vec<f32>,
    pub peaks: Vec<usize>,
}
impl BeltContext {
    pub fn new(grid: &[f32], w: usize, h: usize, cell: f64) -> Self {
        let radius = ((30.0f64.max(cell) / cell).ceil() as usize).clamp(1, w.max(h));
        let tpi = glacial::terrain_position(
            grid,
            w,
            h,
            cell,
            glacial::Radius::square(radius),
            glacial::Radius::square(radius / 3),
        )
        .data;
        let lrm = glacial::local_relief(grid, w, h, cell, glacial::Radius::square(radius)).data;
        let radius = ((10.0 / cell).ceil() as usize).max(2).min(w.max(h));
        let maxima = local_maxima(grid, w, h, radius);
        let mut candidates: Vec<usize> = (0..grid.len()).filter(|&i| maxima[i] == i && tpi[i] > 0.5).collect();
        candidates.sort_by(|&a, &b| grid[b].total_cmp(&grid[a]).then(a.cmp(&b)));
        let separation = 15.0 / cell;
        let mut bins: HashMap<(i64, i64), Vec<usize>> = HashMap::new();
        let mut peaks = Vec::new();
        'candidate: for i in candidates {
            let (x, y) = ((i % w) as f64, (i / w) as f64);
            let (bx, by) = ((x / separation).floor() as i64, (y / separation).floor() as i64);
            for dy in -1..=1 {
                for dx in -1..=1 {
                    if let Some(near) = bins.get(&(bx + dx, by + dy)) {
                        for &j in near {
                            let (px, py) = ((j % w) as f64, (j / w) as f64);
                            if (x - px) * (x - px) + (y - py) * (y - py) <= separation * separation {
                                continue 'candidate;
                            }
                        }
                    }
                }
            }
            peaks.push(i);
            bins.entry((bx, by)).or_default().push(i);
        }
        Self { tpi, lrm, peaks }
    }
}
