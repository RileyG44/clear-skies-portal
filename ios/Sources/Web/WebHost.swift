import SwiftUI
import UIKit
import WebKit
import os

/// Owns the web view that runs the Clear Skies map engine, and everything the
/// page needs from iOS: bundled files, the engine hop, dialogs, links,
/// downloads and location.
final class WebHost: NSObject {
    let webView: WKWebView
    var onTheme: ((String) -> Void)?
    var onReady: (() -> Void)?

    private let engine: EngineSettings
    private let location = LocationService()
    private let proxy = EngineProxy()
    private let schemeHandler: SiteSchemeHandler
    private let bridge: NativeBridge
    private var downloads: [ObjectIdentifier: URL] = [:]

    init(engine: EngineSettings) {
        self.engine = engine
        let site = Bundle.main.resourceURL!.appending(path: "site", directoryHint: .isDirectory)
        schemeHandler = SiteSchemeHandler(root: site, proxy: proxy, engine: engine)
        bridge = NativeBridge(engine: engine, location: location)

        let configuration = WKWebViewConfiguration()
        configuration.setURLSchemeHandler(schemeHandler, forURLScheme: SiteSchemeHandler.scheme)
        configuration.websiteDataStore = .default()
        configuration.applicationNameForUserAgent = "ClearSkiesApp/\(Self.appVersion)"
        configuration.allowsInlineMediaPlayback = true
        configuration.dataDetectorTypes = []
        configuration.userContentController.addScriptMessageHandler(bridge, contentWorld: .page, name: NativeBridge.name)

        webView = WKWebView(frame: .zero, configuration: configuration)
        super.init()
        bridge.host = self
        installBootstrap()

        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.isInspectable = true
        webView.allowsLinkPreview = false
        webView.allowsBackForwardNavigationGestures = false
        // The page lays itself out edge to edge and pads its own controls with
        // env(safe-area-inset-*), as it does when installed from Safari.
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.bounces = false
        webView.isOpaque = false
        webView.backgroundColor = UIColor(named: "CanvasBackground")
        webView.scrollView.backgroundColor = webView.backgroundColor
    }

    func load() {
        webView.load(URLRequest(url: SiteSchemeHandler.startURL))
    }

    func themeChanged(_ theme: String?) {
        guard let theme else { return }
        onTheme?(theme)
    }

    func pageReady() {
        onReady?()
        #if DEBUG
        runDebugScript()
        #endif
    }

    #if DEBUG
    /// Verification hook for Debug builds only: `-cspDebugScript '<js>'` on
    /// the launch command line runs that async function body once the page is
    /// ready and writes its result to the system log (subsystem = bundle ID,
    /// category "debug"). Launch arguments also override stored defaults, so
    /// `-clearskies.engineBase.v1 <url>` sets the engine for one run.
    private func runDebugScript() {
        guard let script = UserDefaults.standard.string(forKey: "cspDebugScript"), !script.isEmpty else { return }
        let log = Logger(subsystem: Bundle.main.bundleIdentifier ?? "ClearSkies", category: "debug")
        Task {
            do {
                let result = try await webView.callAsyncJavaScript(script, arguments: [:], contentWorld: .page)
                log.notice("debug script result: \(String(describing: result ?? "nil"), privacy: .public)")
            } catch {
                log.error("debug script failed: \(String(describing: error), privacy: .public)")
            }
        }
    }
    #endif

    func deliverWatch(id: Int, fix: [String: Any]?, failure: String?) {
        webView.callAsyncJavaScript(
            "window.CSPNativeHost?._geoUpdate(id, fix, failure)",
            arguments: ["id": id, "fix": fix ?? NSNull(), "failure": failure ?? NSNull()],
            in: nil, in: .page, completionHandler: nil)
    }

    /// The page reads the engine address synchronously while it starts, so
    /// the script that carries it is rebuilt before every load.
    private func installBootstrap() {
        let controller = webView.configuration.userContentController
        controller.removeAllUserScripts()
        controller.addUserScript(WKUserScript(source: Self.bootstrapSource(engineBase: engine.base),
                                              injectionTime: .atDocumentStart,
                                              forMainFrameOnly: true, in: .page))
    }

    private static func bootstrapSource(engineBase: String) -> String {
        guard let url = Bundle.main.url(forResource: "native-host", withExtension: "js"),
              let template = try? String(contentsOf: url, encoding: .utf8) else {
            preconditionFailure("native-host.js is missing from the app bundle")
        }
        let config: [String: Any] = ["engineBase": engineBase, "appVersion": appVersion]
        let json = (try? JSONSerialization.data(withJSONObject: config)).flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
        return template.replacingOccurrences(of: "__CSP_NATIVE_CONFIG__", with: json)
    }

    static var appVersion: String {
        let info = Bundle.main.infoDictionary
        let version = info?["CFBundleShortVersionString"] as? String ?? "0"
        let build = info?["CFBundleVersion"] as? String ?? "0"
        return "\(version) (\(build))"
    }

    // MARK: - Presenting system UI

    private var presenter: UIViewController? {
        var top = webView.window?.rootViewController
        while let next = top?.presentedViewController { top = next }
        return top
    }

    private func openExternally(_ url: URL) {
        UIApplication.shared.open(url)
    }

    private func share(_ urls: [URL]) {
        guard let presenter else { return }
        let sheet = UIActivityViewController(activityItems: urls, applicationActivities: nil)
        sheet.popoverPresentationController?.sourceView = webView
        sheet.popoverPresentationController?.sourceRect = CGRect(x: webView.bounds.midX, y: webView.bounds.maxY - 1, width: 1, height: 1)
        presenter.present(sheet, animated: true)
    }

    private func alert(title: String?, message: String, actions: [(String, UIAlertAction.Style)]) async -> Int? {
        guard let presenter else { return nil }
        return await withCheckedContinuation { continuation in
            let alert = UIAlertController(title: title, message: message, preferredStyle: .alert)
            for (index, (label, style)) in actions.enumerated() {
                alert.addAction(UIAlertAction(title: label, style: style) { _ in continuation.resume(returning: index) })
            }
            presenter.present(alert, animated: true)
        }
    }
}

// MARK: - Navigation

extension WebHost: WKNavigationDelegate {
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 preferences: WKWebpagePreferences) async -> (WKNavigationActionPolicy, WKWebpagePreferences) {
        if action.shouldPerformDownload { return (.download, preferences) }
        guard let url = action.request.url else { return (.cancel, preferences) }
        let scheme = url.scheme?.lowercased() ?? ""
        if [SiteSchemeHandler.scheme, "about", "blob", "data"].contains(scheme) {
            return (.allow, preferences)
        }
        // A frame the page embeds may load public pages in place.
        if scheme == "http" || scheme == "https", action.targetFrame?.isMainFrame == false {
            return (.allow, preferences)
        }
        // Links out of the app (Google Maps, Google Earth, sources and
        // licences) open in their own apps, never inside the map.
        openExternally(url)
        return (.cancel, preferences)
    }

    func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse) async -> WKNavigationResponsePolicy {
        response.canShowMIMEType ? .allow : .download
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        download.delegate = self
    }

    /// iOS may end the page's process under memory pressure, most often while
    /// the app is in the background. The page restores itself from storage.
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        installBootstrap()
        load()
    }
}

// MARK: - Dialogs and new windows

extension WebHost: WKUIDelegate {
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = action.request.url { openExternally(url) }
        return nil
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo) async {
        _ = await alert(title: nil, message: message, actions: [("OK", .default)])
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo) async -> Bool {
        await alert(title: nil, message: message, actions: [("Cancel", .cancel), ("OK", .default)]) == 1
    }

    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String,
                 defaultText: String?, initiatedByFrame frame: WKFrameInfo) async -> String? {
        guard let presenter else { return nil }
        return await withCheckedContinuation { continuation in
            let alert = UIAlertController(title: nil, message: prompt, preferredStyle: .alert)
            alert.addTextField { $0.text = defaultText }
            alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in continuation.resume(returning: nil) })
            alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in
                continuation.resume(returning: alert.textFields?.first?.text ?? "")
            })
            presenter.present(alert, animated: true)
        }
    }
}

// MARK: - Exports

extension WebHost: WKDownloadDelegate {
    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse,
                  suggestedFilename: String) async -> URL? {
        let folder = FileManager.default.temporaryDirectory.appending(path: "Exports", directoryHint: .isDirectory)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let name = suggestedFilename.replacingOccurrences(of: "/", with: "-")
        let destination = folder.appending(path: name.isEmpty ? "clear-skies-export" : name)
        try? FileManager.default.removeItem(at: destination)
        downloads[ObjectIdentifier(download)] = destination
        return destination
    }

    func downloadDidFinish(_ download: WKDownload) {
        guard let file = downloads.removeValue(forKey: ObjectIdentifier(download)) else { return }
        share([file])
    }

    func download(_ download: WKDownload, didFailWithError error: any Error, resumeData: Data?) {
        downloads.removeValue(forKey: ObjectIdentifier(download))
        Task { _ = await alert(title: "Export failed", message: error.localizedDescription, actions: [("OK", .default)]) }
    }
}
