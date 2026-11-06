import os
import UIKit
import WebKit

/// Where the shell's content comes from and where a person's actions go.
///
/// The shell's look and flow are the app's own (MapChrome, the tool sheet,
/// the item views). Its content arrives as `ShellUpdate` JSON through
/// `ShellModel.apply(json:)`, and its actions leave as named commands and
/// queries with JSON-shaped arguments: the vocabulary of `CSPNativeShell`
/// (ios/Resources/native-shell.js). The web page is one backend; the native
/// app state (csk-app) is the other, with the same vocabulary.
@MainActor protocol ShellBackend: AnyObject {
    /// A command with no answer, e.g. `act` with `ref`, `op` and `value`.
    func send(_ command: String, _ arguments: [String: Any])
    /// A query with a JSON-shaped answer, e.g. `suggest` with `text`.
    func ask(_ query: String, _ arguments: [String: Any]) async throws -> Any?
    /// The map canvas colour behind the map for a theme.
    func useMapCanvas(_ theme: String?)
    /// Presents the system share sheet for a link.
    func shareLocation(_ url: URL) throws
    /// The window the map is in: safe areas, ending editing.
    var window: UIWindow? { get }
    var debugSheetVisible: Bool { get set }
}

extension WebHost: ShellBackend {
    private static let shellLog = Logger(subsystem: Bundle.main.bundleIdentifier ?? "ClearSkies", category: "shell")

    /// Each command's body in the page, with its arguments in scope by name.
    private static let commands: [String: String] = [
        "setView": "CSPNativeShell.setView({sheet, page, panel})",
        "open": "CSPNativeShell.open(route); CSPNativeShell.setView({sheet, page: route, panel})",
        "act": "CSPNativeShell.act(ref, op, value)",
        "tool": "CSPNativeShell.tool(id)",
        "toolForPanel": "const button = document.querySelector('#mapDock [aria-controls=\"' + panel + '\"]'); if (button) CSPNativeShell.tool(button.id)",
        "closePanel": "CSPNativeShell.closePanel(id)",
        "setMode": "CSPNativeShell.setMode(mode)",
        "moveTool": "CSPNativeShell.moveTool(id, index)",
        "searchText": "CSPNativeShell.searchText(text)",
        "pick": "CSPNativeShell.pick(index, version)",
        "searchMapCenter": "CSPNativeShell.searchMapCenter()",
        "searchSelected": "CSPNativeShell.searchSelected()",
        "clear": "CSPNativeShell.clear()",
        "locate": "CSPNativeShell.locate()",
        "centerSelected": "CSPNativeShell.centerSelected()",
        "copyCoordinates": "CSPNativeShell.copyCoordinates()",
        "revealSelected": "window.CSPMarkup?.revealSelected?.(inset)",
        "mapInfoHeight": "document.documentElement.style.setProperty('--csp-map-info-height', height + 'px')",
    ]

    private static let queries: [String: String] = [
        "enterValue": "return CSPNativeShell.enterValue(ref, value, key, owner)",
        "selectMark": "return CSPNativeShell.selectMark(ref, fid, inset)",
        "routeMatches": "return CSPNativeShell.routeMatches(text)",
        "suggest": "return await CSPNativeShell.suggest(text)",
        "submit": "return CSPNativeShell.submit(text)",
        "shareURL": "try { return {url: await ClearSkiesPortalBridge.shareURL()} } catch (error) { return {error: error.message} }",
        "bestImagery": "return await CSPNativeShell.bestImagery()",
    ]

    func send(_ command: String, _ arguments: [String: Any]) {
        guard let body = Self.commands[command] else {
            assertionFailure("unknown shell command \(command)")
            return
        }
        webView.callAsyncJavaScript(body, arguments: arguments, in: nil, in: .page) { result in
            if case .failure(let error) = result {
                WebHost.shellLog.error("shell command \(command, privacy: .public) failed: \(String(describing: error), privacy: .public)")
            }
        }
    }

    func ask(_ query: String, _ arguments: [String: Any]) async throws -> Any? {
        guard let body = Self.queries[query] else {
            assertionFailure("unknown shell query \(query)")
            return nil
        }
        return try await webView.callAsyncJavaScript(body, arguments: arguments, in: nil, contentWorld: .page)
    }

    var window: UIWindow? { webView.window }
}
