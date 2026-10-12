import Foundation

/// Time the system promises before it suspends the process. iOS terminates a
/// process that is suspended while holding a lock on a file in the app group
/// container (`0xdead10cc`), so the credential lock is only held inside one.
public protocol BackgroundActivity: Sendable {
    /// Asks the system to keep the process running until the returned closure
    /// is called. Nil when it won't, because the process is already being
    /// suspended. `onExpiry` runs at most once, on another thread, when the time
    /// runs out; it must give back every lock before it returns.
    func begin(reason: String, onExpiry: @escaping @Sendable () -> Void) async -> (@Sendable () -> Void)?
}

/// The system's background time, from `ProcessInfo` so it works in the app and
/// both extensions. Only iOS kills a process suspended with a lock held, so on
/// the Mac it asks for nothing.
public struct SystemActivity: BackgroundActivity {
    public init() {}

    public func begin(reason: String, onExpiry: @escaping @Sendable () -> Void) async -> (@Sendable () -> Void)? {
        #if os(iOS)
        let run = ExpiringRun()
        return await withCheckedContinuation { continuation in
            // The first call holds the time until it returns. The system calls
            // again, concurrently, with `expired` set when the time runs out, or
            // only with `expired` set when it grants none.
            ProcessInfo.processInfo.performExpiringActivity(withReason: reason) { expired in
                if expired {
                    switch run.end() {
                    case .starting: continuation.resume(returning: nil)
                    case .running:
                        onExpiry()
                        run.finished.signal()
                    case .ended: break
                    }
                } else if run.start() {
                    continuation.resume(returning: {
                        if run.end() == .running { run.finished.signal() }
                    })
                    run.finished.wait()
                }
            }
        }
        #else
        return {}
        #endif
    }
}

#if os(iOS)
/// One `performExpiringActivity` call. Its two invocations run on different
/// queues, so whichever ends it first decides what happens.
private final class ExpiringRun: @unchecked Sendable {
    enum Phase { case starting, running, ended }

    let finished = DispatchSemaphore(value: 0)
    private let mutex = NSLock()
    private var phase = Phase.starting

    func start() -> Bool {
        mutex.withLock {
            guard phase == .starting else { return false }
            phase = .running
            return true
        }
    }

    /// Ends the run, returning the phase it ended from.
    func end() -> Phase {
        mutex.withLock {
            defer { phase = .ended }
            return phase
        }
    }
}
#endif
