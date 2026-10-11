import SwiftUI
import TeakCore

/// Menus and shortcuts for the Mac and iPad with a keyboard. Commands are
/// dimmed, never hidden, when they don't apply.
struct TeakCommands: Commands {
    let services: AppServices

    private var signedIn: Bool { services.app.user != nil }

    var body: some Commands {
        CommandGroup(replacing: .newItem) {
            Button("New Note") { services.router.compose() }
                .keyboardShortcut("n")
                .disabled(!signedIn)
            Button("Upload Files…") { services.router.isImportingFiles = true }
                .keyboardShortcut("u", modifiers: [.command, .shift])
                .disabled(!signedIn)
            Button("Voice Memo") { services.router.isRecording = true }
                .keyboardShortcut("r", modifiers: [.command, .shift])
                .disabled(!signedIn)
            #if os(macOS)
            Button("Quick Capture…") { QuickCapturePanel.shared.show() }
                .keyboardShortcut("t", modifiers: [.command, .option, .control])
            #endif
        }
        CommandGroup(after: .pasteboard) {
            Button("Paste as New Card") { pasteAsNewCard() }
                .keyboardShortcut("v", modifiers: [.command, .control])
                .disabled(!signedIn)
        }
        CommandGroup(after: .toolbar) {
            Button("Refresh Library") { Task { await services.home.refresh() } }
                .keyboardShortcut("r")
                .disabled(!signedIn)
            Button("Select Cards") { services.home.beginSelection() }
                .disabled(!signedIn || services.home.isSelecting)
            Button("Select All Cards") { services.home.selectAll() }
                .keyboardShortcut("a", modifiers: [.command, .shift])
                .disabled(!signedIn)
            Divider()
            Button("Show Favorites") {
                services.home.filters.favoritesOnly.toggle()
                services.router.tab = .home
            }
                .disabled(!signedIn)
            Button("Show Trash") {
                services.home.filters.trashOnly.toggle()
                services.router.tab = .home
            }
                .disabled(!signedIn)
        }
    }

    private func pasteAsNewCard() {
        #if os(macOS)
        BackgroundCapture.save(PasteboardReader.items(from: .general))
        #else
        let providers = UIPasteboard.general.itemProviders
        Task { await services.capture.save(providers) }
        #endif
    }
}
