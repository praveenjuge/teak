import SwiftUI

/// Shown while the session and sign-in configuration load.
struct LoadingView: View {
    var body: some View {
        ProgressView()
            .controlSize(.large)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .accessibilityLabel("Loading")
    }
}

/// No connection: the iPhone app's offline screen.
struct OfflineView: View {
    let retry: () -> Void

    var body: some View {
        ContentUnavailableView {
            Label("You're Offline", systemImage: "wifi.slash")
        } description: {
            Text("Check your connection and try again to access your cards.")
        } actions: {
            Button("Try Again", action: retry)
                .buttonStyle(.bordered)
                .controlSize(.large)
        }
    }
}

/// The configuration couldn't load.
struct FailedView: View {
    let message: String
    let retry: () -> Void

    var body: some View {
        ContentUnavailableView {
            Label("Something Went Wrong", systemImage: "exclamationmark.triangle")
        } description: {
            Text(message)
        } actions: {
            Button("Try Again", action: retry)
                .buttonStyle(.bordered)
                .controlSize(.large)
        }
    }
}
