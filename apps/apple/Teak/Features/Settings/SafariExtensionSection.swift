import SwiftUI

#if os(macOS)
import SafariServices
#endif

enum SafariExtension {
    static let identifier = "com.praveenjuge.teak.safari-extension"
}

/// Whether the Safari extension is on, and how to turn it on.
struct SafariExtensionSection: View {
    #if os(macOS)
    @State private var isEnabled: Bool?
    #endif

    var body: some View {
        Section("Safari Extension") {
            #if os(macOS)
            LabeledContent("Status") {
                switch isEnabled {
                case true?: Label("On", systemImage: "checkmark.circle.fill").foregroundStyle(.green)
                case false?: Text("Off")
                case nil: ProgressView().controlSize(.small)
                }
            }
            Button("Open Safari Settings…") {
                SFSafariApplication.showPreferencesForExtension(withIdentifier: SafariExtension.identifier,
                                                                completionHandler: nil)
            }
            #else
            Text("Save pages from Safari with one tap. In Safari, tap \(Image(systemName: "puzzlepiece.extension")) in the address bar, choose Manage Extensions, and turn on Teak.")
                .font(.callout)
                .foregroundStyle(.secondary)
            #endif
        }
        #if os(macOS)
        .task { await refresh() }
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in
            Task { await refresh() }
        }
        #endif
    }

    #if os(macOS)
    private func refresh() async {
        isEnabled = await withCheckedContinuation { continuation in
            // The SDK marks this handler main-actor, but Safari calls it from an
            // XPC queue; a nonisolated handler avoids a runtime isolation trap.
            let handler: @Sendable (SFSafariExtensionState?, (any Error)?) -> Void = { state, _ in
                continuation.resume(returning: state?.isEnabled ?? false)
            }
            SFSafariExtensionManager.getStateOfSafariExtension(withIdentifier: SafariExtension.identifier,
                                                               completionHandler: handler)
        }
    }
    #endif
}
