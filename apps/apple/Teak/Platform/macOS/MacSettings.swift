#if os(macOS)
import AppKit
import SwiftUI
import TeakCore

/// The Settings window: General, Account and About tabs, each a grouped form
/// sized to its content.
struct MacSettingsView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var account = AccountModel()

    var body: some View {
        TabView {
            Tab("General", systemImage: "gearshape") {
                Form {
                    AppearanceSection()
                    MacOptionsSection()
                    SafariExtensionSection()
                }
                .formStyle(.grouped)
                .frame(width: 520, height: 470)
            }
            Tab("Account", systemImage: "person.crop.circle") {
                Form {
                    AccountSection(account: account)
                }
                .formStyle(.grouped)
                .frame(width: 520, height: 310)
            }
            Tab("About", systemImage: "info.circle") {
                MacAboutView()
                    .frame(width: 520, height: 300)
            }
        }
        .scrollDisabled(true)
        .task { await account.watch(app.backend) }
        // Logging out leaves only the welcome window.
        .onChange(of: app.phase == .signedIn) { _, signedIn in
            if !signedIn { dismiss() }
        }
    }
}

/// The library window ("main"), which opens at welcome size before sign-in.
@MainActor
enum MainWindow {
    static let librarySize = NSSize(width: 1100, height: 760)

    /// Grows the window to library size, keeping it on screen, once someone signs in.
    static func growToLibrarySize() {
        guard let window = NSApp.windows.first(where: { $0.identifier?.rawValue.hasPrefix("main") == true }),
              window.frame.width < librarySize.width else { return }
        var frame = window.frameRect(forContentRect: NSRect(origin: .zero, size: librarySize))
        frame.origin = NSPoint(x: window.frame.midX - frame.width / 2, y: window.frame.maxY - frame.height)
        if let visible = window.screen?.visibleFrame {
            frame.size.width = min(frame.width, visible.width)
            frame.size.height = min(frame.height, visible.height)
            frame.origin.x = min(max(frame.minX, visible.minX), visible.maxX - frame.width)
            frame.origin.y = min(max(frame.minY, visible.minY), visible.maxY - frame.height)
        }
        window.setFrame(frame, display: true, animate: true)
    }
}

/// The app icon, name and version, with the same words as About on iPhone.
private struct MacAboutView: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        VStack(spacing: 6) {
            Image(nsImage: NSApp.applicationIconImage)
                .resizable()
                .frame(width: 96, height: 96)
                .accessibilityHidden(true)
            Text("Teak").font(.title2.weight(.semibold))
            Text("Version \(app.config.version) (\(app.config.build))")
                .font(.callout)
                .foregroundStyle(.secondary)
                .textSelection(.enabled)
            Text("by @praveenjuge")
                .padding(.top, 10)
            Text("Hope you enjoy using Teak as much as I enjoyed creating it.")
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
#endif
