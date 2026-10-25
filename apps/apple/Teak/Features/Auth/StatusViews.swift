import SwiftUI
import TeakCore

struct LoadingView: View {
    var body: some View {
        ProgressView()
            .controlSize(.large)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .accessibilityLabel(tr("common.loading"))
    }
}

struct OfflineView: View {
    let retry: () -> Void

    var body: some View {
        ContentUnavailableView {
            Label(tr("native.app.offline.title"), systemImage: "wifi.slash")
        } description: {
            Text(tr("native.app.offline.message"))
        } actions: {
            Button(tr("common.tryAgain"), action: retry)
                .buttonStyle(.bordered)
                .controlSize(.large)
        }
    }
}

struct FailedView: View {
    let message: String
    let retry: () -> Void

    var body: some View {
        ContentUnavailableView {
            Label(tr("native.app.failed.title"), systemImage: "exclamationmark.triangle")
        } description: {
            Text(message)
        } actions: {
            Button(tr("common.tryAgain"), action: retry)
                .buttonStyle(.bordered)
                .controlSize(.large)
        }
    }
}
