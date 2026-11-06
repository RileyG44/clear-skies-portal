import CSKEngine
import Foundation
import WebKit

/// WebKit adapter. The app runtime owns the engine independently of a map.
final class LocalEngine {
    private let runtime: EngineRuntime
    private var handle: OpaquePointer { runtime.handle }
    private var running: [ObjectIdentifier: EngineRequest] = [:]
    static let announced = true

    init?() {
        guard let runtime = EngineRuntime.shared else { return nil }
        self.runtime = runtime
    }

    func start(_ task: any WKURLSchemeTask) {
        let request = task.request
        guard let url = request.url else { return }
        let pending = EngineRequest(task: task, url: url, owner: self)
        running[ObjectIdentifier(task)] = pending
        let context = Unmanaged.passRetained(pending).toOpaque()
        let body = request.httpBody ?? Data()
        let headers = (request.allHTTPHeaderFields ?? [:])
            .filter { !$0.key.contains("\n") && !$0.value.contains("\n") }
            .map { "\($0.key): \($0.value)" }.joined(separator: "\n")
        let id = url.absoluteString.withCString { target in
            (request.httpMethod ?? "GET").withCString { method in
                headers.withCString { headerLines in
                    body.withUnsafeBytes { raw in
                        csk_engine_request(handle, method, target, headerLines,
                                           raw.baseAddress?.assumingMemoryBound(to: UInt8.self), raw.count,
                                           context, engineRespond)
                    }
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

    fileprivate func finished(_ pending: EngineRequest, status: Int? = nil) {
        if running[ObjectIdentifier(pending.task)] === pending {
            running.removeValue(forKey: ObjectIdentifier(pending.task))
        }
        if status == 200, pending.task.request.httpMethod == "POST",
           ["/api/usgs/warm", "/api/wadnr/warm"].contains(pending.url.path) {
            EngineBackground.shared.userStartedJob()
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
        owner?.finished(self, status: status)
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
