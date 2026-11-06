import Foundation
import Testing
@testable import EngineSupport

struct TransferJournalTests {
    private final class Disk: @unchecked Sendable {
        private let lock = NSLock()
        private var claims: [String: UInt64] = [:]
        private var limit: UInt64
        init(_ limit: UInt64) { self.limit = limit }
        var total: UInt64 { lock.withLock { claims.values.reduce(0,+) } }
        func setLimit(_ limit: UInt64) { lock.withLock { self.limit = limit } }
        var storage: TransferJournal.Storage {
            .init(reserve: { [self] key, bytes in
                try lock.withLock {
                    let previous = claims[key] ?? 0
                    if bytes > previous && claims.values.reduce(0,+) - previous + bytes > limit {
                        throw TransferJournal.Failure.notEnoughStorage
                    }
                    claims[key] = bytes
                }
            }, release: { [self] key in _ = lock.withLock { claims.removeValue(forKey: key) } },
            reconcile: { [self] prefix, live in
                lock.withLock { claims = claims.filter { !$0.key.hasPrefix(prefix) || live.contains($0.key) } }
            })
        }
    }
    private func directory() throws -> URL {
        let dir = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    @Test func completedArchiveSurvivesRelaunchAndStagingCleanupUntilAcknowledged() throws {
        let dir = try directory()
        defer { try? FileManager.default.removeItem(at: dir) }
        let journal = try TransferJournal(directory: dir.appending(path: "journal"))
        let key = try journal.prepare(url: URL(string: "https://lidarportal.dnr.wa.gov/download?ids=1603")!, maxBytes: 100)
        let temporary = dir.appending(path: "os-temporary")
        try Data([1, 2, 3, 4]).write(to: temporary)
        try journal.finish(key, temporary: temporary, status: 200, headers: "Content-Type: application/zip")
        let destination = dir.appending(path: "staging/archive")
        _ = try journal.deliver(key, to: destination, maxBytes: 100)
        try FileManager.default.removeItem(at: destination.deletingLastPathComponent())

        let relaunched = try TransferJournal(directory: journal.directory)
        relaunched.reconcile(active: [])
        let record = try relaunched.deliver(key, to: destination, maxBytes: 100)
        #expect(record.status == 200)
        #expect(try Data(contentsOf: destination) == Data([1, 2, 3, 4]))
        relaunched.remove(key)
        #expect(!FileManager.default.fileExists(atPath: relaunched.payload(key).path))
        #expect(try Data(contentsOf: destination) == Data([1, 2, 3, 4]))
    }

    @Test func sizeLimitsApplyBeforePublicationAndForEachConsumer() throws {
        let dir = try directory()
        defer { try? FileManager.default.removeItem(at: dir) }
        let journal = try TransferJournal(directory: dir.appending(path: "journal"))
        let key = try journal.prepare(url: URL(string: "https://example.test/archive")!, maxBytes: 3)
        let temporary = dir.appending(path: "download")
        try Data([1, 2, 3, 4]).write(to: temporary)
        #expect(throws: TransferJournal.Failure.tooLarge) {
            try journal.finish(key, temporary: temporary, status: 200, headers: "")
        }
        #expect(try journal.read(key).state == .transferring)
        try Data([1, 2, 3]).write(to: temporary)
        try journal.finish(key, temporary: temporary, status: 200, headers: "")
        #expect(throws: TransferJournal.Failure.tooLarge) {
            try journal.deliver(key, to: dir.appending(path: "out"), maxBytes: 2)
        }
    }

    @Test func reconciliationRetainsSystemTasksAndSweepsMissingExpiredAndOrphanFiles() throws {
        let dir = try directory()
        defer { try? FileManager.default.removeItem(at: dir) }
        let journal = try TransferJournal(directory: dir)
        let active = try journal.prepare(url: URL(string: "https://example.test/active")!, maxBytes: 10)
        let abandoned = try journal.prepare(url: URL(string: "https://example.test/abandoned")!, maxBytes: 10)
        let missing = try journal.prepare(url: URL(string: "https://example.test/missing")!, maxBytes: 10)
        let temporary = dir.appending(path: "temporary")
        try Data([1]).write(to: temporary)
        try journal.finish(missing, temporary: temporary, status: 200, headers: "")
        try FileManager.default.removeItem(at: journal.payload(missing))
        let orphan = TransferJournal.key(for: URL(string: "https://example.test/orphan")!)
        try Data([1]).write(to: journal.payload(orphan))
        journal.reconcile(active: [active])
        #expect(journal.keys() == [active])
        #expect(!journal.keys().contains(abandoned))
        #expect(!FileManager.default.fileExists(atPath: journal.payload(orphan).path))

        try Data([1]).write(to: temporary)
        try journal.finish(active, temporary: temporary, status: 200, headers: "")
        journal.reconcile(active: [], now: Date().addingTimeInterval(25 * 3600))
        #expect(journal.keys().isEmpty)
        #expect(throws: TransferJournal.Failure.invalidRecord) { try journal.read("../../escape") }
    }

    @Test func admissionPersistsAcrossWaitersAndReleasesOnlyMaterializedGrowth() throws {
        let dir = try directory()
        defer { try? FileManager.default.removeItem(at: dir) }
        let disk = Disk(100 << 20)
        let journal = try TransferJournal(directory: dir, storage: disk.storage)
        let url = URL(string: "https://example.test/first")!
        let first = try journal.prepare(url: url, maxBytes: 60 << 20)
        #expect(disk.total == 60 << 20)
        _ = try journal.prepare(url: url, maxBytes: 60 << 20)
        #expect(disk.total == 60 << 20)
        #expect(throws: TransferJournal.Failure.notEnoughStorage) {
            _ = try journal.prepare(url: URL(string: "https://example.test/second")!, maxBytes: 50 << 20)
        }
        #expect(journal.keys() == [first])
        try journal.progress(first, received: 20 << 20)
        #expect(disk.total == 40 << 20)
        let relaunched = try TransferJournal(directory: dir, storage: disk.storage)
        #expect(relaunched.reconcile(active: [first]).isEmpty)
        #expect(disk.total == 40 << 20)
        // If URLSession discards a partial file, future growth must be admitted
        // again before the restarted transfer can consume it.
        disk.setLimit(45 << 20)
        #expect(throws: TransferJournal.Failure.notEnoughStorage) { try relaunched.progress(first, received: 0) }
        #expect(try relaunched.read(first).received == 20 << 20)
        disk.setLimit(100 << 20)
        try relaunched.progress(first, received: 0)
        #expect(disk.total == 60 << 20)
        let temporary = dir.appending(path: "temporary")
        try Data([1,2,3]).write(to: temporary)
        try relaunched.finish(first, temporary: temporary, status: 200, headers: "")
        #expect(disk.total == 0)
        #expect(try Data(contentsOf: relaunched.payload(first)) == Data([1,2,3]))
        relaunched.remove(first)
    }
}
