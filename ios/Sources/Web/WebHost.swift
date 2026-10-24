import SwiftUI
import UIKit
import WebKit
import os

/// Owns the web view that runs the Clear Skies map engine, and everything the
/// page needs from iOS: bundled files, the engine hop, dialogs, links,
/// downloads and location.
final class WebHost: NSObject {
    let webView: WKWebView
    var onReady: (() -> Void)?
    /// Updates from native-shell.js, as JSON text.
    var onShell: ((String) -> Void)?
    /// iOS ended the page's process; the page is reloading.
    var onTerminate: (() -> Void)?

    private let engine: EngineSettings
    private let location = LocationService()
    private let proxy = EngineProxy()
    private let schemeHandler: SiteSchemeHandler
    private let bridge: NativeBridge
    // One current recovery checkpoint, held only in this app process's memory.
    private var session: [String: Any]?
    private var downloads: [ObjectIdentifier: URL] = [:]
    #if DEBUG
    var debugNavigation: (() -> [String: Any])?
    private var debugScriptStarted = false
    private var debugReadyGeneration = 0
    private var debugRecoveryRun: String?
    #endif

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
        #if DEBUG
        webView.isInspectable = true
        #endif
        webView.allowsLinkPreview = false
        webView.allowsBackForwardNavigationGestures = false
        // The page lays itself out edge to edge and pads its own controls with
        // env(safe-area-inset-*), as it does when installed from Safari.
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.bounces = false
        // Touches reach the map at once; the page never scrolls as a document.
        webView.scrollView.delaysContentTouches = false
        webView.isOpaque = false
        webView.backgroundColor = UIColor(named: "CanvasBackground")
        webView.scrollView.backgroundColor = webView.backgroundColor
        webView.underPageBackgroundColor = webView.backgroundColor
    }

    func load() {
        webView.load(URLRequest(url: SiteSchemeHandler.startURL))
    }

    func shellMessage(_ json: String) {
        if let data = json.data(using: .utf8),
           let update = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let state = update["session"] as? [String: Any] { session = state }
        onShell?(json)
    }

    func pageReady() {
        onReady?()
        #if DEBUG
        debugReadyGeneration += 1
        runDebugScript()
        #endif
    }

    #if DEBUG
    /// Capture only this app's window for native map-control layout review.
    func debugMapSnapshot() -> [String: Any] {
        guard let window = webView.window else { return ["passed": false, "error": "No app window"] }
        var drawn = false
        let image = UIGraphicsImageRenderer(bounds: window.bounds).image { _ in
            drawn = window.drawHierarchy(in: window.bounds, afterScreenUpdates: true)
        }
        guard drawn, let data = image.pngData() else { return ["passed": false, "error": "Window rendering failed"] }
        do {
            try data.write(to: URL.cachesDirectory.appending(path: "csp-map-layout.png"), options: .atomic)
            return ["passed": true, "width": Double(window.bounds.width), "height": Double(window.bounds.height)]
        } catch {
            return ["passed": false, "error": error.localizedDescription]
        }
    }

    func debugConfiguration() -> [String: Any] {
        var sliders: [[String: Any]] = []
        func color(_ value: UIColor?) -> String {
            guard let value else { return "auto" }
            var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
            value.getRed(&r, green: &g, blue: &b, alpha: &a)
            return String(format: "#%02x%02x%02x", Int((r * 255).rounded()), Int((g * 255).rounded()), Int((b * 255).rounded()))
        }
        func visit(_ view: UIView) {
            if let slider = view as? UISlider {
                sliders.append(["title": slider.accessibilityLabel ?? "", "fill": color(slider.minimumTrackTintColor),
                                "track": color(slider.maximumTrackTintColor), "height": slider.bounds.height])
            }
            view.subviews.forEach(visit)
        }
        var controller = webView.window?.rootViewController
        while let current = controller { visit(current.view); controller = current.presentedViewController }
        return ["photosAddUsage": Bundle.main.object(forInfoDictionaryKey: "NSPhotoLibraryAddUsageDescription") as? String ?? "",
                "interFont": UIFont(name: "Inter-Regular", size: 17)?.fontName ?? "",
                "inspectable": webView.isInspectable, "sliders": sliders,
                "navigation": debugNavigation?() ?? [:]]
    }

    /// Exercises the actual recovery delegate, retaining the native process.
    /// It writes the result after the replacement WebContent page is ready.
    func debugRecovery(runID: String, original: [String: Any]?) {
        guard let expected = session else { return }
        debugRecoveryRun = runID
        let previous = debugReadyGeneration
        webViewWebContentProcessDidTerminate(webView)
        Task {
            do {
                for _ in 0..<150 where debugReadyGeneration == previous {
                    try await Task.sleep(for: .milliseconds(100))
                }
                guard debugReadyGeneration > previous else { throw NSError(domain: "Recovery timed out", code: 1) }
                let result = try await webView.callAsyncJavaScript("""
                    const current=ClearSkiesPortalBridge.sessionState(), failures=[];
                    const close=(a,b)=>Math.abs(a-b)<1e-5;
                    if(!current.center.every((n,i)=>close(n,expected.center[i]))||!close(current.zoom,expected.zoom)) failures.push('Viewpoint changed');
                    if(!close(current.bearing,expected.bearing)||current.mode!==expected.mode) failures.push('Mode or bearing changed');
                    if(!!current.location!==!!expected.location||current.location&&(!close(current.location.lat,expected.location.lat)||!close(current.location.lng,expected.location.lng)||current.location.label!==expected.location.label)) failures.push('Selected location changed');
                    return {passed:!failures.length,failures,checks:['Native recovery delegate preserves viewpoint, mode, bearing and selected place'],method:'Actual recovery delegate with a WebContent reload'};
                    """, arguments: ["expected": expected], contentWorld: .page)
                if let original {
                    _ = try await webView.callAsyncJavaScript("""
                        await ClearSkiesPortalBridge.restoreSession(original.session);
                        CSPNativeShell.act('#terStyle','select',original.style);
                        if(original.preferences===null)localStorage.removeItem('clearskies.terrain.v2');
                        else localStorage.setItem('clearskies.terrain.v2',original.preferences);
                        """, arguments: ["original": original], contentWorld: .page)
                }
                let data = try JSONSerialization.data(withJSONObject: ["ok": true, "runID": runID, "result": result ?? NSNull()], options: [.prettyPrinted])
                try data.write(to: URL.cachesDirectory.appending(path: "csp-debug-result.json"), options: .atomic)
            } catch {
                let data = try? JSONSerialization.data(withJSONObject: ["ok": false, "runID": runID, "error": error.localizedDescription])
                try? data?.write(to: URL.cachesDirectory.appending(path: "csp-debug-result.json"), options: .atomic)
            }
            debugRecoveryRun = nil
        }
    }

    /// Read native traits from an app-scoped probe; no screenshot or device
    /// settings change is needed to verify that the web and SwiftUI agree.
    func debugAppearance() -> [String: Any] {
        func name(_ style: UIUserInterfaceStyle?) -> String {
            switch style {
            case .light: "light"
            case .dark: "dark"
            default: "unspecified"
            }
        }
        return ["web": name(webView.traitCollection.userInterfaceStyle),
                "root": name(webView.window?.rootViewController?.traitCollection.userInterfaceStyle),
                "presented": name(presenter?.traitCollection.userInterfaceStyle),
                "hasWindow": webView.window != nil,
                "hasSheet": webView.window?.rootViewController?.presentedViewController != nil,
                "expectsSheet": UserDefaults.standard.string(forKey: "cspDebugPage") != nil
                    || UserDefaults.standard.string(forKey: "cspDebugPanel") != nil]
    }

    /// Verification hook for Debug builds only: `-cspDebugScript '<js>'` on
    /// the launch command line runs that async function body once the page is
    /// ready and writes its result to Library/Caches/csp-debug-result.json
    /// and the system log (subsystem = bundle ID, category "debug").
    /// Launch arguments also override stored defaults, so
    /// `-clearskies.engineBase.v1 <url>` sets the engine for one run.
    private func runDebugScript() {
        guard let script = UserDefaults.standard.string(forKey: "cspDebugScript"), !script.isEmpty else { return }
        guard !debugScriptStarted else { return }
        debugScriptStarted = true
        let runID = UserDefaults.standard.string(forKey: "cspDebugRunID") ?? ""
        let log = Logger(subsystem: Bundle.main.bundleIdentifier ?? "ClearSkies", category: "debug")
        Task {
            let output = URL.cachesDirectory.appending(path: "csp-debug-result.json")
            do {
                let result = try await webView.callAsyncJavaScript(script, arguments: ["__cspDebugRunID": runID], contentWorld: .page)
                let data = try JSONSerialization.data(withJSONObject: ["ok": true, "runID": runID, "result": result ?? NSNull()],
                                                      options: [.prettyPrinted, .sortedKeys])
                try data.write(to: output, options: .atomic)
                log.notice("debug script result: \(String(describing: result ?? "nil"), privacy: .public)")
            } catch {
                if debugRecoveryRun == runID { return }
                let data = try? JSONSerialization.data(withJSONObject: ["ok": false, "runID": runID, "error": error.localizedDescription])
                try? data?.write(to: output, options: .atomic)
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
    /// the script that carries it is rebuilt before every load. The native
    /// shell adapter runs once the page's own scripts have run.
    private func installBootstrap() {
        let controller = webView.configuration.userContentController
        controller.removeAllUserScripts()
        controller.addUserScript(WKUserScript(source: Self.bootstrapSource(engineBase: engine.base, session: session),
                                              injectionTime: .atDocumentStart,
                                              forMainFrameOnly: true, in: .page))
        controller.addUserScript(WKUserScript(source: Self.resource("native-shell"),
                                              injectionTime: .atDocumentEnd,
                                              forMainFrameOnly: true, in: .page))
    }

    private static func resource(_ name: String) -> String {
        guard let url = Bundle.main.url(forResource: name, withExtension: "js"),
              let source = try? String(contentsOf: url, encoding: .utf8) else {
            preconditionFailure("\(name).js is missing from the app bundle")
        }
        return source
    }

    private static func bootstrapSource(engineBase: String, session: [String: Any]?) -> String {
        let template = resource("native-host")
        let config: [String: Any] = ["engineBase": engineBase, "appVersion": appVersion, "resume": session ?? NSNull()]
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
        onTerminate?()
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
