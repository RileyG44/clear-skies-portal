import UIKit

/// Reconnect the system download session before a background launch finishes.
/// Completion handlers run only after delegate events have reached disk.
final class EngineAppDelegate: NSObject, UIApplicationDelegate {
    private static var handlers: [String: () -> Void] = [:]
    private static var finished: Set<String> = []

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        EngineBackground.shared.register()
        _ = EngineRuntime.shared
        _ = BackgroundDownloads.shared
        if application.applicationState == .background { EngineBackground.shared.enteredBackground() }
        return true
    }

    func applicationDidBecomeActive(_ application: UIApplication) { EngineBackground.shared.becameActive() }
    func applicationDidEnterBackground(_ application: UIApplication) { EngineBackground.shared.enteredBackground() }

    func application(_ application: UIApplication, handleEventsForBackgroundURLSession identifier: String,
                     completionHandler: @escaping () -> Void) {
        guard identifier == BackgroundDownloads.identifier else { completionHandler(); return }
        _ = EngineRuntime.shared
        _ = BackgroundDownloads.shared
        if Self.finished.remove(identifier) != nil { completionHandler() }
        else { Self.handlers[identifier] = completionHandler }
    }

    static func finishedEvents(_ identifier: String) {
        if let handler = handlers.removeValue(forKey: identifier) { handler() }
        else { finished.insert(identifier) }
    }
}
