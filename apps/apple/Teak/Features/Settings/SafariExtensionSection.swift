import SwiftUI
import TeakCore

#if os(macOS)
import SafariServices
#endif

enum SafariExtension {
    static let identifier = "com.praveenjuge.teak.safari-extension"
}

struct SafariExtensionSection: View {
    #if os(macOS)
    @State private var isEnabled: Bool?
    @State private var problem: String?
    #endif

    var body: some View {
        Section(tr("native.settings.safariExtension")) {
            #if os(macOS)
            LabeledContent(tr("native.settings.status")) {
                switch isEnabled {
                case true?: Label(tr("native.settings.on"), systemImage: "checkmark.circle.fill").foregroundStyle(.green)
                case false?: Text(tr("native.settings.off"))
                case nil: ProgressView().controlSize(.small)
                }
            }
            Button(tr("native.settings.openSafariSettings")) { Task { await openSafariSettings() } }
            if let problem {
                Text(problem).font(.footnote).foregroundStyle(.secondary)
            }
            #else
            hint
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

    #if os(iOS)
    private var hint: Text {
        let marker = "\u{FFFC}"
        let parts = tr("native.settings.safariHint", marker).components(separatedBy: marker)
        let icon = Text(Image(systemName: "puzzlepiece.extension"))
        guard parts.count == 2 else { return Text(parts.joined()) }
        return Text("\(Text(parts[0]))\(icon)\(Text(parts[1]))")
    }
    #endif

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
        problem = error.map { tr("native.settings.safariCheckFailed", $0) }
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
        problem = tr("native.settings.safariWhere")
    }
    #endif
}
