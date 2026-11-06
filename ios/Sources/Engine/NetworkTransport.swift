import CSKEngine
import Foundation

/// The engine's network: URLSession, so requests get the system's HTTP/2 and
/// HTTP/3, proxy settings, Low Data Mode and cellular policy. The engine
/// keeps its own cache, so URLSession's is off. Body size is enforced while
/// bytes arrive, not after.
nonisolated final class NetworkTransport: NSObject, URLSessionDataDelegate, @unchecked Sendable {
    private struct Fetch {
        let token: OpaquePointer
        let maxBody: UInt64
        var status = 0
        var headers = ""
        var body = Data()
    }

    private let lock = NSLock()
    /// Keyed by URLSession task identifier.
    private var fetches: [Int: Fetch] = [:]
    /// Engine fetch id to URLSession task, for cancel.
    private var tasks: [UInt64: URLSessionTask] = [:]
    private var ids: [Int: UInt64] = [:]
    private var session: URLSession!

    override init() {
        super.init()
        let configuration = URLSessionConfiguration.default
        configuration.urlCache = nil
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        // Range reads are latency-bound; the engine limits lanes per host itself.
        configuration.httpMaximumConnectionsPerHost = 16
        configuration.timeoutIntervalForResource = 300
        configuration.httpShouldSetCookies = false
        configuration.httpCookieAcceptPolicy = .never
        configuration.waitsForConnectivity = false
        let queue = OperationQueue()
        queue.name = "ClearSkies engine network"
        queue.maxConcurrentOperationCount = 1
        // The session holds its delegate strongly until invalidated; the
        // engine releases this transport only when it shuts down.
        session = URLSession(configuration: configuration, delegate: self, delegateQueue: queue)
    }

    deinit {
        session?.invalidateAndCancel()
    }

    private static let userAgent: String = {
        let info = Bundle.main.infoDictionary
        let version = info?["CFBundleShortVersionString"] as? String ?? "0"
        return "ClearSkies/\(version) (iOS; +https://rileyg44.github.io/clear-skies-portal/)"
    }()

    func fetch(token: OpaquePointer, id: UInt64, request: CskFetchRequest) {
        guard let urlText = request.url.map({ String(cString: $0) }), let url = URL(string: urlText) else {
            csk_fetch_fail(token, CSK_FETCH_NETWORK, "invalid URL")
            return
        }
        var r = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData,
                           timeoutInterval: TimeInterval(max(request.timeout_ms, 1000)) / 1000)
        r.httpMethod = request.method.map { String(cString: $0) } ?? "GET"
        r.setValue(Self.userAgent, forHTTPHeaderField: "User-Agent")
        if request.range_first >= 0, request.range_last >= request.range_first {
            r.setValue("bytes=\(request.range_first)-\(request.range_last)", forHTTPHeaderField: "Range")
        }
        let task = session.dataTask(with: r)
        lock.withLock {
            fetches[task.taskIdentifier] = Fetch(token: token, maxBody: request.max_body)
            tasks[id] = task
            ids[task.taskIdentifier] = id
        }
        task.resume()
    }

    func cancel(id: UInt64) {
        let task = lock.withLock { tasks[id] }
        task?.cancel()      // completion consumes the token
    }

    /// Removes and returns a fetch so its token is consumed exactly once.
    private func take(_ task: URLSessionTask) -> Fetch? {
        lock.withLock {
            if let id = ids.removeValue(forKey: task.taskIdentifier) { tasks.removeValue(forKey: id) }
            return fetches.removeValue(forKey: task.taskIdentifier)
        }
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
                    completionHandler: @escaping @Sendable (URLSession.ResponseDisposition) -> Void) {
        let http = response as? HTTPURLResponse
        let tooLarge = lock.withLock { () -> Bool in
            guard var f = fetches[dataTask.taskIdentifier] else { return false }
            f.status = http?.statusCode ?? 0
            f.headers = (http?.allHeaderFields ?? [:]).compactMap { key, value in
                guard let name = key as? String else { return nil }
                return "\(name): \(value)"
            }.joined(separator: "\n")
            let expected = response.expectedContentLength
            fetches[dataTask.taskIdentifier] = f
            return expected > 0 && UInt64(expected) > f.maxBody
        }
        if tooLarge, let f = take(dataTask) {
            csk_fetch_fail(f.token, CSK_FETCH_TOO_LARGE, "response too large")
            completionHandler(.cancel)
            return
        }
        completionHandler(.allow)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        let over = lock.withLock { () -> Bool in
            guard var f = fetches[dataTask.taskIdentifier] else { return false }
            f.body.append(data)
            fetches[dataTask.taskIdentifier] = f
            return UInt64(f.body.count) > f.maxBody
        }
        if over, let f = take(dataTask) {
            csk_fetch_fail(f.token, CSK_FETCH_TOO_LARGE, "response too large")
            dataTask.cancel()
        }
    }

    /// Redirects come back to the engine, which decides whether to follow
    /// (a snapshot image re-validates every hop against its allowlist).
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping @Sendable (URLRequest?) -> Void) {
        completionHandler(nil)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: (any Error)?) {
        guard let f = take(task) else { return }
        if let error = error as? URLError {
            let code: Int32 = switch error.code {
            case .timedOut: CSK_FETCH_TIMEOUT
            case .cancelled: CSK_FETCH_CANCELLED
            case .notConnectedToInternet, .networkConnectionLost, .dataNotAllowed, .internationalRoamingOff:
                CSK_FETCH_OFFLINE
            default: CSK_FETCH_NETWORK
            }
            csk_fetch_fail(f.token, code, error.localizedDescription)
            return
        }
        if let error {
            csk_fetch_fail(f.token, CSK_FETCH_NETWORK, String(describing: error))
            return
        }
        f.headers.withCString { headers in
            f.body.withUnsafeBytes { raw in
                csk_fetch_complete(f.token, UInt16(clamping: f.status), headers,
                                   raw.baseAddress?.assumingMemoryBound(to: UInt8.self), raw.count)
            }
        }
    }
}
