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
        state["status"] as? String == "signed-out"
            && state["authenticated"] as? Bool == false
    }
}
