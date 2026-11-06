import SwiftUI
import UIKit

@main
struct ClearSkiesApp: App {
    @UIApplicationDelegateAdaptor(EngineAppDelegate.self) private var appDelegate
    @Environment(\.scenePhase) private var phase
    @State private var portal: PortalModel?

    init() {
        // Launch is white in every theme: the system's LaunchBackground, this
        // window, the native cover and then the page's start-up screen with
        // the maple on it. The saved theme still sets the window's appearance.
        let theme = MapCanvasColor.theme()
        UIWindow.appearance().backgroundColor = .white
        switch theme {
        case "dark": UIWindow.appearance().overrideUserInterfaceStyle = .dark
        case "light": UIWindow.appearance().overrideUserInterfaceStyle = .light
        default: break
        }
    }

    var body: some Scene {
        WindowGroup {
            Group {
                if let portal { RootView(portal: portal) }
                else { Color.white.ignoresSafeArea() }
            }
            .onChange(of: phase, initial: true) { _, next in
                if next == .active && portal == nil { portal = PortalModel.launch() }
            }
            .onOpenURL { url in
                guard url.isFileURL, url.pathExtension.lowercased() == "clearskies" else { return }
                if portal == nil { portal = PortalModel.launch() }
                portal?.native?.open(document: url)
            }
        }
    }
}

/// App-wide state: the map backend, its start-up, and the shell it feeds.
@MainActor @Observable
final class PortalModel {
    static func launch() -> PortalModel {
        #if NATIVE_ONLY
        PortalModel()
        #else
        PortalModel(native: NativeMapPreference.enabled)
        #endif
    }

    var ready = false
    /// The page's start-up screen is up: the native cover gives way to it.
    var splashUp = false
    var startupFailure: String?
    /// True while the page reloads after iOS ended its process.
    var restoring = false

    #if !NATIVE_ONLY
    /// The web canvas and its page, in builds that still carry it.
    @ObservationIgnored let host: WebHost?
    #endif
    /// The native map and app state.
    @ObservationIgnored private(set) var native: NativeShellBackend?
    @ObservationIgnored let shell: ShellModel

    /// Space under the home indicator, from the map's window.
    var homeInset: CGFloat { shell.backend?.window?.safeAreaInsets.bottom ?? 0 }

    #if NATIVE_ONLY
    init() {
        shell = ShellModel()
        startNative()
    }

    func retry() { startNative() }

    private func startNative() {
        guard let backend = NativeShellBackend(shell: shell) else {
            startupFailure = "The map couldn\u{2019}t start on this iPhone."
            return
        }
        startupFailure = nil
        use(backend)
    }
    #else
    func retry() { host?.retryStartup() }

    init(native useNative: Bool) {
        let shell = ShellModel()
        self.shell = shell
        if useNative, let backend = NativeShellBackend(shell: shell) {
            host = nil
            use(backend)
            return
        }
        let host = WebHost(engine: EngineSettings())
        self.host = host
        shell.backend = host
        host.onReady = { [weak self] in
            self?.ready = true
            self?.restoring = false
        }
        host.onSplash = { [weak self] up in self?.splashUp = up }
        host.onShell = { [weak self] json in
            #if DEBUG
            ShellRecorder.record(json)
            #endif
            self?.shell.apply(json: json)
        }
        host.onStartupFailure = { [weak self] message in self?.startupFailure = message }
        #if DEBUG
        host.debugNavigation = { [weak self] in
            guard let shell = self?.shell else { return [:] }
            return ["route": shell.visibleRoute ?? "", "path": shell.path,
                    "sheet": shell.sheetPresented ? "tools" : shell.presentedPanel ?? "closed",
                    "dock": shell.dock.map(\.id),
                    "search": ["label": shell.search.label, "canCopy": shell.search.canCopy,
                               "canClear": shell.search.canClear, "mapsURL": shell.search.mapsURL,
                               "earthURL": shell.search.earthURL]]
        }
        #endif
        host.onTerminate = { [weak self] in
            guard let self else { return }
            restoring = true
            ready = false
            shell.reset()
        }
        host.load()
    }
    #endif

    private func use(_ backend: NativeShellBackend) {
        native = backend
        shell.backend = backend
        ready = true
        backend.start()
        #if DEBUG
        // `-cspDebugAct look:missoula` runs one shell action at launch,
        // for checking a state on a simulator that takes no touches.
        if let ref = UserDefaults.standard.string(forKey: "cspDebugAct") {
            backend.send("act", ["ref": ref, "op": "click"])
        }
        // `-cspDebugCamera "39.5 -98.5 3.5"` moves the camera to a latitude,
        // longitude and zoom once the map is up.
        if let camera = UserDefaults.standard.string(forKey: "cspDebugCamera") {
            let parts = camera.split(separator: " ").compactMap { Double($0) }
            if parts.count == 3 {
                Task { @MainActor in
                    try? await Task.sleep(for: .seconds(3))
                    backend.send("goTo", ["lat": parts[0], "lng": parts[1], "zoom": parts[2]])
                }
            }
        }
        // `-cspDebugSearch "Mount Rainier"` submits a search, as typed.
        if let text = UserDefaults.standard.string(forKey: "cspDebugSearch") {
            let shell = shell
            Task { @MainActor in
                try? await Task.sleep(for: .seconds(3))
                shell.query = text
                shell.submit()
            }
        }
        #endif
    }
}

#if DEBUG
/// `-cspRecordShell YES` appends every shell update the page publishes to
/// Library/Caches/csp-shell-record.jsonl: the parity reference for the
/// native shell backend (see ios/scripts/capture_shell.js).
enum ShellRecorder {
    static let enabled = UserDefaults.standard.bool(forKey: "cspRecordShell")
    static let url = URL.cachesDirectory.appending(path: "csp-shell-record.jsonl")

    static func record(_ json: String) {
        guard enabled, let line = (json.replacingOccurrences(of: "\n", with: " ") + "\n").data(using: .utf8) else { return }
        if let handle = try? FileHandle(forWritingTo: url) {
            handle.seekToEndOfFile()
            handle.write(line)
            try? handle.close()
        } else {
            try? line.write(to: url)
        }
    }
}
#endif
