import AuthenticationServices
import Cocoa

@MainActor
final class SafariSignInCoordinator: NSObject, ASWebAuthenticationPresentationContextProviding {
    private weak var anchorWindow: NSWindow?
    private var authenticationSession: ASWebAuthenticationSession?
    private var sessionGeneration = 0
    private var preparing = false
    private var pendingRequest: SafariOAuthRequest?

    var isAuthenticating: Bool {
        preparing || authenticationSession != nil
    }

    var presentingWindow: NSWindow? {
        anchorWindow
    }

    func cancel() {
        sessionGeneration += 1
        pendingRequest?.cancellation.cancel()
        pendingRequest = nil
        preparing = false
        let session = authenticationSession
        authenticationSession = nil
        anchorWindow = nil
        session?.cancel()
    }

    func start(
        presenting window: NSWindow,
        onStateChange: @escaping ([String: Any]) -> Void,
        onCompletion: @escaping ([String: Any]) -> Void
    ) {
        guard !isAuthenticating else { return }
        preparing = true
        sessionGeneration += 1
        let generation = sessionGeneration
        Task { @MainActor in
          do {
            let pending = try await TeakSafariService.shared.prepareSignIn()
            guard generation == sessionGeneration else { return }
            preparing = false
            pendingRequest = pending
            anchorWindow = window
            let session = ASWebAuthenticationSession(
                url: try pending.authorizationURL(),
                callback: .customScheme("teak-safari")
            ) { [weak self] callback, error in
                Task { @MainActor in
                    guard let self else { return }
                    guard generation == self.sessionGeneration else { return }
                    guard let callback, error == nil else {
                        pending.cancellation.cancel()
                        self.pendingRequest = nil
                        self.authenticationSession = nil
                        self.anchorWindow = nil
                        let wasCancelled = (error as? ASWebAuthenticationSessionError)?.code == .canceledLogin
                        onCompletion([
                            "authenticated": false,
                            "message": wasCancelled
                                ? "Sign-in was cancelled. You can try again."
                                : "Unable to complete sign in. Please try again.",
                        ])
                        return
                    }

                    let state = await TeakSafariService.shared.completeSignIn(pending, callback: callback)
                    guard generation == self.sessionGeneration else { return }
                    self.pendingRequest = nil
                    self.authenticationSession = nil
                    self.anchorWindow = nil
                    onCompletion(state)
                }
            }
            session.presentationContextProvider = self
            authenticationSession = session
            onStateChange([
                "authenticated": false,
                "status": SafariAccountStatus.waiting.rawValue,
                "message": "Approve Teak for Mac in your browser.",
            ])
            if !session.start() {
                pending.cancellation.cancel()
                pendingRequest = nil
                authenticationSession = nil
                anchorWindow = nil
                onCompletion([
                    "authenticated": false,
                    "message": "Unable to open sign in. Please try again.",
                ])
            }
        } catch {
            guard generation == sessionGeneration else { return }
            preparing = false
            onCompletion([
                "authenticated": false,
                "message": error.localizedDescription,
            ])
          }
        }
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        anchorWindow ?? ASPresentationAnchor()
    }
}
