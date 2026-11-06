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
                if next == .active && portal == nil { portal = PortalModel() }
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

    @ObservationIgnored let host: WebHost
    @ObservationIgnored let shell = ShellModel()

    init() {
        host = WebHost(engine: EngineSettings())
        shell.host = host
        host.onReady = { [weak self] in
            self?.ready = true
            self?.restoring = false
        }
        host.onSplash = { [weak self] up in self?.splashUp = up }
        host.onShell = { [weak self] json in self?.shell.apply(json: json) }
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
