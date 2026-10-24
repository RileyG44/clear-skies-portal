import Foundation
import WebKit

/// Forwards the web client's same-origin /api requests to the terrain engine.
///
/// The page keeps making relative requests, exactly as it does when the Mac
/// serves it. Only this hop knows the engine's real address, so no request
/// crosses an origin and the engine needs no changes for the app.
final class EngineProxy: NSObject {
    private struct Forward {
        let schemeTask: any WKURLSchemeTask
        let pageURL: URL
        let dataTask: URLSessionDataTask
    }

    /// Keyed by URLSession task. A stopped scheme task is removed at once, and
    /// WebKit raises an exception if a stopped task receives anything more.
    private var forwards: [Int: Forward] = [:]
    private var taskIDs: [ObjectIdentifier: Int] = [:]

    /// Headers that describe the hop from WebKit, not the request itself.
    private static let requestHopHeaders: Set<String> = [
        "host", "connection", "keep-alive", "proxy-connection", "transfer-encoding",
        "upgrade", "te", "origin", "content-length", "cookie"
    ]

    /// URLSession has already decoded the body, so these no longer describe
    /// the bytes that reach the page.
    private static let staleResponseHeaders: Set<String> = [
        "content-encoding", "content-length", "transfer-encoding", "connection",
        "keep-alive", "set-cookie", "set-cookie2"
    ]

    private lazy var session: URLSession = {
        let configuration = URLSessionConfiguration.default
        // The client's own request pool allows eight engine requests at a time.
        configuration.httpMaximumConnectionsPerHost = 8
        // Raw lidar rendering can keep the engine busy for a while; the page
        // cancels its own requests when it no longer needs them.
        configuration.timeoutIntervalForRequest = 120
        configuration.timeoutIntervalForResource = 30 * 60
        configuration.httpShouldSetCookies = false
        configuration.httpCookieAcceptPolicy = .never
        // The system's shared URL cache, at its default size. A larger cache
        // for engine tiles would be a new device budget (D-07), not a default.
        return URLSession(configuration: configuration, delegate: self, delegateQueue: .main)
    }()

    func start(_ schemeTask: any WKURLSchemeTask, base: String) {
        let request = schemeTask.request
        guard let pageURL = request.url else { return }
        guard !base.isEmpty, let target = Self.target(base: base, page: pageURL) else {
            Self.reply(schemeTask, url: pageURL, status: 503,
                       json: #"{"ok":false,"error":"No terrain engine is set up in this app."}"#)
            return
        }
        var upstream = URLRequest(url: target, cachePolicy: request.cachePolicy,
                                  timeoutInterval: max(request.timeoutInterval, 120))
        upstream.httpMethod = request.httpMethod ?? "GET"
        upstream.httpBody = request.httpBody
        for (name, value) in request.allHTTPHeaderFields ?? [:]
        where !Self.requestHopHeaders.contains(name.lowercased()) {
            upstream.setValue(value, forHTTPHeaderField: name)
        }
        let dataTask = session.dataTask(with: upstream)
        forwards[dataTask.taskIdentifier] = Forward(schemeTask: schemeTask, pageURL: pageURL, dataTask: dataTask)
        taskIDs[ObjectIdentifier(schemeTask)] = dataTask.taskIdentifier
        dataTask.resume()
    }

    func stop(_ schemeTask: any WKURLSchemeTask) {
        guard let id = taskIDs.removeValue(forKey: ObjectIdentifier(schemeTask)),
              let forward = forwards.removeValue(forKey: id) else { return }
        forward.dataTask.cancel()
    }

    /// The engine address plus the page's path and query, untouched.
    static func target(base: String, page: URL) -> URL? {
        guard var parts = URLComponents(string: base) else { return nil }
        parts.percentEncodedPath += page.path(percentEncoded: true)
        parts.percentEncodedQuery = page.query(percentEncoded: true)
        parts.fragment = nil
        return parts.url
    }

    private static func reply(_ task: any WKURLSchemeTask, url: URL, status: Int, json: String) {
        let body = Data(json.utf8)
        let headers = ["Content-Type": "application/json; charset=utf-8",
                       "Content-Length": String(body.count),
                       "Cache-Control": "no-store"]
        task.didReceive(HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers)!)
        task.didReceive(body)
        task.didFinish()
    }
}

extension EngineProxy: URLSessionDataDelegate {
    nonisolated func urlSession(_ session: URLSession, dataTask: URLSessionDataTask,
                                didReceive response: URLResponse,
                                completionHandler: @escaping @Sendable (URLSession.ResponseDisposition) -> Void) {
        MainActor.assumeIsolated {
            guard let forward = forwards[dataTask.taskIdentifier] else {
                completionHandler(.cancel)
                return
            }
            let upstream = response as? HTTPURLResponse
            var headers: [String: String] = [:]
            for (key, value) in upstream?.allHeaderFields ?? [:] {
                guard let name = key as? String,
                      !Self.staleResponseHeaders.contains(name.lowercased()) else { continue }
                headers[name] = (value as? String) ?? "\(value)"
            }
            let forwarded = HTTPURLResponse(url: forward.pageURL, statusCode: upstream?.statusCode ?? 200,
                                            httpVersion: "HTTP/1.1", headerFields: headers)!
            forward.schemeTask.didReceive(forwarded)
            completionHandler(.allow)
        }
    }

    nonisolated func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        MainActor.assumeIsolated {
            forwards[dataTask.taskIdentifier]?.schemeTask.didReceive(data)
        }
    }

    nonisolated func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: (any Error)?) {
        MainActor.assumeIsolated {
            guard let forward = forwards.removeValue(forKey: task.taskIdentifier) else { return }
            taskIDs.removeValue(forKey: ObjectIdentifier(forward.schemeTask))
            if let error {
                forward.schemeTask.didFailWithError(error)
            } else {
                forward.schemeTask.didFinish()
            }
        }
    }
}
