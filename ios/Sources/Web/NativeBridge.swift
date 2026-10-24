import WebKit

/// Messages from native-host.js. Each reply is plain JSON data, so the page's
/// promise resolves exactly as a fetch of the same data would.
final class NativeBridge: NSObject, WKScriptMessageHandlerWithReply {
    static let name = "cspNative"

    private let engine: EngineSettings
    private let location: LocationService
    weak var host: WebHost?

    init(engine: EngineSettings, location: LocationService) {
        self.engine = engine
        self.location = location
    }

    func userContentController(_ controller: WKUserContentController,
                               didReceive message: WKScriptMessage) async -> (Any?, String?) {
        // Only the bundled page may use the bridge; never a frame it embeds.
        let origin = message.frameInfo.securityOrigin
        guard message.frameInfo.isMainFrame,
              origin.protocol == SiteSchemeHandler.scheme, origin.host == SiteSchemeHandler.host,
              let body = message.body as? [String: Any], let type = body["type"] as? String else {
            return (nil, "Not available here")
        }
        switch type {
        case "engine.set":
            let base = engine.set(body["base"] as? String ?? "")
            return (base, nil)

        case "geo.current":
            let timeout = (body["timeout"] as? Double).map { $0 / 1000 }
            let maximumAge = ((body["maximumAge"] as? Double) ?? 0) / 1000
            do {
                let fix = try await location.current(highAccuracy: body["highAccuracy"] as? Bool ?? false,
                                                     timeout: timeout, maximumAge: maximumAge)
                return (fix.geolocationJSON, nil)
            } catch let failure as LocationService.Failure {
                return (nil, failure.rawValue)
            } catch {
                return (nil, LocationService.Failure.unavailable.rawValue)
            }

        case "geo.watch":
            guard let id = body["id"] as? Int else { return (nil, "Missing watch id") }
            location.watch(id: id) { [weak self] fix, failure in
                self?.host?.deliverWatch(id: id, fix: fix?.geolocationJSON, failure: failure?.rawValue)
            }
            return (true, nil)

        case "geo.clear":
            if let id = body["id"] as? Int { location.clear(id: id) }
            return (true, nil)

        case "ready":
            host?.pageReady()
            return (true, nil)

        case "shell":
            guard let json = body["json"] as? String else { return (nil, "Missing update") }
            host?.shellMessage(json)
            return (true, nil)

        #if DEBUG
        case "debug.appearance":
            return (host?.debugAppearance() ?? [:], nil)
        case "debug.configuration":
            return (host?.debugConfiguration() ?? [:], nil)
        case "debug.mapSnapshot":
            return (host?.debugMapSnapshot() ?? ["passed": false], nil)
        case "debug.recovery":
            guard let runID = body["runID"] as? String else { return (nil, "Missing run ID") }
            host?.debugRecovery(runID: runID, original: body["original"] as? [String: Any])
            return (true, nil)
        #endif

        default:
            return (nil, "Unknown message \(type)")
        }
    }
}
