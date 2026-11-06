import CSKEngine
import Foundation
import WebKit
import os

/// The engine built into the app (native/crates/csk-engine), answering the
/// web client's same-origin /api requests in process: no server, no network
/// hop to a desktop. Response bodies come straight from the engine's memory
/// into WebKit without a copy.
final class LocalEngine {
    private let handle: OpaquePointer
    private var running: [ObjectIdentifier: EngineRequest] = [:]
    private static let log = Logger(subsystem: Bundle.main.bundleIdentifier ?? "ClearSkies", category: "engine")

    /// Whether the page is told this engine is built in. It answers USGS
    /// elevation today; until it answers every route the page uses with an
    /// engine connected (docs/native/ROUTES.md), the page keeps its public
    /// sources rather than meeting 501s. Flipped at route parity (phase 6a).
    static let announced = false

    /// Disposable engine data lives in Caches, which iOS may clear.
    static var cacheDirectory: URL { URL.cachesDirectory.appending(path: "engine", directoryHint: .isDirectory) }
    /// What the person made (markup) lives in Application Support: kept and backed up.
    static var dataDirectory: URL {
        URL.applicationSupportDirectory.appending(path: "engine", directoryHint: .isDirectory)
    }

    init?() {
        let config: [String: Any] = [
            "cacheDir": Self.cacheDirectory.path(percentEncoded: false),
            "dataDir": Self.dataDirectory.path(percentEncoded: false),
            "cacheBudget": 4 << 30,
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: config),
              let json = String(data: data, encoding: .utf8) else { return nil }
        Self.excludeOfflineFromBackup()
        let transport = NetworkTransport()
        let context = Unmanaged.passRetained(transport).toOpaque()
        let csk = CskTransport(context: context, fetch: transportFetch, cancel: transportCancel, release: transportRelease)
        guard let engine = json.withCString({ csk_engine_new($0, csk) }) else {
            Self.log.error("the built-in engine did not start")
            return nil
        }
        handle = engine
        Self.log.notice("built-in engine \(String(cString: csk_version()), privacy: .public) started")
    }

    /// Offline areas live under dataDirectory/offline: kept (iOS does not
    /// purge Application Support) but not backed up, since they can be
    /// downloaded again.
    private static func excludeOfflineFromBackup() {
        var offline = dataDirectory.appending(path: "offline", directoryHint: .isDirectory)
        try? FileManager.default.createDirectory(at: offline, withIntermediateDirectories: true)
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try? offline.setResourceValues(values)
    }

    isolated deinit {
        csk_engine_free(handle)
    }

    func start(_ task: any WKURLSchemeTask) {
        let request = task.request
        guard let url = request.url else { return }
        let pending = EngineRequest(task: task, url: url, owner: self)
        running[ObjectIdentifier(task)] = pending
        let context = Unmanaged.passRetained(pending).toOpaque()
        let body = request.httpBody ?? Data()
        let id = url.absoluteString.withCString { target in
            (request.httpMethod ?? "GET").withCString { method in
                body.withUnsafeBytes { raw in
                    csk_engine_request(handle, method, target,
                                       raw.baseAddress?.assumingMemoryBound(to: UInt8.self), raw.count,
                                       context, engineRespond)
                }
            }
        }
        pending.id = id
    }

    func stop(_ task: any WKURLSchemeTask) {
        guard let pending = running.removeValue(forKey: ObjectIdentifier(task)) else { return }
        pending.stopped = true
        csk_engine_cancel(handle, pending.id)
    }

    fileprivate func finished(_ pending: EngineRequest) {
        if running[ObjectIdentifier(pending.task)] === pending {
            running.removeValue(forKey: ObjectIdentifier(pending.task))
        }
    }
}

/// One request in flight. Main-actor state; the engine's callback hops here.
final class EngineRequest {
    let task: any WKURLSchemeTask
    let url: URL
    weak var owner: LocalEngine?
    var id: UInt64 = 0
    /// WebKit stopped the task: it must receive nothing more.
    var stopped = false

    init(task: any WKURLSchemeTask, url: URL, owner: LocalEngine) {
        self.task = task
        self.url = url
        self.owner = owner
    }

    func deliver(status: Int, headers: String, body: Data) {
        owner?.finished(self)
        guard !stopped else { return }
        var fields: [String: String] = [:]
        for line in headers.split(separator: "\n") {
            guard let colon = line.firstIndex(of: ":") else { continue }
            let name = line[..<colon].trimmingCharacters(in: .whitespaces)
            let value = line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces)
            fields[name] = value
        }
        fields["Content-Length"] = String(body.count)
        guard let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: fields) else {
            task.didFailWithError(URLError(.badServerResponse))
            return
        }
        task.didReceive(response)
        if !body.isEmpty { task.didReceive(body) }
        task.didFinish()
    }

    func cancelled() {
        owner?.finished(self)
        guard !stopped else { return }
        task.didFailWithError(URLError(.cancelled))
    }
}

/// Called by the engine on one of its threads, exactly once per request.
nonisolated private func engineRespond(_ context: UnsafeMutableRawPointer?, _ response: UnsafePointer<CskResponse>?,
                                       _ owner: OpaquePointer?) {
    guard let context else { return }
    let pending = Unmanaged<EngineRequest>.fromOpaque(context).takeRetainedValue()
    guard let r = response?.pointee else {
        Task { @MainActor in pending.cancelled() }
        return
    }
    let status = Int(r.status)
    let headers = r.headers.map { String(cString: $0) } ?? ""
    let body: Data
    if r.body_len > 0, let bytes = r.body {
        // WebKit reads the engine's buffer directly; it is freed with the Data.
        body = Data(bytesNoCopy: UnsafeMutableRawPointer(mutating: bytes), count: r.body_len,
                    deallocator: .custom { _, _ in csk_body_free(owner) })
    } else {
        csk_body_free(owner)
        body = Data()
    }
    Task { @MainActor in pending.deliver(status: status, headers: headers, body: body) }
}

nonisolated private func transportFetch(_ context: UnsafeMutableRawPointer?, _ token: OpaquePointer?, _ id: UInt64,
                                        _ request: UnsafePointer<CskFetchRequest>?) {
    guard let context, let token, let request else { return }
    Unmanaged<NetworkTransport>.fromOpaque(context).takeUnretainedValue().fetch(token: token, id: id, request: request.pointee)
}

nonisolated private func transportCancel(_ context: UnsafeMutableRawPointer?, _ id: UInt64) {
    guard let context else { return }
    Unmanaged<NetworkTransport>.fromOpaque(context).takeUnretainedValue().cancel(id: id)
}

nonisolated private func transportRelease(_ context: UnsafeMutableRawPointer?) {
    guard let context else { return }
    Unmanaged<NetworkTransport>.fromOpaque(context).release()
}
