import SwiftUI
import WebKit

/// Stage 2 of CR-001: the map engine fills the screen edge to edge, and the
/// native chrome sits over it. The web panel, dock and pop-ups stay in the
/// page as the source of truth; native-shell.js describes them and the
/// native views drive them.
struct RootView: View {
    var portal: PortalModel

    var body: some View {
        @Bindable var shell = portal.shell
        ZStack {
            PortalWebView(webView: portal.host.webView)
                .ignoresSafeArea()
            StatusBarEdge()
            MapChrome()
                .opacity(portal.ready ? 1 : 0)
            if !portal.ready {
                LaunchCover(restoring: portal.restoring)
            }
        }
        .background(Color("CanvasBackground").ignoresSafeArea())
        .animation(.easeOut(duration: 0.35), value: portal.ready)
        .environment(shell)
        // The app follows the system's light or dark appearance; the map's
        // own dark theme is a map style, not the app's.
        .sheet(item: $shell.activeSheet) { sheet in
            Group {
                switch sheet {
                case .tools: ToolsSheet()
                case .panel(let id): PanelSheet(id: id)
                }
            }
            .environment(shell)
            .presentationDetents([.medium, .expanded], selection: $shell.detent)
            // The map stays live behind the sheet at every height, so iOS
            // neither dims nor shrinks it and the glass shows the map.
            .presentationBackgroundInteraction(.enabled)
            .presentationContentInteraction(.resizes)
            .presentationDragIndicator(.visible)
            // iOS fades a growing sheet from glass to opaque; this one keeps
            // the map tools' glass at every height.
            .presentationBackground { SheetGlass() }
        }
        .sensoryFeedback(.selection, trigger: shell.feedback)
        #if DEBUG
        // Verify both appearances without changing the device's settings.
        .preferredColorScheme(debugAppearance)
        #endif
    }

    #if DEBUG
    private var debugAppearance: ColorScheme? {
        switch UserDefaults.standard.string(forKey: "cspDebugAppearance") {
        case "light": .light
        case "dark": .dark
        default: nil
        }
    }
    #endif
}

/// The status bar sits on the map, which may be dark in light mode or light
/// in dark mode. A soft material edge under it keeps the time and battery
/// legible either way, as scroll edges do elsewhere in iOS.
struct StatusBarEdge: View {
    var body: some View {
        GeometryReader { geometry in
            let height = geometry.safeAreaInsets.top
            if height > 0 {
                Rectangle()
                    .fill(.ultraThinMaterial)
                    .mask(LinearGradient(stops: [.init(color: .black, location: 0), .init(color: .black, location: 0.6),
                                                 .init(color: .clear, location: 1)],
                                         startPoint: .top, endPoint: .bottom))
                    .frame(height: height + 10)
                    .ignoresSafeArea(edges: .top)
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

struct PortalWebView: UIViewRepresentable {
    let webView: WKWebView

    func makeUIView(context: Context) -> WKWebView { webView }
    func updateUIView(_ webView: WKWebView, context: Context) {}
}
