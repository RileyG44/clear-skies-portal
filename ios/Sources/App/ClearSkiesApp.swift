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
                if next == .active && portal == nil { portal = PortalModel(native: NativeMapPreference.enabled) }
            }
        }
    }
}

/// App-wide state the native layer needs from the page.
@MainActor @Observable
final class PortalModel {
    var ready = false
    /// The page's start-up screen is up: the native cover gives way to it.
    var splashUp = false
    var startupFailure: String?
    /// True while the page reloads after iOS ended its process.
    var restoring = false

    /// The web canvas and its page, until the native app state replaces it.
    @ObservationIgnored let host: WebHost?
    /// The native map and app state (`cspNativeMap`).
    @ObservationIgnored let native: NativeShellBackend?
    @ObservationIgnored let shell: ShellModel

    /// Space under the home indicator, from the map's window.
    var homeInset: CGFloat { shell.backend?.window?.safeAreaInsets.bottom ?? 0 }

    func retry() { host?.retryStartup() }

    init(native useNative: Bool) {
        let shell = ShellModel()
        self.shell = shell
        if useNative, let backend = NativeShellBackend(shell: shell) {
            host = nil
            native = backend
            shell.backend = backend
            ready = true
            backend.start()
            return
        }
        native = nil
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
