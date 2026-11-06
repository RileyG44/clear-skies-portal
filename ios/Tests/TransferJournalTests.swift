import Foundation
import Testing
@testable import EngineSupport

struct TransferJournalTests {
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
}
