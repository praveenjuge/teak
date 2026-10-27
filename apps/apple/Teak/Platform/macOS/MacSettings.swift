#if os(macOS)
import AppKit
import SwiftUI
import TeakCore

struct MacSettingsView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var account = AccountModel()

    var body: some View {
        TabView {
            Tab(tr("apple.mac.general"), systemImage: "gearshape") {
                Form {
                    AppearanceSection()
                    LanguageSection()
                    MacOptionsSection()
                    SafariExtensionSection()
                }
                .formStyle(.grouped)
                .frame(width: 520, height: 470)
            }
            Tab(tr("native.settings.account"), systemImage: "person.crop.circle") {
                Form {
                    ProfileSection(account: account)
                    AccountActions()
                }
                .formStyle(.grouped)
                .frame(width: 520, height: 360)
            }
            Tab(tr("native.settings.about"), systemImage: "info.circle") {
                MacAboutView()
                    .frame(width: 520, height: 300)
            }
        }
        .scrollDisabled(true)
        .task { await account.watch(app.backend) }
        // Closes on signing out, not on a dropped connection, which leaves the account signed in.
        .onChange(of: app.user == nil) { _, signedOut in
            if signedOut { dismiss() }
        }
    }
}

@MainActor
enum MainWindow {
    static let librarySize = NSSize(width: 1100, height: 760)

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

private struct MacAboutView: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        VStack(spacing: 6) {
            Image(nsImage: NSApp.applicationIconImage)
                .resizable()
                .frame(width: 96, height: 96)
                .accessibilityHidden(true)
            Text(verbatim: "Teak").font(.title2.weight(.semibold))
            Text(tr("native.settings.versionValue", "\(app.config.version) (\(app.config.build))"))
                .font(.callout)
                .foregroundStyle(.secondary)
                .textSelection(.enabled)
            // The author's handle stays as it is in every language.
            Text(tr("native.settings.byAuthor", "@praveenjuge"))
                .padding(.top, 10)
            Text(tr("native.settings.hope"))
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
#endif
