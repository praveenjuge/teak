import Combine
import ConvexMobile
import Foundation

@MainActor
final class AuthViewModel: ObservableObject {
    enum ViewState: Equatable {
        case loading
        case signedOut
        case signingIn(String)
        case signedIn(String)
    }

    @Published private(set) var state: ViewState = .loading
    @Published var errorMessage: String?

    private let sessionStore = SessionStore()
    private let apiClient: AuthAPIClient
    private let convexClient: ConvexClientWithAuth<NativeSession>

    init(config: AppConfig = .current) {
        self.apiClient = AuthAPIClient(config: config)

        let authProvider = TeakAuthProvider(
            sessionStore: sessionStore,
            apiClient: apiClient
        )
        self.convexClient = ConvexClientWithAuth(
            deploymentUrl: config.convexURL,
            authProvider: authProvider
        )

        Task {
            await restoreSessionIfNeeded()
        }
    }

    var isBusy: Bool {
        if case .signingIn = state {
            return true
        }
        return state == .loading
    }

    func signIn() {
        errorMessage = nil
        state = .signingIn("Waiting for browser sign-in...")

        Task {
            do {
                let deviceID = await sessionStore.loadOrCreateDeviceID()
                let request = apiClient.makeBrowserAuthRequest(deviceID: deviceID)
                try apiClient.openBrowser(for: request)
                let convexToken = try await apiClient.pollForBrowserSession(request)
                try await sessionStore.saveSessionToken(convexToken)
                try await refreshAuthenticatedState()
            } catch {
                await sessionStore.clearSessionToken()
                state = .signedOut
                errorMessage = error.localizedDescription
            }
        }
    }

    func logout() {
        errorMessage = nil
        state = .loading

        Task {
            await convexClient.logout()
            state = .signedOut
        }
    }

    private func restoreSessionIfNeeded() async {
        guard await sessionStore.loadSessionToken() != nil else {
            state = .signedOut
            return
        }

        do {
            try await refreshAuthenticatedState()
        } catch {
            await sessionStore.clearSessionToken()
            state = .signedOut
            errorMessage = error.localizedDescription
        }
    }

    private func refreshAuthenticatedState() async throws {
        switch await convexClient.loginFromCache() {
        case .success:
            guard let user = try await apiClient.fetchCurrentUser(with: convexClient) else {
                await sessionStore.clearSessionToken()
                throw AuthServiceError.unauthorized
            }
            state = .signedIn(user.preferredDisplayName)
        case .failure(let error):
            await sessionStore.clearSessionToken()
            throw error
        }
    }
}
