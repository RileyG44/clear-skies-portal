//! `frame <grid.f32> <width> <height> <resolution> <scale> <product>...`:
//! writes `<product>.cspa` frames beside the grid, for differential checks
//! against `research-analysis.js`.

use csk_science::contract::{self, Raw, Request};

fn main() {
    let a: Vec<String> = std::env::args().skip(1).collect();
    let bytes = std::fs::read(&a[0]).expect("grid");
    let grid: Vec<f32> = bytes.chunks_exact(4).map(|c| f32::from_le_bytes(c.try_into().unwrap())).collect();
    let (w, h, res): (f64, f64, f64) = (a[1].parse().unwrap(), a[2].parse().unwrap(), a[3].parse().unwrap());
    let dir = std::path::Path::new(&a[0]).parent().unwrap();
    for p in &a[5..] {
        let raw = Raw {
            product: p,
            scale: &a[4],
            width: w,
            height: h,
            resolution: res,
            day: Some(172.0),
            lat: Some(47.4),
            wind: Some(250.0),
        };
        let req = Request::new(&raw).expect("request");
        let t = std::time::Instant::now();
        match contract::run(&req, &grid) {
            Ok((product, label, notice)) => {
                let frame = contract::encode(&product, req.width, req.height, label, notice.as_ref());
                std::fs::write(dir.join(format!("{p}.cspa")), frame).unwrap();
                println!("{p}: {:.0} ms", t.elapsed().as_secs_f64() * 1e3);
            }
            Err(e) => println!("{p}: {e:?}"),
        }
    }
}
