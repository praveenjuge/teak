import AppIntents

struct TeakShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(intent: SaveToTeakIntent(), phrases: ["Save to \(.applicationName)"],
                    shortTitle: LocalizedStringResource("intents.saveTitle", table: "AppIntents"),
                    systemImageName: "square.and.arrow.down")
        AppShortcut(intent: SearchTeakIntent(), phrases: ["Search \(.applicationName)"],
                    shortTitle: LocalizedStringResource("intents.searchTitle", table: "AppIntents"),
                    systemImageName: "magnifyingglass")
        AppShortcut(intent: OpenCardIntent(), phrases: ["Open a card in \(.applicationName)"],
                    shortTitle: LocalizedStringResource("intents.openCardTitle", table: "AppIntents"),
                    systemImageName: "rectangle.portrait.on.rectangle.portrait")
        AppShortcut(intent: AddToFolderIntent(), phrases: ["Add cards to a folder in \(.applicationName)"],
                    shortTitle: LocalizedStringResource("intents.addToFolderTitle", table: "AppIntents"),
                    systemImageName: "folder.badge.plus")
        AppShortcut(intent: NewNoteIntent(), phrases: ["New note in \(.applicationName)"],
                    shortTitle: LocalizedStringResource("intents.newNoteTitle", table: "AppIntents"),
                    systemImageName: "square.and.pencil")
        AppShortcut(intent: RecordVoiceMemoIntent(), phrases: ["Record a voice memo in \(.applicationName)"],
                    shortTitle: LocalizedStringResource("intents.recordVoiceMemoTitle", table: "AppIntents"),
                    systemImageName: "mic")
    }
}
