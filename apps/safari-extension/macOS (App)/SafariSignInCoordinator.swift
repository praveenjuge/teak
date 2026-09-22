import AuthenticationServices
import Cocoa

@MainActor
final class SafariSignInCoordinator: NSObject, ASWebAuthenticationPresentationContextProviding {
    private weak var anchorWindow: NSWindow?
    private var authenticationSession: ASWebAuthenticationSession?
    private var sessionGeneration = 0

    var isAuthenticating: Bool {
        authenticationSession != nil
    }

    var presentingWindow: NSWindow? {
        anchorWindow
    }

    func cancel() {
        sessionGeneration += 1
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
        guard authenticationSession == nil else { return }

        do {
            let pending = try SafariOAuthRequest()
            sessionGeneration += 1
            let generation = sessionGeneration
            anchorWindow = window
            let session = ASWebAuthenticationSession(
                url: pending.authorizationURL(baseURL: TeakSafariService.appBaseURL),
                callback: .customScheme("teak-safari")
            ) { [weak self] callback, error in
                Task { @MainActor in
                    guard let self else { return }
                    guard generation == self.sessionGeneration else { return }
                    guard let callback, error == nil else {
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
                "message": "Approve Teak Safari in your browser.",
            ])
            if !session.start() {
                authenticationSession = nil
                anchorWindow = nil
                onCompletion([
                    "authenticated": false,
                    "message": "Unable to open sign in. Please try again.",
                ])
            }
        } catch {
            onCompletion([
                "authenticated": false,
                "message": error.localizedDescription,
            ])
        }
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        anchorWindow ?? ASPresentationAnchor()
    }
}
