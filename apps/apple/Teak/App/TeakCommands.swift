import SwiftUI
import TeakCore

/// What the open card offers the menu bar (Mac) and the iPad's command menu.
struct CardCommands {
    let archived: Bool
    /// A link's done verb ("read", "watched"…) and whether it's done; nil for other cards.
    let done: (verb: String, isDone: Bool)?
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
            Button(tr("apple.commands.newNote")) { inMainWindow { services.router.compose() } }
                .keyboardShortcut("n")
                .disabled(!signedIn)
            Button(tr("apple.commands.uploadFiles")) { inMainWindow { services.router.isImportingFiles = true } }
                .keyboardShortcut("u", modifiers: [.command, .shift])
                .disabled(!signedIn)
            Button(tr("apple.commands.voiceMemo")) { inMainWindow { services.router.isRecording = true } }
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
                .disabled(!signedIn || !services.app.isOnline)
            Button(tr("apple.commands.selectCards")) { services.home.beginSelection() }
                .disabled(!signedIn || services.home.isSelecting)
            Button(tr("apple.commands.selectAllCards")) { services.home.selectAll() }
                .keyboardShortcut("a", modifiers: [.command, .shift])
                .disabled(!signedIn)
            Divider()
            Button(tr("apple.commands.showFavorites")) {
                services.home.filters.favoritesOnly.toggle()
                services.router.homePath = []
                services.router.tab = .home
            }
                .disabled(!signedIn)
            Button(tr("apple.commands.showTrash")) {
                services.home.filters.trashOnly.toggle()
                services.router.homePath = []
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
            Button(card?.archived == true ? tr("apple.commands.unarchive") : tr("apple.commands.archive")) { card?.toggleArchive() }
                .keyboardShortcut("a", modifiers: [.command, .control])
                .disabled(card == nil)
            Button(doneTitle(card?.done)) { card?.toggleDone() }
                .keyboardShortcut("d", modifiers: [.command, .shift])
                .disabled(card?.done == nil)
            Button(tr("apple.commands.moreLikeThis")) { card?.moreLikeThis() }
                .keyboardShortcut("l", modifiers: [.command, .shift])
                .disabled(card == nil)
            Button(tr("apple.commands.refreshDetails")) { card?.refresh() }
                .keyboardShortcut("r", modifiers: [.command, .option])
                .disabled(card == nil)
        }
    }

    /// The main window's sheets show these, so on the Mac it comes forward
    /// (or opens again) first.
    private func inMainWindow(_ action: () -> Void) {
        #if os(macOS)
        services.showMainWindow()
        #endif
        action()
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

private extension TeakCommands {
    /// The done toggle's menu title, in Title Case as macOS menus expect.
    func doneTitle(_ done: (verb: String, isDone: Bool)?) -> String {
        guard let done else { return tr("apple.commands.markAs.done") }
        if done.isDone {
            switch done.verb {
            case "read": return tr("apple.commands.markAsNot.read")
            case "watched": return tr("apple.commands.markAsNot.watched")
            case "listened": return tr("apple.commands.markAsNot.listened")
            case "bought": return tr("apple.commands.markAsNot.bought")
            case "cooked": return tr("apple.commands.markAsNot.cooked")
            case "played": return tr("apple.commands.markAsNot.played")
            default: return tr("apple.commands.markAsNot.done")
            }
        }
        switch done.verb {
        case "read": return tr("apple.commands.markAs.read")
        case "watched": return tr("apple.commands.markAs.watched")
        case "listened": return tr("apple.commands.markAs.listened")
        case "bought": return tr("apple.commands.markAs.bought")
        case "cooked": return tr("apple.commands.markAs.cooked")
        case "played": return tr("apple.commands.markAs.played")
        default: return tr("apple.commands.markAs.done")
        }
    }
}
