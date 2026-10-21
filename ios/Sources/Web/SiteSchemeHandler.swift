import Foundation
import UniformTypeIdentifiers
import WebKit

/// Serves the bundled web client at clearskies://app/ and hands /api requests
/// to the engine proxy.
///
/// WebKit treats a page from a custom scheme as a secure context, so ES
/// modules, workers, WebAssembly, the clipboard and geolocation behave as they
/// do on https. Requests from workers reach this handler too.
final class SiteSchemeHandler: NSObject, WKURLSchemeHandler {
    static let scheme = "clearskies"
    static let host = "app"
    static let startURL = URL(string: "\(scheme)://\(host)/index.html")!

    private let root: URL
    private let rootPath: String
    private let proxy: EngineProxy
    private let engine: EngineSettings

    init(root: URL, proxy: EngineProxy, engine: EngineSettings) {
        self.root = root.standardizedFileURL
        // A directory URL's path ends in "/"; the containment check adds its own.
        var path = self.root.path(percentEncoded: false)
        while path.count > 1, path.hasSuffix("/") { path.removeLast() }
        rootPath = path
        self.proxy = proxy
        self.engine = engine
    }

    func webView(_ webView: WKWebView, start task: any WKURLSchemeTask) {
        guard let url = task.request.url, url.host() == Self.host else {
            Self.reply(task, url: task.request.url ?? Self.startURL, status: 404, text: "Not found")
            return
        }
        let path = url.path(percentEncoded: false)
        if path == "/api" || path.hasPrefix("/api/") {
            proxy.start(task, base: engine.base)
        } else {
            serveFile(task, url: url, path: path)
        }
    }

    func webView(_ webView: WKWebView, stop task: any WKURLSchemeTask) {
        // Bundled files are answered synchronously in start, so only a
        // forwarded engine request can still be running.
        proxy.stop(task)
    }

    private func serveFile(_ task: any WKURLSchemeTask, url: URL, path: String) {
        let relative = path == "/" ? "index.html" : String(path.drop { $0 == "/" })
        let file = root.appending(path: relative, directoryHint: .notDirectory).standardizedFileURL
        // A decoded "../" is resolved by standardizedFileURL, so anything that
        // escapes the bundled site no longer starts with its path.
        guard file.path(percentEncoded: false).hasPrefix(rootPath + "/"),
              let data = try? Data(contentsOf: file, options: .mappedIfSafe) else {
            Self.reply(task, url: url, status: 404, text: "Not found")
            return
        }
        let headers = ["Content-Type": Self.mimeType(for: file),
                       "Content-Length": String(data.count),
                       "Cache-Control": "no-cache"]
        task.didReceive(HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: headers)!)
        task.didReceive(data)
        task.didFinish()
    }

    /// Module scripts and WebAssembly are rejected unless their type is exact.
    private static let types: [String: String] = [
        "html": "text/html; charset=utf-8",
        "js": "text/javascript; charset=utf-8",
        "mjs": "text/javascript; charset=utf-8",
        "cjs": "text/javascript; charset=utf-8",
        "css": "text/css; charset=utf-8",
        "json": "application/json; charset=utf-8",
        "wasm": "application/wasm",
        "svg": "image/svg+xml",
        "png": "image/png",
        "jpg": "image/jpeg",
        "jpeg": "image/jpeg",
        "gif": "image/gif",
        "webp": "image/webp",
        "ico": "image/x-icon",
        "woff2": "font/woff2",
        "woff": "font/woff",
        "ttf": "font/ttf",
        "txt": "text/plain; charset=utf-8",
        "xml": "application/xml"
    ]

    static func mimeType(for file: URL) -> String {
        let ext = file.pathExtension.lowercased()
        return types[ext] ?? UTType(filenameExtension: ext)?.preferredMIMEType ?? "application/octet-stream"
    }

    private static func reply(_ task: any WKURLSchemeTask, url: URL, status: Int, text: String) {
        let body = Data(text.utf8)
        let headers = ["Content-Type": "text/plain; charset=utf-8", "Content-Length": String(body.count)]
        task.didReceive(HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers)!)
        task.didReceive(body)
        task.didFinish()
    }
}
