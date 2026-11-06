//! `csk-cli <cache-dir> <route>...`: answers routes with the real engine
//! over the real network (ureq), printing status and headers and writing
//! each body to `<cache-dir>/out/`. For development and differential checks
//! against the Node engine; the app uses URLSession instead.

use std::sync::Arc;
use std::time::Instant;

use csk_engine::transport::{FetchError, FetchFuture, FetchRequest, FetchResponse, Method, Transport};
use csk_engine::{Config, Engine, Request};

struct Ureq(ureq::Agent);

impl Transport for Ureq {
    fn fetch(&self, req: FetchRequest) -> FetchFuture {
        let agent = self.0.clone();
        Box::pin(async move {
            tokio::task::spawn_blocking(move || {
                let mut b = match req.method {
                    Method::Get => agent.get(&req.url),
                    Method::Head => agent.head(&req.url),
                }
                .config()
                .timeout_global(Some(req.timeout))
                .http_status_as_error(false)
                .max_redirects(0)
                .build();
                b = b.header("User-Agent", "ClearSkies/native-dev");
                if let Some((a, z)) = req.range {
                    b = b.header("Range", format!("bytes={a}-{z}"));
                }
                let mut r = b.call().map_err(|e| match e {
                    ureq::Error::Timeout(_) => FetchError::Timeout,
                    e => FetchError::Network(e.to_string()),
                })?;
                let status = r.status().as_u16();
                let headers = r
                    .headers()
                    .iter()
                    .map(|(k, v)| (k.as_str().to_ascii_lowercase(), v.to_str().unwrap_or("").to_owned()))
                    .collect();
                let body = r
                    .body_mut()
                    .with_config()
                    .limit(req.max_body as u64)
                    .read_to_vec()
                    .map_err(|_| FetchError::TooLarge)?;
                Ok(FetchResponse { status, headers, body })
            })
            .await
            .map_err(|_| FetchError::Cancelled)?
        })
    }
}

#[tokio::main]
async fn main() {
    let mut args = std::env::args().skip(1);
    let Some(dir) = args.next() else {
        eprintln!("usage: csk-cli <cache-dir> <route>...");
        std::process::exit(2);
    };
    let scope = std::env::var("CSK_USGS_SCOPE").ok().map(|s| s.split(',').map(str::to_owned).collect());
    let config = Config { cache_dir: dir.clone().into(), cache_budget: 4 << 30, usgs_scope: scope };
    let engine = Engine::new(config, Arc::new(Ureq(ureq::Agent::new_with_defaults()))).expect("engine");
    let out = std::path::Path::new(&dir).join("out");
    std::fs::create_dir_all(&out).expect("out dir");
    for route in args {
        let t = Instant::now();
        let res = engine.handle(Request::new("GET", &route, Vec::new()).expect("route")).await;
        println!("{route} -> {} in {:.0} ms, {} bytes", res.status, t.elapsed().as_secs_f64() * 1e3, res.body.len());
        for (k, v) in &res.headers {
            let v = if v.len() > 160 { format!("{}…", &v[..160]) } else { v.clone() };
            println!("  {k}: {v}");
        }
        let name: String = route.chars().map(|c| if c.is_ascii_alphanumeric() || c == '.' { c } else { '_' }).collect();
        std::fs::write(out.join(name), &res.body).expect("write body");
    }
}
