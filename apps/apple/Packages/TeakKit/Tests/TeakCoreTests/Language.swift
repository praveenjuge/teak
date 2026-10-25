import Foundation
import Testing
@testable import TeakCore

/// `AppLanguage` is one value for the whole process, and Swift Testing runs suites in
/// parallel, so every suite takes one of these traits:
///
/// - `.english`: the suite's text is in English. These suites run alongside each other.
/// - `.switchesLanguage`: the suite changes `AppLanguage`. It runs while no other suite
///   that takes a trait runs, and the language it found is restored when it ends.
///
/// `AppLanguage.use` saves the language in the app group, so whatever was saved there
/// is put back whenever no suite holds the lock.
///
/// `tr` reads the language as a test runs, so `.english` covers text from Teak's code
/// too. Test arguments are evaluated before any trait applies, so pass text as a closure.
struct LanguageTrait: SuiteTrait, TestTrait, TestScoping {
    let exclusive: Bool

    func provideScope(for test: Test, testCase: Test.Case?,
                      performing function: @Sendable () async throws -> Void) async throws {
        if let held = LanguageLock.held {
            if exclusive && !held { Issue.record("A test that switches the language can't run inside an .english suite") }
            return try await function()
        }
        await LanguageLock.shared.acquire(exclusive: exclusive)
        let before = AppLanguage.current
        if !exclusive && before != "en" { AppLanguage.use("en") }
        do {
            try await LanguageLock.$held.withValue(exclusive) { try await function() }
        } catch {
            if exclusive { AppLanguage.use(before) }
            await LanguageLock.shared.release(exclusive: exclusive)
            throw error
        }
        if exclusive { AppLanguage.use(before) }
        await LanguageLock.shared.release(exclusive: exclusive)
    }
}

extension Trait where Self == LanguageTrait {
    static var english: Self { LanguageTrait(exclusive: false) }
    static var switchesLanguage: Self { LanguageTrait(exclusive: true) }
}

/// A readers-writer lock that grants in arrival order, so a waiting `.switchesLanguage`
/// suite isn't starved by `.english` suites that start after it.
actor LanguageLock {
    static let shared = LanguageLock()

    /// Whether this task holds the lock, and exclusively.
    @TaskLocal static var held: Bool?

    private var readers = 0
    private var writing = false
    /// What the app group held when the lock was last taken from idle.
    private var saved: String?
    private var waiting: [(exclusive: Bool, continuation: CheckedContinuation<Void, Never>)] = []

    func acquire(exclusive: Bool) async {
        if waiting.isEmpty && readers == 0 && !writing { saved = Self.defaults?.string(forKey: Self.key) }
        if waiting.isEmpty && take(exclusive: exclusive) { return }
        await withCheckedContinuation { waiting.append((exclusive, $0)) }
    }

    func release(exclusive: Bool) {
        if exclusive { writing = false } else { readers -= 1 }
        while let next = waiting.first, take(exclusive: next.exclusive) {
            waiting.removeFirst()
            next.continuation.resume()
        }
        guard readers == 0, !writing else { return }
        let defaults = Self.defaults
        if let saved { defaults?.set(saved, forKey: Self.key) } else { defaults?.removeObject(forKey: Self.key) }
        AppLanguage.reload()
    }

    private func take(exclusive: Bool) -> Bool {
        if writing || (exclusive && readers > 0) { return false }
        if exclusive { writing = true } else { readers += 1 }
        return true
    }

    /// Where `AppLanguage` saves the language when there's no app config, as in tests.
    private static var defaults: UserDefaults? { UserDefaults(suiteName: "group.com.praveenjuge.teak") }
    private static let key = "teak.language"
}
