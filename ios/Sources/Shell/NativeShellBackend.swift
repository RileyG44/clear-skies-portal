import CSKEngine
import os
import UIKit

/// The native app state behind the shell (native/crates/csk-app): it
/// publishes the shell's content and answers its commands and queries,
/// with no page involved. Platform actions (Locate, the share sheet, the
/// canvas colour) are handled here.
@MainActor
final class NativeShellBackend: ShellBackend {
    let handle: OpaquePointer
    var debugSheetVisible = false
    /// The map view, once it exists: its window and canvas.
    weak var mapView: NativeMapView?
    private let location = LocationService()
    private static let log = Logger(subsystem: Bundle.main.bundleIdentifier ?? "ClearSkies", category: "shell")

    init?(shell: ShellModel) {
        guard let engine = EngineRuntime.shared?.handle else { return nil }
        let sink = NativeShellSink()
        sink.shell = shell
        let context = Unmanaged.passRetained(sink).toOpaque()
        let csk = CskShellSink(context: context, update: shellUpdate, release: shellRelease)
        guard let app = csk_app_new(engine, csk) else { return nil }
        handle = app
    }

    isolated deinit {
        csk_app_free(handle)
    }

    func start() {
        csk_app_start(handle)
    }

    private static func json(_ arguments: [String: Any]) -> String {
        guard JSONSerialization.isValidJSONObject(arguments),
              let data = try? JSONSerialization.data(withJSONObject: arguments) else { return "{}" }
        return String(decoding: data, as: UTF8.self)
    }

    func send(_ command: String, _ arguments: [String: Any]) {
        switch command {
        case "locate":
            locate()
        default:
            csk_app_send(handle, command, Self.json(arguments))
        }
    }

    func ask(_ query: String, _ arguments: [String: Any]) async throws -> Any? {
        guard let answer = csk_app_ask(handle, query, Self.json(arguments)) else { return nil }
        defer { csk_string_free(answer) }
        return try JSONSerialization.jsonObject(with: Data(String(cString: answer).utf8), options: .fragmentsAllowed)
    }

    func useMapCanvas(_ theme: String?) {
        mapView?.backgroundColor = MapCanvasColor.uiColor(theme: theme, style: mapView?.traitCollection.userInterfaceStyle ?? .unspecified)
    }

    func shareLocation(_ url: URL) throws {
        guard let root = window?.rootViewController else {
            throw NSError(domain: "ClearSkiesShare", code: 3,
                userInfo: [NSLocalizedDescriptionKey: "The share sheet is not available yet. Try again."])
        }
        let presenter = root.presentedViewController ?? root
        let sheet = UIActivityViewController(activityItems: [url], applicationActivities: nil)
        sheet.popoverPresentationController?.sourceView = presenter.view
        presenter.present(sheet, animated: true)
    }

    var window: UIWindow? {
        mapView?.window ?? UIApplication.shared.connectedScenes.compactMap { ($0 as? UIWindowScene)?.keyWindow }.first
    }

    /// Moves the map to where the person is.
    private func locate() {
        Task {
            do {
                let place = try await location.current(highAccuracy: true, timeout: 10, maximumAge: 30)
                mapView?.ease(lon: place.coordinate.longitude, lat: place.coordinate.latitude, zoom: 15)
            } catch {
                Self.log.error("locate failed: \(error.localizedDescription, privacy: .public)")
            }
        }
    }
}

/// Delivers the app state's updates to the shell, in order, on main.
nonisolated final class NativeShellSink: @unchecked Sendable {
    @MainActor weak var shell: ShellModel?

    @MainActor func apply(_ json: String) {
        shell?.apply(json: json)
    }
}

nonisolated private func shellUpdate(_ context: UnsafeMutableRawPointer?, _ json: UnsafePointer<CChar>?) {
    guard let context, let json else { return }
    let text = String(cString: json)
    let sink = Unmanaged<NativeShellSink>.fromOpaque(context).takeUnretainedValue()
    // The main queue is FIFO: updates apply in the order they were published.
    DispatchQueue.main.async {
        MainActor.assumeIsolated { sink.apply(text) }
    }
}

nonisolated private func shellRelease(_ context: UnsafeMutableRawPointer?) {
    guard let context else { return }
    Unmanaged<NativeShellSink>.fromOpaque(context).release()
}
