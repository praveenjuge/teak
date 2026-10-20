import SwiftUI
import TeakCore

/// What the open card offers the menu bar (Mac) and the iPad's command menu.
struct CardCommands {
    let archiveTitle: String
    let doneTitle: String?
    let toggleArchive: () -> Void
    let toggleDone: () -> Void
    let moreLikeThis: () -> Void
    let refresh: () -> Void
}

extension FocusedValues {
    @Entry var cardCommands: CardCommands?
}

struct TeakCommands: Commands {
    let services: AppServices
    @FocusedValue(\.cardCommands) private var card

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
            Button("Show Archive") {
                services.home.showArchive()
                services.router.homePath = []
                services.router.tab = .home
            }
                .disabled(!signedIn)
            Button("Revisit") {
                services.router.tab = .home
                services.router.isRevisiting = true
            }
                .keyboardShortcut("r", modifiers: [.command, .control])
                .disabled(!signedIn || services.home.isTrash || services.home.isArchive)
        }
        CommandMenu("Card") {
            Button(card?.archiveTitle ?? "Archive") { card?.toggleArchive() }
                .keyboardShortcut("a", modifiers: [.command, .control])
                .disabled(card == nil)
            Button(card?.doneTitle ?? "Mark as Done") { card?.toggleDone() }
                .keyboardShortcut("d", modifiers: [.command, .shift])
                .disabled(card?.doneTitle == nil)
            Button("More Like This") { card?.moreLikeThis() }
                .keyboardShortcut("l", modifiers: [.command, .shift])
                .disabled(card == nil)
            Button("Refresh Details") { card?.refresh() }
                .keyboardShortcut("r", modifiers: [.command, .option])
                .disabled(card == nil)
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
