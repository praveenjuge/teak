//
//  ContentView.swift
//  Teak
//
//  Created by Praveen Juge on 23/03/26.
//

import SwiftUI

struct ContentView: View {
    @StateObject private var viewModel = AuthViewModel()

    var body: some View {
        Group {
            switch viewModel.state {
            case .loading:
                ProgressView()
                    .controlSize(.large)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            case .signedOut, .signingIn:
                LoginScreen(viewModel: viewModel)
            case .signedIn(let username):
                WelcomeScreen(username: username, onLogout: viewModel.logout)
            }
        }
        .frame(minWidth: 480, minHeight: 560)
        .background(Color(nsColor: .windowBackgroundColor))
    }
}

#Preview {
    ContentView()
}

private struct LoginScreen: View {
    @ObservedObject var viewModel: AuthViewModel

    var body: some View {
        VStack(spacing: 20) {
            Spacer()

            Text("Login to Teak")
                .font(.title2)
                .frame(maxWidth: .infinity, alignment: .center)

            Text("Please sign in with your Teak account to continue.")
                .font(.callout)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: .infinity)

            Button {
                viewModel.signIn()
            } label: {
                if case .signingIn(let message) = viewModel.state {
                    Text(message)
                        .frame(maxWidth: .infinity)
                } else {
                    Text("Login")
                        .frame(maxWidth: .infinity)
                }
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(viewModel.isBusy)

            if let errorMessage = viewModel.errorMessage, !errorMessage.isEmpty {
                Text(errorMessage)
                    .font(.callout)
                    .foregroundStyle(.red)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity)
            }

            Spacer()
        }
        .padding(32)
        .frame(maxWidth: 420)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

private struct WelcomeScreen: View {
    let username: String
    let onLogout: () -> Void

    var body: some View {
        VStack(spacing: 20) {
            Spacer()

            Text("Welcome, \(username)")
                .font(.system(size: 30, weight: .semibold))
                .multilineTextAlignment(.center)

            Button("Logout", action: onLogout)
                .buttonStyle(.borderedProminent)
                .controlSize(.large)

            Spacer()
        }
        .padding(32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
