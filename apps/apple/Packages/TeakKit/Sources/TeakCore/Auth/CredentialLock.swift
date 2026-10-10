import Foundation

/// Serializes refresh-token rotation across the app and its extensions. WorkOS
/// rotates the refresh token on every refresh, so two processes refreshing
/// with the same token would sign the person out.
public protocol CredentialLock: Sendable {
    func withLock<T: Sendable>(_ operation: @Sendable () async throws -> T) async throws -> T
    /// Changes on every sign-out, so a refresh that started before it never saves.
    func epoch() -> String
    func advanceEpoch()
}

/// An exclusive `flock` on a file in the app group container.
public struct FileCredentialLock: CredentialLock {
    let url: URL
    let timeout: TimeInterval

    public init(directory: URL, environment: String, timeout: TimeInterval = 35) {
        url = directory.appending(path: "workos-session.\(environment).lock")
        self.timeout = timeout
    }

    public func withLock<T: Sendable>(_ operation: @Sendable () async throws -> T) async throws -> T {
        let descriptor = open(url.path, O_CREAT | O_RDWR | O_NOFOLLOW | O_CLOEXEC, S_IRUSR | S_IWUSR)
        guard descriptor >= 0 else { throw TeakError(message: "Unable to access Teak's shared storage.") }
        defer { close(descriptor) }
        let deadline = Date().addingTimeInterval(timeout)
        while flock(descriptor, LOCK_EX | LOCK_NB) != 0 {
            guard errno == EWOULDBLOCK, Date() < deadline else {
                throw TeakError(message: "Teak is busy. Please try again.")
            }
            try await Task.sleep(for: .milliseconds(50))
        }
        defer { flock(descriptor, LOCK_UN) }
        return try await operation()
    }

    private var epochURL: URL { url.appendingPathExtension("epoch") }

    public func epoch() -> String {
        (try? String(contentsOf: epochURL, encoding: .utf8)) ?? ""
    }

    public func advanceEpoch() {
        try? Data(UUID().uuidString.utf8).write(to: epochURL, options: .atomic)
    }
}
