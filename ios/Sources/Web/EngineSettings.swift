import Foundation

/// Where the Clear Skies terrain engine (server.js) answers.
///
/// The web client's own address box writes here through the bridge, and the
/// scheme handler reads it for every /api request. Empty means no engine: the
/// client then uses its public sources, exactly as the hosted web client does.
final class EngineSettings {
    private let key = "clearskies.engineBase.v1"
    private let defaults: UserDefaults
    private(set) var base: String

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        base = Self.normalise(defaults.string(forKey: key) ?? "")
    }

    /// Stores a normalised address and returns it. An empty string clears it.
    @discardableResult
    func set(_ value: String) -> String {
        let normalised = Self.normalise(value)
        base = normalised
        if normalised.isEmpty {
            defaults.removeObject(forKey: key)
        } else {
            defaults.set(normalised, forKey: key)
        }
        return normalised
    }

    /// The same rules as normaliseBase() in index.html: a bare host gets
    /// https://, the result is the origin plus any path without trailing
    /// slashes, and credentials or other schemes are refused.
    static func normalise(_ value: String) -> String {
        var text = value.trimmingCharacters(in: .whitespacesAndNewlines)
        while text.hasSuffix("/") { text.removeLast() }
        guard !text.isEmpty else { return "" }
        if text.range(of: "^https?://", options: [.regularExpression, .caseInsensitive]) == nil {
            text = "https://" + text
        }
        guard let url = URL(string: text),
              let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https",
              url.user == nil, url.password == nil,
              var host = url.host(percentEncoded: true)?.lowercased(), !host.isEmpty else { return "" }
        if host.contains(":"), !host.hasPrefix("[") { host = "[\(host)]" }
        var base = "\(scheme)://\(host)"
        if let port = url.port, !(scheme == "https" && port == 443), !(scheme == "http" && port == 80) {
            base += ":\(port)"
        }
        var path = url.path(percentEncoded: true)
        while path.hasSuffix("/") { path.removeLast() }
        return base + path
    }
}
