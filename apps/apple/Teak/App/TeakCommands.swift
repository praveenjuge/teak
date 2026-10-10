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
                .keyboardShortcut("v", modifiers: [.command, .option, .shift])
                .disabled(!signedIn)
            Divider()
            Button("Find in Library") { services.router.focusSearch = true }
                .keyboardShortcut("f")
                .disabled(!signedIn)
        }
        CommandGroup(after: .toolbar) {
            Button("Refresh Library") { Task { await services.activeLibrary.refresh() } }
                .keyboardShortcut("r")
                .disabled(!signedIn)
            Button("Select Cards") { services.activeLibrary.beginSelection() }
                .disabled(!signedIn || services.activeLibrary.isSelecting)
            Button("Select All Cards") { services.activeLibrary.selectAll() }
                .keyboardShortcut("a", modifiers: [.command, .shift])
                .disabled(!signedIn)
            Divider()
            Button("Home") { services.router.tab = .home }.keyboardShortcut("1").disabled(!signedIn)
            Button("Favorites") { services.router.tab = .favorites }.keyboardShortcut("2").disabled(!signedIn)
            Button("Trash") { services.router.tab = .trash }.keyboardShortcut("3").disabled(!signedIn)
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
