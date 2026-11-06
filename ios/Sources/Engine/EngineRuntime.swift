import CSKEngine
import Foundation
import os
import UIKit

/// One process-wide engine, including background launches with no map view.
/// Its persistent job journals resume once when the runtime is created.
final class EngineRuntime {
    static let shared = EngineRuntime()
    let handle: OpaquePointer
    private static let log = Logger(subsystem: Bundle.main.bundleIdentifier ?? "ClearSkies", category: "engine")

    /// Disposable engine data lives in Caches, which iOS may clear.
    static var cacheDirectory: URL { URL.cachesDirectory.appending(path: "engine", directoryHint: .isDirectory) }
    /// What the person made (markup) lives in Application Support: kept and backed up.
    static var dataDirectory: URL {
        URL.applicationSupportDirectory.appending(path: "engine", directoryHint: .isDirectory)
    }

    private init?() {
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
        let csk = CskTransport(context: context, fetch: transportFetch, cancel: transportCancel, release: transportRelease, download_consumed: transportDownloadConsumed)
        let workAllowed = UIApplication.shared.applicationState != .background
        guard let engine = json.withCString({ csk_engine_new($0, csk, workAllowed) }) else {
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
    Unmanaged<NetworkTransport>.fromOpaque(context).takeRetainedValue().shutdown()
}

nonisolated private func transportDownloadConsumed(_ context: UnsafeMutableRawPointer?, _ url: UnsafePointer<CChar>?) {
    guard let url, let parsed = URL(string: String(cString: url)) else { return }
    BackgroundDownloads.shared.consumed(parsed)
}
