import SwiftUI

@main
struct ClearSkiesApp: App {
    @State private var portal = PortalModel()

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
        #if DEBUG
        host.debugNavigation = { [weak self] in
            guard let shell = self?.shell else { return [:] }
            return ["route": shell.visibleRoute ?? "", "path": shell.path,
                    "sheet": shell.sheetPresented ? "tools" : shell.presentedPanel ?? "closed"]
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
