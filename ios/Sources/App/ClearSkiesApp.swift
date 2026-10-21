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
@Observable
final class PortalModel {
    /// The page's light or dark map, so the status bar and system sheets match.
    var theme: String?
    var ready = false

    @ObservationIgnored let host: WebHost

    init() {
        host = WebHost(engine: EngineSettings())
        host.onTheme = { [weak self] theme in self?.theme = theme }
        host.onReady = { [weak self] in self?.ready = true }
        host.load()
    }

    var colorScheme: ColorScheme? {
        switch theme {
        case "dark": .dark
        case "light": .light
        default: nil
        }
    }
}
