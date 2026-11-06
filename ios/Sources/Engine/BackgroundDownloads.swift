import Foundation

/// System-owned public archive transfers. The serial queue owns journal,
/// tasks and subscribers; no Rust pointer is ever persisted in a task.
nonisolated final class BackgroundDownloads: NSObject, URLSessionDownloadDelegate, @unchecked Sendable {
    static let identifier = (Bundle.main.bundleIdentifier ?? "dev.riley.ClearSkies") + ".terrain-downloads.v1"
    static let shared = BackgroundDownloads()

    struct Reply: Sendable { let status: Int; let headers: String }
    enum Failure: Error, Sendable { case cancelled, tooLarge, notFound, network(String) }
    typealias Completion = @Sendable (Result<Reply, Failure>) -> Void
    private struct Subscriber {
        let key: String
        let request: URLRequest
        let destination: URL
        let maxBytes: UInt64
        let restoreOnly: Bool
        let complete: Completion
    }

    private let queue = DispatchQueue(label: "ClearSkies archive transfers", qos: .utility)
    private var journal: TransferJournal?
    private var journalError: String?
    private var subscribers: [UUID: Subscriber] = [:]
    private var tasks: [String: URLSessionDownloadTask] = [:]
    private var pendingConsumption: Set<String> = []
    private var initialized = false
    private var session: URLSession!

    private override init() {
        super.init()
        do {
            journal = try TransferJournal(directory: URL.applicationSupportDirectory
                .appending(path: "engine/offline/transfers", directoryHint: .isDirectory))
        } catch { journalError = error.localizedDescription }
        let config = URLSessionConfiguration.background(withIdentifier: Self.identifier)
        config.sessionSendsLaunchEvents = true
        config.isDiscretionary = false
        config.allowsCellularAccess = false
        config.allowsExpensiveNetworkAccess = false
        config.allowsConstrainedNetworkAccess = false
        config.waitsForConnectivity = true
        config.httpShouldSetCookies = false
        config.httpCookieAcceptPolicy = .never
        config.timeoutIntervalForResource = 7 * 24 * 3600
        let delegates = OperationQueue()
        delegates.name = "ClearSkies background network events"
        delegates.maxConcurrentOperationCount = 1
        session = URLSession(configuration: config, delegate: self, delegateQueue: delegates)
        session.getAllTasks { [self] restored in
            queue.async { [self] in
                for task in restored {
                    guard let task = task as? URLSessionDownloadTask, let key = task.taskDescription,
                          TransferJournal.validKey(key), (try? journal?.read(key)) != nil,
                          tasks[key] == nil else { task.taskDescription = nil; task.cancel(); continue }
                    tasks[key] = task
                }
                journal?.reconcile(active: Set(tasks.keys))
                initialized = true
                for key in Set(subscribers.values.map(\.key)) { startOrDeliver(key) }
            }
        }
    }

    func fetch(id: UUID, request: URLRequest, destination: URL, maxBytes: UInt64, restoreOnly: Bool, complete: @escaping Completion) {
        queue.async { [self] in
            // Background URLSession follows redirects itself. Only public
            // archive GETs use it; authenticated and allowlist-sensitive
            // proxy requests stay in the foreground transport.
            guard let url = request.url, url.scheme == "https", url.host == "lidarportal.dnr.wa.gov",
                  request.httpMethod == "GET", request.httpBody == nil,
                  request.value(forHTTPHeaderField: "Range") == nil else {
                complete(.failure(.network("Unsupported background archive request"))); return
            }
            let key = TransferJournal.key(for: url)
            subscribers[id] = Subscriber(key: key, request: request, destination: destination,
                                         maxBytes: maxBytes, restoreOnly: restoreOnly, complete: complete)
            if initialized { startOrDeliver(key) }
        }
    }

    /// Detaching a Rust waiter does not cancel a system-owned transfer.
    /// A relaunched engine can attach to the same task or completed file.
    func detach(_ id: UUID) {
        queue.async { [self] in
            subscribers.removeValue(forKey: id)?.complete(.failure(.cancelled))
        }
    }

    /// The engine has committed or rejected the archive. Its staging link
    /// and the journal's link have distinct owners, so either can go first.
    func consumed(_ url: URL) {
        queue.async { [self] in
            let key = TransferJournal.key(for: url)
            guard tasks[key] == nil else { pendingConsumption.insert(key); return }
            journal?.remove(key)
        }
    }

    private func startOrDeliver(_ key: String) {
        guard let journal else { finish(key, failure: .network(journalError ?? "Transfer journal unavailable")); return }
        if let record = try? journal.read(key), record.state == .ready {
            for (id, s) in subscribers.filter({ $0.value.key == key }) {
                do {
                    let ready = try journal.deliver(key, to: s.destination, maxBytes: s.maxBytes)
                    subscribers.removeValue(forKey: id)
                    s.complete(.success(Reply(status: ready.status ?? 0, headers: ready.headers ?? "")))
                } catch {
                    subscribers.removeValue(forKey: id)
                    s.complete(.failure(error as? TransferJournal.Failure == .tooLarge ? .tooLarge : .network(error.localizedDescription)))
                    if let failure = error as? TransferJournal.Failure, failure != .tooLarge { journal.remove(key) }
                }
            }
            return
        }
        guard tasks[key] == nil else { return }
        for (id, s) in subscribers.filter({ $0.value.key == key && $0.value.restoreOnly }) {
            subscribers.removeValue(forKey: id)
            s.complete(.failure(.notFound))
        }
        guard let s = subscribers.values.first(where: { $0.key == key }),
              let url = s.request.url else { return }
        do { _ = try journal.prepare(url: url, maxBytes: s.maxBytes) }
        catch { finish(key, failure: .network(error.localizedDescription)); return }
        let task = session.downloadTask(with: s.request)
        task.taskDescription = key
        tasks[key] = task
        task.resume()
    }

    private func finish(_ key: String, failure: Failure) {
        for (id, s) in subscribers.filter({ $0.value.key == key }) {
            subscribers.removeValue(forKey: id)
            s.complete(.failure(failure))
        }
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData bytesWritten: Int64,
                    totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) {
        guard let key = downloadTask.taskDescription else { downloadTask.cancel(); return }
        queue.async { [self] in
            guard let record = try? journal?.read(key) else { downloadTask.cancel(); return }
            if UInt64(max(0, max(totalBytesWritten, totalBytesExpectedToWrite))) > record.maxBytes {
                finish(key, failure: .tooLarge)
                downloadTask.cancel()
                journal?.remove(key)
            }
        }
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
        // URLSession deletes location as soon as this method returns.
        queue.sync { [self] in
            guard let key = downloadTask.taskDescription, let journal else { return }
            guard let response = downloadTask.response as? HTTPURLResponse,
                  let original = downloadTask.originalRequest?.url,
                  response.url?.scheme == "https", response.url?.host == original.host else {
                finish(key, failure: .network("Archive redirected outside its source host"))
                journal.remove(key); return
            }
            let headers = response.allHeaderFields.compactMap { k, v -> String? in
                guard let name = k as? String else { return nil }
                return "\(name): \(v)"
            }.joined(separator: "\n")
            do {
                try journal.finish(key, temporary: location, status: response.statusCode, headers: headers)
                startOrDeliver(key)
            } catch {
                finish(key, failure: error as? TransferJournal.Failure == .tooLarge ? .tooLarge : .network(error.localizedDescription))
                journal.remove(key)
            }
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: (any Error)?) {
        guard let key = task.taskDescription else { return }
        let message = error?.localizedDescription
        queue.async { [self] in
            tasks.removeValue(forKey: key)
            if pendingConsumption.remove(key) != nil { journal?.remove(key); return }
            if let message {
                finish(key, failure: .network(message))
                journal?.remove(key)
            } else if (try? journal?.read(key).state) != .ready {
                finish(key, failure: .network("Archive finished without a committed download"))
                journal?.remove(key)
            }
        }
    }

    func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
        queue.async {
            #if os(iOS)
            Task { @MainActor in EngineAppDelegate.finishedEvents(Self.identifier) }
            #endif
        }
    }
}
