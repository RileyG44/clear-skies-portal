import BackgroundTasks
import CSKEngine
import UIKit
import os

/// Platform execution grants. The Rust journals remain the job authority;
/// expiration closes its cooperative gate rather than cancelling saved work.
final class EngineBackground {
    static let shared = EngineBackground()
    private static let prefix = Bundle.main.bundleIdentifier ?? "dev.riley.ClearSkies"
    static let processingID = prefix + ".terrain-processing"
    static let continuedPattern = prefix + ".terrain-continued.*"
    private let log = Logger(subsystem: prefix, category: "background")
    private var grants: [String: BGTask] = [:]
    private var continuedRequest: String?
    private var grace = UIBackgroundTaskIdentifier.invalid
    private var monitor: Task<Void, Never>?
    private var foreground = UIApplication.shared.applicationState != .background
    private var memoryLimited = false
    private var memorySource: (any DispatchSourceMemoryPressure)?
    private var thermalObserver: NSObjectProtocol?

    private var runtime: EngineRuntime? { EngineRuntime.shared }
    private var status: CskWorkStatus { runtime.map { csk_engine_work_status($0.handle) } ?? CskWorkStatus() }

    func register() {
        for identifier in [Self.processingID, Self.continuedPattern] {
            let registered = BGTaskScheduler.shared.register(forTaskWithIdentifier: identifier, using: .main) { task in
                MainActor.assumeIsolated { Self.shared.start(task) }
            }
            if !registered { log.error("Background handler registration failed: \(identifier, privacy: .public)") }
        }
        let source = DispatchSource.makeMemoryPressureSource(eventMask: [.normal, .warning, .critical], queue: .main)
        source.setEventHandler {
            MainActor.assumeIsolated {
                let owner = Self.shared
                owner.memoryLimited = source.data.contains(.critical)
                if !source.data.contains(.normal), let runtime = owner.runtime { csk_engine_purge_memory(runtime.handle) }
                owner.applyExecution()
            }
        }
        memorySource = source
        source.resume()
        thermalObserver = NotificationCenter.default.addObserver(forName: ProcessInfo.thermalStateDidChangeNotification,
                                                                object: nil, queue: .main) { _ in
            MainActor.assumeIsolated { Self.shared.applyExecution() }
        }
    }

    func becameActive() {
        foreground = true
        endGrace()
        applyExecution()
        if status.pending { startMonitor() }
    }

    func enteredBackground() {
        foreground = false
        if status.cpu_pending { beginGrace() }
        applyExecution()
        scheduleProcessing()
        if status.pending { startMonitor() }
    }

    /// Called only for an accepted, user-started offline-area request.
    func userStartedJob() {
        guard status.pending else { return }
        scheduleProcessing()
        startMonitor()
        guard foreground, continuedRequest == nil,
              !grants.values.contains(where: { $0 is BGContinuedProcessingTask }) else { return }
        let identifier = Self.prefix + ".terrain-continued." + UUID().uuidString
        let request = BGContinuedProcessingTaskRequest(identifier: identifier, title: "Preparing terrain",
                                                        subtitle: "Saving your offline area")
        // The foreground keeps making progress if an immediate grant is
        // unavailable. Deferred processing is already scheduled.
        request.strategy = .fail
        do {
            continuedRequest = identifier
            try BGTaskScheduler.shared.submit(request)
        } catch {
            continuedRequest = nil
            log.notice("Continued processing unavailable: \(error.localizedDescription, privacy: .public)")
        }
    }

    /// The URLSession delegate has persisted an archive. A short grant may
    /// finish ingestion now; the deferred request also covers longer work.
    func archiveReady() {
        if !foreground && status.pending { beginGrace() }
        applyExecution()
        scheduleProcessing()
        if status.pending { startMonitor() }
    }

    private func start(_ task: BGTask) {
        guard status.pending else { task.setTaskCompleted(success: true); return }
        grants[task.identifier] = task
        task.expirationHandler = { [identifier = task.identifier] in
            Task { @MainActor in Self.shared.expire(identifier) }
        }
        applyExecution()
        startMonitor()
    }

    private func expire(_ identifier: String) {
        guard let task = grants.removeValue(forKey: identifier) else { return }
        if continuedRequest == identifier { continuedRequest = nil }
        task.expirationHandler = nil
        applyExecution()
        task.setTaskCompleted(success: false)
        scheduleProcessing()
    }

    private func applyExecution() {
        guard let runtime else { return }
        let available = os_proc_available_memory()
        csk_engine_set_memory_limit(runtime.handle, min(256 << 20, available / 2))
        let granted = foreground || grace != .invalid || !grants.isEmpty
        csk_engine_set_work_allowed(runtime.handle, granted && !memoryLimited && ProcessInfo.processInfo.thermalState != .critical)
    }

    private func beginGrace() {
        guard grace == .invalid else { return }
        grace = UIApplication.shared.beginBackgroundTask(withName: "Prepare downloaded terrain") {
            MainActor.assumeIsolated {
                Self.shared.endGrace()
                Self.shared.applyExecution()
                Self.shared.scheduleProcessing()
            }
        }
    }

    private func endGrace() {
        guard grace != .invalid else { return }
        let identifier = grace
        grace = .invalid
        UIApplication.shared.endBackgroundTask(identifier)
    }

    private func scheduleProcessing() {
        guard status.pending else { return }
        let request = BGProcessingTaskRequest(identifier: Self.processingID)
        // Finished archives can be ingested with no network. Foreground
        // tiles and the separate system download session own networking.
        request.requiresNetworkConnectivity = false
        request.earliestBeginDate = Date(timeIntervalSinceNow: 60)
        do { try BGTaskScheduler.shared.submit(request) }
        catch { log.notice("Deferred terrain processing unavailable: \(error.localizedDescription, privacy: .public)") }
    }

    private func startMonitor() {
        guard monitor == nil else { return }
        monitor = Task { [weak self] in
            while !Task.isCancelled {
                guard let self else { return }
                let snapshot = status
                for task in grants.values {
                    if let task = task as? BGContinuedProcessingTask {
                        let total = max(1, Int64(clamping: snapshot.total))
                        task.progress.totalUnitCount = total
                        task.progress.completedUnitCount = min(Int64(clamping: snapshot.completed), snapshot.pending ? total - 1 : total)
                    }
                }
                if !snapshot.pending || !snapshot.cpu_pending {
                    // Transfers belong to URLSession and need no CPU grant.
                    // A completion event schedules the next ingest unit.
                    for task in grants.values {
                        task.expirationHandler = nil
                        task.setTaskCompleted(success: !snapshot.failed)
                    }
                    grants.removeAll()
                    if let identifier = continuedRequest { BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: identifier) }
                    continuedRequest = nil
                    endGrace()
                    applyExecution()
                    if !snapshot.pending { BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: Self.processingID) }
                }
                if !snapshot.pending || (!foreground && grants.isEmpty && grace == .invalid) {
                    monitor = nil
                    return
                }
                do { try await Task.sleep(for: .seconds(1)) } catch { return }
            }
        }
    }
}
