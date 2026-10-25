import Foundation

/// Serializes refresh-token rotation across the app and its extensions. WorkOS
/// rotates the refresh token on every refresh, so two processes refreshing
/// with the same token would sign the person out.
public protocol CredentialLock: Sendable {
    func withLock<T: Sendable>(_ operation: @escaping @Sendable () async throws -> T) async throws -> T
    /// Changes on every sign-out, so a refresh that started before it never saves.
    func epoch() -> String
    func invalidatePendingSaves()
}

extension CredentialLock {
    func isCurrent(_ epoch: String) -> Bool { self.epoch() == epoch }

    func saveUnlessSignedOut(since epoch: String, _ save: @escaping @Sendable () throws -> Void) async throws -> Bool {
        try await withLock {
            guard self.isCurrent(epoch) else { return false }
            try save()
            return true
        }
    }
}

/// An exclusive `flock` on a file in the app group container, held only while
/// the system keeps the process running. When that time runs out, the operation
/// is cancelled and the lock given back before the process is suspended.
public struct FileCredentialLock: CredentialLock {
    let url: URL
    let timeout: TimeInterval
    let activity: any BackgroundActivity

    public init(directory: URL, environment: String, timeout: TimeInterval = 35,
                activity: any BackgroundActivity = SystemActivity()) {
        url = directory.appending(path: "workos-session.\(environment).lock")
        self.timeout = timeout
        self.activity = activity
    }

    public func withLock<T: Sendable>(_ operation: @escaping @Sendable () async throws -> T) async throws -> T {
        let hold = LockHold()
        guard let finish = await activity.begin(reason: "Refreshing Teak sign-in", onExpiry: { hold.expire() }) else {
            throw Self.busy
        }
        defer { finish() }
        let descriptor = open(url.path, O_CREAT | O_RDWR | O_NOFOLLOW | O_CLOEXEC, S_IRUSR | S_IWUSR)
        guard descriptor >= 0 else { throw TeakError(message: tr("native.errors.sharedStorage")) }
        defer { close(descriptor) }
        let deadline = Date().addingTimeInterval(timeout)
        var attempt = hold.lock(descriptor)
        while attempt == .busy, Date() < deadline {
            try await Task.sleep(for: .milliseconds(50))
            attempt = hold.lock(descriptor)
        }
        guard attempt == .locked else { throw Self.busy }
        defer { hold.release() }
        let task = Task { try await operation() }
        hold.onExpiry { task.cancel() }
        return try await withTaskCancellationHandler { try await task.value } onCancel: { task.cancel() }
    }

    private static var busy: TeakError { TeakError(message: tr("native.errors.busy")) }

    private var epochURL: URL { url.appendingPathExtension("epoch") }

    public func epoch() -> String {
        (try? String(contentsOf: epochURL, encoding: .utf8)) ?? ""
    }

    public func invalidatePendingSaves() {
        try? Data(UUID().uuidString.utf8).write(to: epochURL, options: .atomic)
    }
}

private final class LockHold: @unchecked Sendable {
    /// How long expiry waits for a cancelled operation to unlock on its own. An
    /// expiry handler has about a second before the watchdog steps in.
    static let grace: TimeInterval = 0.5

    enum Attempt { case locked, busy, failed }

    private let mutex = NSLock()
    private let released = DispatchSemaphore(value: 0)
    private var descriptor: Int32?
    private var cancel: (@Sendable () -> Void)?
    private var expired = false

    func lock(_ descriptor: Int32) -> Attempt {
        mutex.withLock {
            guard !expired else { return .failed }
            guard flock(descriptor, LOCK_EX | LOCK_NB) == 0 else { return errno == EWOULDBLOCK ? .busy : .failed }
            self.descriptor = descriptor
            return .locked
        }
    }

    func onExpiry(_ cancel: @escaping @Sendable () -> Void) {
        let expired = mutex.withLock {
            self.cancel = cancel
            return self.expired
        }
        if expired { cancel() }
    }

    func release() {
        mutex.withLock {
            guard let descriptor else { return }
            flock(descriptor, LOCK_UN)
            self.descriptor = nil
            released.signal()
        }
    }

    /// Cancels the operation and waits briefly for it to unlock. One that can't
    /// stop in time loses the lock anyway: a process suspended holding it is killed.
    func expire() {
        let (holding, cancel) = mutex.withLock {
            expired = true
            return (descriptor != nil, self.cancel)
        }
        guard holding else { return }
        cancel?()
        if released.wait(timeout: .now() + Self.grace) == .timedOut { release() }
    }
}
