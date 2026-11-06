//! `tiffinfo <file>`: levels, layout and GeoKeys of a TIFF, for inspecting sources.

fn main() {
    let path = std::env::args().nth(1).expect("file");
    let bytes = std::fs::read(&path).expect("read");
    let t = csk_core::codec::parse(bytes.as_slice()).expect("parse");
    println!("le={} big={} complete={}", t.little_endian, t.big, t.complete);
    for (i, l) in t.levels.iter().enumerate() {
        println!(
            "level {i}: {}x{} block {}x{} stripped={} comp={} pred={} bps={} sf={} spp={} blocks={} max_block_bytes={}",
            l.width,
            l.height,
            l.block_width,
            l.block_height,
            l.stripped,
            l.compression,
            l.predictor,
            l.bits_per_sample,
            l.sample_format,
            l.samples_per_pixel,
            l.offsets.len(),
            l.counts.iter().max().unwrap_or(&0)
        );
    }
    let g = &t.geo;
    println!(
        "scale={:?} tie={:?} epsg={:?} nodata={:?} transform={:?}",
        g.pixel_scale, g.tiepoint, g.epsg, g.nodata, g.transformation
    );
    for (k, v) in &g.keys {
        let v = format!("{v:?}");
        println!("  key {k}: {}", &v[..v.len().min(160)]);
    }
    match csk_core::geo::proj::Projection::from_geokeys(g) {
        Ok(p) => {
            let l = &t.levels[0];
            let (x0, y0) = (g.tiepoint[3], g.tiepoint[4]);
            let (x1, y1) = (x0 + f64::from(l.width) * g.pixel_scale[0], y0 - f64::from(l.height) * g.pixel_scale[1]);
            println!("projection {p:?}");
            println!("NW corner {:?}, SE corner {:?}", p.inverse(x0, y0), p.inverse(x1, y1));
            // The value at a given lon/lat (optional 2nd/3rd arguments).
            let args: Vec<f64> = std::env::args().skip(2).filter_map(|a| a.parse().ok()).collect();
            if let [lon, lat] = args[..] {
                let (x, y) = p.forward(lon, lat);
                let (px, py) = (((x - x0) / g.pixel_scale[0]) as u32, ((y0 - y) / g.pixel_scale[1]) as u32);
                let idx = (py / l.block_height) * l.blocks_across() + px / l.block_width;
                let (o, n) = (l.offsets[idx as usize] as usize, l.counts[idx as usize] as usize);
                let b = csk_core::codec::decode_block(&bytes[o..o + n], l, t.little_endian).expect("decode");
                let v = b[((py % l.block_height) * l.block_width + px % l.block_width) as usize];
                println!("value at {lon},{lat} (pixel {px},{py}): {v}");
            }
        }
        Err(e) => println!("projection: {e}"),
    }
}
