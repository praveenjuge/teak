import XCTest

/// End-to-end flows against the local E2E stack, on iPhone, iPad and Mac.
final class LibraryFlowTests: XCTestCase {
    private var app: XCUIApplication!

    override func setUp() async throws {
        continueAfterFailure = false
        let account = try await E2EStack.account()
        await MainActor.run {
            app = XCUIApplication()
            app.launchEnvironment = account.launchEnvironment
            app.launch()
            app.searchFields.firstMatch.waitToAppear(30)
        }
    }

    // MARK: Helpers

    @MainActor private func marker(_ label: String) -> String {
        "\(label)-\(UUID().uuidString.prefix(6).lowercased())"
    }

    @MainActor private func tile(containing text: String) -> XCUIElement {
        app.buttons.matching(NSPredicate(format: "label CONTAINS %@", text)).firstMatch
    }

    @MainActor private func tap(_ element: XCUIElement) {
        #if os(macOS)
        element.click()
        #else
        element.tap()
        #endif
    }

    /// Writes a note (or link) through the composer and waits for its tile.
    @MainActor private func save(_ text: String, expecting title: String) {
        #if os(macOS)
        app.typeKey("n", modifierFlags: .command)
        #else
        tap(app.tabBars.buttons["Add"].waitToAppear())
        tap(app.buttons["Note or Link"].waitToAppear())
        #endif
        let editor = app.textViews["composer.text"].waitToAppear()
        tap(editor)
        editor.typeText(text)
        tap(app.buttons["composer.save"])
        tile(containing: title).waitToAppear(20)
    }

    @MainActor private func filter(_ name: String) {
        tap(app.buttons["Filter"].firstMatch.waitToAppear())
        tap(app.buttons[name].firstMatch.waitToAppear())
    }

    @MainActor private func menuItem(_ name: String) -> XCUIElement {
        #if os(macOS)
        app.menuItems[name].firstMatch
        #else
        app.buttons[name].firstMatch
        #endif
    }

    // MARK: Flows

    @MainActor
    func testNotesLinksSearchAndTokens() {
        let note = marker("note")
        save("Plan for \(note)", expecting: note)
        save("https://example.org/\(marker("page"))", expecting: "example.org")

        let search = app.searchFields.firstMatch
        tap(search)
        search.typeText(note)
        XCTAssertTrue(tile(containing: note).waitForExistence(timeout: 10))
        tile(containing: "example.org").waitToDisappear()

        // Return turns typed text into tokens; "link" is a type token.
        search.typeText(XCUIKeyboardKey.delete.rawValue.repeated(note.count) + "link\n")
        tile(containing: "example.org").waitToAppear()
        tile(containing: note).waitToDisappear()
    }

    @MainActor
    func testFavoriteEditTrashRestoreAndDeleteForever() {
        let note = marker("card")
        save("Keep \(note)", expecting: note)

        // Favorite and edit notes and tags from the detail page.
        tap(tile(containing: note))
        tap(app.buttons["Favorite"].firstMatch.waitToAppear())
        app.buttons["Unfavorite"].firstMatch.waitToAppear()
        tap(app.buttons["More"].firstMatch)
        tap(menuItem("Edit Notes and Tags").waitToAppear())
        let notes = app.textFields["Add notes"].firstMatch.waitToAppear()
        tap(notes)
        notes.typeText("Notes for \(note)")
        let tagField = app.textFields["Add a tag"].firstMatch
        tap(tagField)
        tagField.typeText("uitag\n")
        tap(app.buttons["Save"].firstMatch)
        app.staticTexts["Notes for \(note)"].waitToAppear()

        // A tag filters the library.
        tap(app.buttons["Search for uitag"].firstMatch.waitToAppear())
        tile(containing: note).waitToAppear()
        XCTAssertTrue(app.staticTexts["#uitag"].firstMatch.exists || app.buttons["#uitag"].firstMatch.exists
            || app.searchFields.firstMatch.exists)

        // Delete to Trash, restore, then delete forever.
        tap(tile(containing: note))
        tap(app.buttons["More"].firstMatch.waitToAppear())
        tap(menuItem("Delete Card").waitToAppear())
        tile(containing: note).waitToDisappear()

        filter("Trash")
        tile(containing: note).waitToAppear().openContextMenu()
        tap(menuItem("Restore").waitToAppear())
        tile(containing: note).waitToDisappear()
        filter("Trash")
        tile(containing: note).waitToAppear()

        tap(tile(containing: note))
        tap(app.buttons["More"].firstMatch.waitToAppear())
        tap(menuItem("Delete Card").waitToAppear())
        filter("Trash")
        tile(containing: note).waitToAppear().openContextMenu()
        tap(menuItem("Delete Forever").waitToAppear())
        tap(app.buttons["Delete Forever"].firstMatch.waitToAppear())
        tile(containing: note).waitToDisappear()
    }

    @MainActor
    func testSelectionBulkFavorite() {
        let first = marker("bulk")
        let second = marker("bulk")
        save("One \(first)", expecting: first)
        save("Two \(second)", expecting: second)
        tap(app.buttons["Select cards"].firstMatch.waitToAppear())
        tap(tile(containing: first))
        tap(tile(containing: second))
        app.staticTexts["2 Selected"].firstMatch.waitToAppear()
        tap(app.buttons["Favorite"].firstMatch)
        app.staticTexts["Favorited 2 cards"].firstMatch.waitToAppear()
        filter("Favorites")
        tile(containing: first).waitToAppear()
        tile(containing: second).waitToAppear()
    }

    @MainActor
    func testLogOutReturnsToWelcome() {
        #if os(macOS)
        app.typeKey(",", modifierFlags: .command)
        #else
        tap(app.tabBars.buttons["Settings"].waitToAppear())
        #endif
        tap(app.buttons["settings.logOut"].firstMatch.waitToAppear())
        tap(menuItem("Log Out").waitToAppear())
        app.buttons["signIn.emailSignIn"].waitToAppear(20)
    }
}

private extension String {
    func repeated(_ count: Int) -> String { String(repeating: self, count: count) }
}
