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
    @State private var problem: String?
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
            Button("Open Safari Settings…") { Task { await openSafariSettings() } }
            if let problem {
                Text(problem).font(.footnote).foregroundStyle(.secondary)
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
        let (enabled, error) = await withCheckedContinuation { continuation in
            // The SDK marks this handler main-actor, but Safari calls it from an
            // XPC queue; a nonisolated handler avoids a runtime isolation trap.
            let handler: @Sendable (SFSafariExtensionState?, (any Error)?) -> Void = { state, error in
                continuation.resume(returning: (state?.isEnabled ?? false, error?.localizedDescription))
            }
            SFSafariExtensionManager.getStateOfSafariExtension(withIdentifier: SafariExtension.identifier,
                                                               completionHandler: handler)
        }
        isEnabled = enabled
        problem = error.map { "Couldn't check the extension: \($0)" }
    }

    private func openSafariSettings() async {
        let error = await withCheckedContinuation { continuation in
            let handler: @Sendable ((any Error)?) -> Void = { error in
                continuation.resume(returning: error?.localizedDescription)
            }
            SFSafariApplication.showPreferencesForExtension(withIdentifier: SafariExtension.identifier,
                                                            completionHandler: handler)
        }
        guard error != nil else { return problem = nil }
        // Safari sometimes can't find the extension by identifier (SFErrorDomain 1);
        // open Safari and say where the setting lives instead.
        if let safari = NSWorkspace.shared.urlForApplication(withBundleIdentifier: "com.apple.Safari") {
            _ = try? await NSWorkspace.shared.openApplication(at: safari, configuration: .init())
        }
        problem = "In Safari, choose Safari > Settings > Extensions, then turn on Teak."
    }
    #endif
}
