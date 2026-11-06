import UIKit

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
