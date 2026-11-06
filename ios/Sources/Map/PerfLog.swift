#if DEBUG
import Foundation
import QuartzCore

/// Debug builds only: `-cspDebugPerf 30` records every map frame (when it
/// ran, its CPU cost, whether it presented, coverage and tiles in flight)
/// and named marks for that many seconds, then writes
/// Library/Caches/csp-perf.json. For comparing builds on a simulator.
nonisolated final class PerfLog: @unchecked Sendable {
    static let shared: PerfLog? = {
        let seconds = UserDefaults.standard.double(forKey: "cspDebugPerf")
        return seconds > 0 ? PerfLog(seconds: seconds) : nil
    }()

    private let lock = NSLock()
    private let start = CACurrentMediaTime()
    private var frames: [[Double]] = []
    private var marks: [String: Double] = [:]

    private init(seconds: Double) {
        DispatchQueue.global().asyncAfter(deadline: .now() + seconds) { self.write() }
    }

    func mark(_ name: String) {
        lock.withLock { marks[name] = CACurrentMediaTime() - start }
    }

    func frame(began: CFTimeInterval, cost: CFTimeInterval, presented: Bool, coverage: Double, inFlight: Int) {
        lock.withLock { frames.append([began - start, cost, presented ? 1 : 0, coverage, Double(inFlight)]) }
    }

    private func write() {
        let body: [String: Any] = lock.withLock {
            ["columns": ["t", "cost", "presented", "coverage", "inFlight"], "frames": frames, "marks": marks]
        }
        let url = URL.cachesDirectory.appending(path: "csp-perf.json")
        if let data = try? JSONSerialization.data(withJSONObject: body) { try? data.write(to: url, options: .atomic) }
    }
}
#endif
