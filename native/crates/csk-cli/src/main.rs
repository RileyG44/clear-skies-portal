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
                let map_err = |e: ureq::Error| match e {
                    ureq::Error::Timeout(_) => FetchError::Timeout,
                    e => FetchError::Network(e.to_string()),
                };
                let mut headers: Vec<(String, String)> = vec![("User-Agent".into(), "ClearSkies/native-dev".into())];
                if let Some((a, z)) = req.range {
                    headers.push(("Range".into(), format!("bytes={a}-{z}")));
                }
                headers.extend(req.headers.iter().cloned());
                let mut r = match req.method {
                    Method::Post => {
                        let mut b = agent
                            .post(&req.url)
                            .config()
                            .timeout_global(Some(req.timeout))
                            .http_status_as_error(false)
                            .max_redirects(0)
                            .build();
                        for (k, v) in &headers {
                            b = b.header(k, v);
                        }
                        b.send(&req.body[..]).map_err(map_err)?
                    }
                    m => {
                        let base = if m == Method::Head { agent.head(&req.url) } else { agent.get(&req.url) };
                        let mut b = base
                            .config()
                            .timeout_global(Some(req.timeout))
                            .http_status_as_error(false)
                            .max_redirects(0)
                            .build();
                        for (k, v) in &headers {
                            b = b.header(k, v);
                        }
                        b.call().map_err(map_err)?
                    }
                };
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
    let config = Config { cache_dir: dir.clone().into(), data_dir: None, cache_budget: 4 << 30, usgs_scope: scope };
    let engine = Engine::new(config, Arc::new(Ureq(ureq::Agent::new_with_defaults()))).expect("engine");
    let out = std::path::Path::new(&dir).join("out");
    std::fs::create_dir_all(&out).expect("out dir");
    for route in args {
        // "EXPORT-CATALOG <file>" lists the archive and writes the bundled snapshot.
        if let Some(file) = route.strip_prefix("EXPORT-CATALOG ") {
            let catalog = &engine.tiles.usgs.catalog;
            let meta = catalog.build().await.expect("catalogue build");
            assert!(catalog.complete(), "catalogue incomplete: {meta:?}");
            let bytes = catalog.snapshot().expect("snapshot");
            std::fs::write(file, &bytes).expect("write snapshot");
            println!("{} projects, {} bytes -> {file}", meta.projects, bytes.len());
            continue;
        }
        // "POST /path {json}" posts; "WAIT /path" polls a status route until it stops running.
        if let Some(path) = route.strip_prefix("WAIT ") {
            loop {
                let r = engine.handle(Request::new("GET", path, Vec::new()).expect("route")).await;
                let text = String::from_utf8_lossy(&r.body).into_owned();
                println!("{path} -> {text}");
                if !text.contains("\"running\":true") {
                    break;
                }
                tokio::time::sleep(std::time::Duration::from_millis(1500)).await;
            }
            continue;
        }
        let (method, target, body) = match route.strip_prefix("POST ") {
            Some(rest) => {
                let (p, b) = rest.split_once(' ').unwrap_or((rest, ""));
                ("POST", p.to_owned(), b.as_bytes().to_vec())
            }
            None => ("GET", route.clone(), Vec::new()),
        };
        let t = Instant::now();
        let res = engine.handle(Request::new(method, &target, body).expect("route")).await;
        println!("{route} -> {} in {:.0} ms, {} bytes", res.status, t.elapsed().as_secs_f64() * 1e3, res.body.len());
        for (k, v) in &res.headers {
            let v = if v.len() > 160 { format!("{}…", &v[..160]) } else { v.clone() };
            println!("  {k}: {v}");
        }
        let name: String = route.chars().map(|c| if c.is_ascii_alphanumeric() || c == '.' { c } else { '_' }).collect();
        std::fs::write(out.join(name), &res.body).expect("write body");
    }
}
