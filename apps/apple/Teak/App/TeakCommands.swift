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
        // Reading the language here rebuilds the menus when it changes.
        commands(language: services.language.code)
    }

    @CommandsBuilder private func commands(language _: String) -> some Commands {
        CommandGroup(replacing: .newItem) {
            Button(tr("apple.commands.newNote")) { services.router.compose() }
                .keyboardShortcut("n")
                .disabled(!signedIn)
            Button(tr("apple.commands.uploadFiles")) { services.router.isImportingFiles = true }
                .keyboardShortcut("u", modifiers: [.command, .shift])
                .disabled(!signedIn)
            Button(tr("apple.commands.voiceMemo")) { services.router.isRecording = true }
                .keyboardShortcut("r", modifiers: [.command, .shift])
                .disabled(!signedIn)
            #if os(macOS)
            Button(tr("apple.commands.quickCapture")) { QuickCapturePanel.shared.show() }
                .keyboardShortcut("t", modifiers: [.command, .option, .control])
            #endif
        }
        CommandGroup(after: .pasteboard) {
            Button(tr("apple.commands.pasteAsNewCard")) { pasteAsNewCard() }
                .keyboardShortcut("v", modifiers: [.command, .control])
                .disabled(!signedIn)
        }
        CommandGroup(after: .toolbar) {
            Button(tr("apple.commands.refreshLibrary")) { Task { await services.home.refresh() } }
                .keyboardShortcut("r")
                .disabled(!signedIn)
            Button(tr("apple.commands.selectCards")) { services.home.beginSelection() }
                .disabled(!signedIn || services.home.isSelecting)
            Button(tr("apple.commands.selectAllCards")) { services.home.selectAll() }
                .keyboardShortcut("a", modifiers: [.command, .shift])
                .disabled(!signedIn)
            Divider()
            Button(tr("apple.commands.showFavorites")) {
                services.home.filters.favoritesOnly.toggle()
                services.router.tab = .home
            }
                .disabled(!signedIn)
            Button(tr("apple.commands.showTrash")) {
                services.home.filters.trashOnly.toggle()
                services.router.tab = .home
            }
                .disabled(!signedIn)
            Button(tr("apple.commands.showArchive")) {
                services.home.showArchive()
                services.router.homePath = []
                services.router.tab = .home
            }
                .disabled(!signedIn)
            Button(tr("apple.commands.revisit")) {
                services.router.tab = .home
                services.router.isRevisiting = true
            }
                .keyboardShortcut("r", modifiers: [.command, .control])
                .disabled(!signedIn || services.home.isTrash || services.home.isArchive)
        }
        CommandMenu(tr("apple.commands.card")) {
            Button(card?.archiveTitle ?? tr("apple.commands.archive")) { card?.toggleArchive() }
                .keyboardShortcut("a", modifiers: [.command, .control])
                .disabled(card == nil)
            Button(card?.doneTitle ?? tr("apple.commands.markAsDone")) { card?.toggleDone() }
                .keyboardShortcut("d", modifiers: [.command, .shift])
                .disabled(card?.doneTitle == nil)
            Button(tr("apple.commands.moreLikeThis")) { card?.moreLikeThis() }
                .keyboardShortcut("l", modifiers: [.command, .shift])
                .disabled(card == nil)
            Button(tr("apple.commands.refreshDetails")) { card?.refresh() }
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
