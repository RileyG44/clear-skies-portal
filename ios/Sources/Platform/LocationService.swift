import CoreLocation

/// Core Location behind the page's navigator.geolocation.
///
/// The page asks once through the system prompt worded by the app, instead of
/// a second web-content prompt that names clearskies://app.
final class LocationService {
    enum Failure: String, Error {
        case denied, unavailable, timeout
    }

    private var watches: [Int: Task<Void, Never>] = [:]

    /// One position, as getCurrentPosition expects: the first fix that is
    /// accurate enough, or the best fix once fixes stop improving.
    func current(highAccuracy: Bool, timeout: TimeInterval?, maximumAge: TimeInterval) async throws -> CLLocation {
        if maximumAge > 0, let last = CLLocationManager().location, last.horizontalAccuracy >= 0,
           -last.timestamp.timeIntervalSinceNow <= maximumAge {
            return last
        }
        let session = CLServiceSession(authorization: .whenInUse)
        defer { session.invalidate() }
        let box = FixBox()
        let target: CLLocationAccuracy = highAccuracy ? 25 : 150
        return try await withThrowingTaskGroup(of: CLLocation.self) { group in
            group.addTask {
                for try await update in CLLocationUpdate.liveUpdates() {
                    if update.authorizationDenied || update.authorizationDeniedGlobally || update.authorizationRestricted {
                        throw Failure.denied
                    }
                    guard let location = update.location, location.horizontalAccuracy >= 0 else { continue }
                    await box.offer(location)
                    if location.horizontalAccuracy <= target { return location }
                }
                if let best = await box.best { return best }
                throw Failure.unavailable
            }
            // A fix that has stopped improving is the answer; waiting longer
            // for a better one only delays the map.
            group.addTask {
                while true {
                    try await Task.sleep(for: .milliseconds(250))
                    if let settled = await box.settled(after: .seconds(4)) { return settled }
                }
            }
            if let timeout {
                group.addTask {
                    try await Task.sleep(for: .seconds(timeout))
                    if let best = await box.best { return best }
                    throw Failure.timeout
                }
            }
            defer { group.cancelAll() }
            guard let location = try await group.next() else { throw Failure.unavailable }
            return location
        }
    }

    /// Continuous positions for watchPosition, until cleared.
    func watch(id: Int, deliver: @escaping (CLLocation?, Failure?) -> Void) {
        watches[id]?.cancel()
        watches[id] = Task {
            let session = CLServiceSession(authorization: .whenInUse)
            defer { session.invalidate() }
            do {
                for try await update in CLLocationUpdate.liveUpdates() {
                    if Task.isCancelled { return }
                    if update.authorizationDenied || update.authorizationDeniedGlobally || update.authorizationRestricted {
                        deliver(nil, .denied)
                        return
                    }
                    if let location = update.location, location.horizontalAccuracy >= 0 {
                        deliver(location, nil)
                    }
                }
            } catch {
                if !Task.isCancelled { deliver(nil, .unavailable) }
            }
        }
    }

    func clear(id: Int) {
        watches.removeValue(forKey: id)?.cancel()
    }
}

/// The best fix so far, shared by the tasks racing to answer.
private actor FixBox {
    private(set) var best: CLLocation?
    private var first: ContinuousClock.Instant?

    func offer(_ location: CLLocation) {
        if first == nil { first = .now }
        if best.map({ location.horizontalAccuracy < $0.horizontalAccuracy }) ?? true { best = location }
    }

    func settled(after wait: Duration) -> CLLocation? {
        guard let first, ContinuousClock.now - first >= wait else { return nil }
        return best
    }
}

extension CLLocation {
    /// The fields of a GeolocationCoordinates object, in metres and degrees.
    var geolocationJSON: [String: Any] {
        var json: [String: Any] = [
            "latitude": coordinate.latitude,
            "longitude": coordinate.longitude,
            "accuracy": horizontalAccuracy,
            "timestamp": timestamp.timeIntervalSince1970 * 1000
        ]
        if verticalAccuracy >= 0 {
            json["altitude"] = altitude
            json["altitudeAccuracy"] = verticalAccuracy
        }
        if course >= 0 { json["heading"] = course }
        if speed >= 0 { json["speed"] = speed }
        return json
    }
}
