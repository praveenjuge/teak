import AuthenticationServices
import SwiftUI
import TeakCore

/// The first screen: what Teak is, and the ways to sign in.
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
                Text("Save Anything. Anywhere.")
                    .font(.title2.bold())
                Text("Your personal everything management system. Organize, save, and access all your text, images, and documents in one place.")
                    .font(.body)
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 32)
            if app.authMode?.signupsDisabled == true {
                Text(TeakMessages.signupsPaused)
                    .padding(.bottom, 16)
            }
            VStack(spacing: 30) {
                VStack(spacing: 12) {
                    signInButton(.apple) {
                        Label(title(.apple, "Continue with Apple"), systemImage: "apple.logo")
                    }
                    signInButton(.google) {
                        Label {
                            Text(title(.google, "Continue with Google"))
                        } icon: {
                            Image("GoogleLogo").resizable().frame(width: 18, height: 18)
                        }
                    }
                    if app.authMode?.signupsDisabled == false {
                        signInButton(.emailSignUp) { Text(title(.emailSignUp, "Register with Email")) }
                    }
                }
                signInButton(.emailSignIn) { Text(title(.emailSignIn, "Login with Email")) }
            }
        }
        .padding(.horizontal, 28)
        .padding(.top, 32)
        .padding(.bottom, 12)
        .frame(maxWidth: 480, maxHeight: .infinity)
        .frame(maxWidth: .infinity)
        .alert(failure?.title ?? "", isPresented: .constant(failure != nil), presenting: failure) { _ in
            Button("OK") { failure = nil }
        } message: { failure in
            Text(failure.message)
        }
    }

    private func title(_ method: SignInMethod, _ idle: String) -> String {
        pending == method ? "Signing in…" : idle
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
                _ = try await app.signIn(method, using: webAuthentication)
            } catch {
                let message = (error as? TeakError)?.message
                failure = ("\(method.label) Sign In Failed",
                           message ?? "Failed to sign in with \(method.label). Please try again.")
            }
        }
    }
}

#Preview {
    WelcomeView().environment(AppModel())
}
