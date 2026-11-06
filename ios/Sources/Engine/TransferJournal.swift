import CryptoKit
import Foundation

/// Durable ownership of downloaded archives. Callers serialize access.
/// The system task owns a transfer until completion; this journal owns its
/// completed file until the engine acknowledges publication (or rejection).
nonisolated final class TransferJournal {
    enum State: String, Codable, Sendable { case transferring, ready }

    struct Record: Codable, Sendable {
        let url: String
        let maxBytes: UInt64
        let created: Date
        var state: State
        var status: Int?
        var headers: String?
        var bytes: UInt64?
        var completed: Date?
        var received: UInt64?
    }

    enum Failure: Error, Equatable { case invalidRecord, missingFile, tooLarge, notEnoughStorage }

    struct Storage: Sendable {
        let reserve: @Sendable (String, UInt64) throws -> Void
        let release: @Sendable (String) -> Void
        let reconcile: @Sendable (String, [String]) throws -> Void
    }

    let directory: URL
    private let files = FileManager.default
    private let storage: Storage?

    init(directory: URL, storage: Storage? = nil) throws {
        self.directory = directory
        self.storage = storage
        try files.createDirectory(at: directory, withIntermediateDirectories: true)
        try storage?.reconcile("transfer-copy:", [])
        var excluded = directory
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try excluded.setResourceValues(values)
        #if os(iOS)
        try files.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
                                ofItemAtPath: directory.path)
        #endif
    }

    /// Only public GET archives use this journal. Cookies are short-lived
    /// session details and are deliberately excluded from durable identity.
    static func key(for url: URL) -> String {
        SHA256.hash(data: Data(("GET\n" + url.absoluteString).utf8)).map { String(format: "%02x", $0) }.joined()
    }

    static func validKey(_ key: String) -> Bool {
        key.count == 64 && key.utf8.allSatisfy { (48...57).contains($0) || (97...102).contains($0) }
    }

    func payload(_ key: String) -> URL { directory.appending(path: key + ".archive") }
    private func manifest(_ key: String) -> URL { directory.appending(path: key + ".json") }

    func read(_ key: String) throws -> Record {
        guard Self.validKey(key) else { throw Failure.invalidRecord }
        let record = try JSONDecoder().decode(Record.self, from: Data(contentsOf: manifest(key)))
        guard let url = URL(string: record.url), Self.key(for: url) == key,
              record.maxBytes > 0, record.maxBytes <= 2 << 30,
              (record.received ?? 0) <= record.maxBytes else { throw Failure.invalidRecord }
        return record
    }

    func prepare(url: URL, maxBytes: UInt64) throws -> String {
        guard maxBytes > 0, maxBytes <= 2 << 30 else { throw Failure.tooLarge }
        let key = Self.key(for: url)
        if let previous = try? read(key), previous.maxBytes == maxBytes {
            try storage?.reserve("transfer:" + key, previous.state == .ready ? 0 : maxBytes - min(maxBytes, previous.received ?? 0))
            return key
        }
        remove(key)
        try storage?.reserve("transfer:" + key, maxBytes)
        let record = Record(url: url.absoluteString, maxBytes: maxBytes, created: Date(), state: .transferring)
        do { try save(record, key: key) }
        catch { storage?.release("transfer:" + key); throw error }
        return key
    }

    /// Completed bytes already reduce filesystem availability. Checkpointing
    /// future growth avoids counting them again; an interrupted checkpoint is
    /// conservative because it leaves a larger outstanding claim.
    func progress(_ key: String, received: UInt64, force: Bool = false) throws {
        var record = try read(key)
        guard record.state == .transferring, received <= record.maxBytes else { return }
        let previous = record.received ?? 0
        let restarted = received < previous
        guard force || restarted || (received >= previous && received - previous >= 16 << 20) else { return }
        // URLSession can restart a partial transfer. Its discarded bytes no
        // longer occupy disk, so reclaim future growth before accepting it.
        if restarted { try storage?.reserve("transfer:" + key, record.maxBytes - received) }
        record.received = received
        try save(record, key: key)
        if !restarted { try storage?.reserve("transfer:" + key, record.maxBytes - received) }
    }

    private func save(_ record: Record, key: String) throws {
        try JSONEncoder().encode(record).write(to: manifest(key), options: .atomic)
    }

    func finish(_ key: String, temporary: URL, status: Int, headers: String) throws {
        var record = try read(key)
        let bytes = try size(of: temporary)
        guard bytes <= record.maxBytes else { throw Failure.tooLarge }
        // Rename the OS temporary file before its delegate returns. A crash
        // before the manifest commit leaves an uncommitted payload, never ready.
        try? files.removeItem(at: payload(key))
        try files.moveItem(at: temporary, to: payload(key))
        #if os(iOS)
        try files.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
                                ofItemAtPath: payload(key).path)
        #endif
        record.state = .ready
        record.status = status
        record.headers = headers
        record.bytes = bytes
        record.completed = Date()
        try save(record, key: key)
        storage?.release("transfer:" + key)
    }

    func deliver(_ key: String, to destination: URL, maxBytes: UInt64) throws -> Record {
        let record = try read(key)
        guard record.state == .ready, let expected = record.bytes,
              record.status != nil, record.headers != nil else { throw Failure.invalidRecord }
        let bytes = try size(of: payload(key))
        guard bytes == expected else { throw Failure.missingFile }
        guard bytes <= maxBytes else { throw Failure.tooLarge }
        try files.createDirectory(at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? files.removeItem(at: destination)
        // Same-volume hard links avoid a second archive allocation. The
        // journal's link survives extraction-folder cleanup after a restart.
        do { try files.linkItem(at: payload(key), to: destination) }
        catch {
            let copyKey = "transfer-copy:" + key + ":" + Self.key(for: destination)
            try storage?.reserve(copyKey, bytes)
            defer { storage?.release(copyKey) }
            try files.copyItem(at: payload(key), to: destination)
        }
        return record
    }

    func remove(_ key: String) {
        guard Self.validKey(key) else { return }
        try? files.removeItem(at: manifest(key))
        try? files.removeItem(at: payload(key))
        storage?.release("transfer:" + key)
    }

    func keys() -> [String] {
        ((try? files.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)) ?? [])
            .filter { $0.pathExtension == "json" }.map { $0.deletingPathExtension().lastPathComponent }
            .filter(Self.validKey)
    }

    /// Retain live system tasks and recent completed files. Sweep failed or
    /// abandoned work without touching files outside this journal's namespace.
    @discardableResult func reconcile(active: Set<String>, now: Date = Date()) -> Set<String> {
        var refused: Set<String> = []
        for key in keys() {
            guard let record = try? read(key) else { remove(key); continue }
            if active.contains(key) {
                do { try storage?.reserve("transfer:" + key, record.state == .ready ? 0 : record.maxBytes - min(record.maxBytes, record.received ?? 0)) }
                catch { refused.insert(key) }
                continue
            }
            if record.state != .ready || now.timeIntervalSince(record.completed ?? record.created) > 24 * 3600 {
                remove(key)
            } else if (try? size(of: payload(key))) != record.bytes {
                remove(key)
            } else {
                storage?.release("transfer:" + key)
            }
        }
        let known = Set(keys())
        for url in (try? files.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)) ?? [] {
            let key = url.deletingPathExtension().lastPathComponent
            if url.pathExtension == "archive", Self.validKey(key), !known.contains(key) {
                try? files.removeItem(at: url)
            }
        }
        try? storage?.reconcile("transfer:", keys().map { "transfer:" + $0 })
        return refused
    }

    private func size(of url: URL) throws -> UInt64 {
        // URL resource values can retain an old size across file replacement.
        guard let size = try files.attributesOfItem(atPath: url.path)[.size] as? NSNumber else {
            throw Failure.missingFile
        }
        return size.uint64Value
    }
}
