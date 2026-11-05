import SwiftUI
import UIKit

@main
struct ClearSkiesApp: App {
    @State private var portal = PortalModel()

    init() {
        // The system draws LaunchBackground from the device appearance before
        // this process exists, so that asset cannot read the saved theme.
        // The first window can. Paint it before SwiftUI creates the scene so
        // the cover does not open on the other colour.
        let theme = MapCanvasColor.theme()
        UIWindow.appearance().backgroundColor = MapCanvasColor.uiColor(theme: theme)
        switch theme {
        case "dark": UIWindow.appearance().overrideUserInterfaceStyle = .dark
        case "light": UIWindow.appearance().overrideUserInterfaceStyle = .light
        default: break
        }
    }

    var body: some Scene {
        WindowGroup {
            RootView(portal: portal)
        }
    }
}

/// App-wide state the native layer needs from the page.
@MainActor @Observable
final class PortalModel {
    var ready = false
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
