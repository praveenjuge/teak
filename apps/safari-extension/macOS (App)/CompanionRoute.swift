import Foundation

enum CompanionRoute: Equatable {
    case onboarding
    case settings

    static func resolve(from state: [String: Any]) -> CompanionRoute {
        (state["authenticated"] as? Bool) == true ? .settings : .onboarding
    }

    static func shouldStartSignIn(from state: [String: Any], connectRequested: Bool) -> Bool {
        connectRequested && resolve(from: state) == .onboarding
    }

    static func shouldShowOnboardingAfterSignOut(_ state: [String: Any]) -> Bool {
        state["status"] as? String == SafariAccountStatus.signedOut.rawValue
            && state["authenticated"] as? Bool == false
    }

    static func shouldRouteAuthenticationFailure(
        _ state: [String: Any],
        duringExplicitSignOut: Bool
    ) -> Bool {
        guard !duringExplicitSignOut,
              state["authenticated"] as? Bool == false else { return false }
        let status = (state["status"] as? String).flatMap(SafariAccountStatus.init(rawValue:))
        return status != .signedOut && status != .waiting
    }
}

enum CompanionRouteResolution: Equatable {
    case preserveCurrentPresentation
    case present(CompanionRoute, startSignIn: Bool)
}

struct CompanionRoutingState {
    private(set) var generation = 0
    private(set) var connectRequested = false

    mutating func requestConnect() {
        connectRequested = true
    }

    mutating func beginResolution() -> Int {
        generation += 1
        return generation
    }

    mutating func completeResolution(
        generation completedGeneration: Int,
        state: [String: Any],
        isAuthenticating: Bool
    ) -> CompanionRouteResolution? {
        guard completedGeneration == generation else { return nil }
        guard !isAuthenticating else {
            connectRequested = false
            return .preserveCurrentPresentation
        }

        let route = CompanionRoute.resolve(from: state)
        let startSignIn = CompanionRoute.shouldStartSignIn(
            from: state,
            connectRequested: connectRequested
        )
        connectRequested = false
        return .present(route, startSignIn: startSignIn)
    }

    mutating func preserveAuthenticationPresentation() {
        connectRequested = false
    }

    mutating func invalidatePendingResolution() {
        generation += 1
        connectRequested = false
    }
}
