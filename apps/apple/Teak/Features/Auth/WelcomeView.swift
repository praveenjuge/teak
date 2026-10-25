import AuthenticationServices
import SwiftUI
import TeakCore

struct WelcomeView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.webAuthenticationSession) private var webAuthentication
    @State private var pending: SignInMethod?
    @State private var failure: (title: String, message: String)?

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 12) {
                Image("Wordmark")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 92)
                    .foregroundStyle(.tint)
                    .accessibilityLabel("Teak")
                Text(tr("native.auth.tagline"))
                    .font(.title2.bold())
                Text(tr("native.auth.intro"))
                    .font(.body)
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 32)
            if app.authMode?.signupsDisabled == true {
                Text(tr("native.errors.signupsPaused"))
                    .padding(.bottom, 16)
            }
            VStack(spacing: 30) {
                VStack(spacing: 12) {
                    signInButton(.apple) {
                        Label(title(.apple, tr("native.auth.continueWithApple")), systemImage: "apple.logo")
                    }
                    signInButton(.google) {
                        Label {
                            Text(title(.google, tr("native.auth.continueWithGoogle")))
                        } icon: {
                            Image("GoogleLogo").resizable().frame(width: 18, height: 18)
                        }
                    }
                    if app.authMode?.signupsDisabled == false {
                        signInButton(.emailSignUp) { Text(title(.emailSignUp, tr("native.auth.registerWithEmail"))) }
                    }
                }
                signInButton(.emailSignIn) { Text(title(.emailSignIn, tr("native.auth.signInWithEmail"))) }
            }
        }
        .padding(.horizontal, 28)
        .padding(.top, 32)
        .padding(.bottom, 12)
        .frame(maxWidth: 480, maxHeight: .infinity)
        .frame(maxWidth: .infinity)
        .alert(failure?.title ?? "", isPresented: Binding(presenting: $failure), presenting: failure) { _ in
            Button(tr("native.app.ok")) { failure = nil }
        } message: { failure in
            Text(failure.message)
        }
    }

    private func title(_ method: SignInMethod, _ idle: String) -> String {
        pending == method ? tr("native.auth.signingIn") : idle
    }

    private func signInButton(_ method: SignInMethod, @ViewBuilder label: () -> some View) -> some View {
        Button {
            signIn(method)
        } label: {
            label()
                .font(.body.weight(.medium))
                .frame(maxWidth: .infinity)
        }
        .buttonStyle(.bordered)
        .controlSize(.large)
        .tint(.primary)
        .disabled(pending != nil)
        .accessibilityIdentifier("signIn.\(method.rawValue)")
    }

    private func signIn(_ method: SignInMethod) {
        guard pending == nil else { return }
        pending = method
        Task {
            defer { pending = nil }
            do {
                try await app.signIn(method, using: webAuthentication)
            } catch {
                let message = (error as? TeakError)?.message
                failure = (tr("native.auth.failedTitle"), message ?? Self.failure(method))
            }
        }
    }

    private static func failure(_ method: SignInMethod) -> String {
        switch method {
        case .apple: tr("native.auth.failedApple")
        case .google: tr("native.auth.failedGoogle")
        case .emailSignUp, .emailSignIn: tr("native.auth.failedEmail")
        }
    }
}

#Preview {
    WelcomeView().environment(AppModel())
}
