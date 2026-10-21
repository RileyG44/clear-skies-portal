import SwiftUI
import WebKit

/// Stage 1 of CR-001: the map engine and its current controls fill the screen
/// edge to edge, as they do when installed from Safari. Native chrome replaces
/// the page's own controls route by route in Stage 2.
struct RootView: View {
    var portal: PortalModel

    var body: some View {
        PortalWebView(webView: portal.host.webView)
            .ignoresSafeArea()
            .background(Color("CanvasBackground").ignoresSafeArea())
            .preferredColorScheme(portal.colorScheme)
    }
}

struct PortalWebView: UIViewRepresentable {
    let webView: WKWebView

    func makeUIView(context: Context) -> WKWebView { webView }
    func updateUIView(_ webView: WKWebView, context: Context) {}
}
