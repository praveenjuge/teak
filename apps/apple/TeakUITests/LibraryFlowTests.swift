import XCTest

/// End-to-end flows against the local E2E stack, on iPhone, iPad and Mac.
final class LibraryFlowTests: XCTestCase {
    private var app: XCUIApplication!

    override func setUp() {
        continueAfterFailure = false
    }

    /// Signs in as a new account and opens the library.
    @MainActor private func start() async throws {
        let account = try await E2EStack.account()
        app = XCUIApplication()
        app.launchEnvironment = account.launchEnvironment
        app.launch()
        app.searchFields.firstMatch.waitToAppear(30)
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

    /// Enters text into a field. Synthesized typing drops characters in Mac
    /// text views, so the Mac pastes instead.
    @MainActor private func enter(_ text: String, into element: XCUIElement) {
        #if os(macOS)
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
        element.typeKey("v", modifierFlags: .command)
        #else
        element.typeText(text)
        #endif
    }

    /// Enters text and presses Return.
    @MainActor private func submit(_ text: String, into element: XCUIElement) {
        #if os(macOS)
        enter(text, into: element)
        element.typeKey(.return, modifierFlags: [])
        #else
        element.typeText(text + "\n")
        #endif
    }

    /// Writes a note (or link) through the composer and waits for its tile.
    @MainActor private func save(_ text: String, expecting title: String) {
        #if os(macOS)
        app.typeKey("n", modifierFlags: .command)
        #else
        tap(tab("Add"))
        tap(app.buttons["Note or Link"].waitToAppear())
        #endif
        let editor = app.textViews["composer.text"].waitToAppear()
        tap(editor)
        enter(text, into: editor)
        tap(app.buttons["composer.save"])
        tile(containing: title).waitToAppear(20)
    }

    /// A tab: in the tab bar on iPhone, the floating bar or sidebar on iPad.
    @MainActor private func tab(_ name: String) -> XCUIElement {
        let candidates = [app.tabBars.buttons[name], app.buttons.matching(identifier: name).firstMatch,
                          app.cells.containing(.staticText, identifier: name).firstMatch,
                          app.staticTexts[name].firstMatch]
        let deadline = Date().addingTimeInterval(15)
        while Date() < deadline {
            if let found = candidates.first(where: { $0.exists && $0.isHittable }) { return found }
            Thread.sleep(forTimeInterval: 0.25)
        }
        XCTFail("Tab \(name) never appeared")
        return candidates[0]
    }

    /// A toolbar menu: a menu button on the Mac, a button elsewhere.
    @MainActor private func menu(_ name: String) -> XCUIElement {
        #if os(macOS)
        app.menuButtons[name].firstMatch
        #else
        app.buttons[name].firstMatch
        #endif
    }

    /// A confirmation's button: a sheet on the Mac, an action sheet or popover elsewhere.
    @MainActor private func confirmation(_ name: String) -> XCUIElement {
        #if os(macOS)
        app.sheets.buttons[name].firstMatch
        #else
        app.buttons[name].firstMatch
        #endif
    }

    @MainActor private func filter(_ name: String) {
        let button = menu("Filter").waitToAppear()
        tap(button)
        #if os(macOS)
        // Scoped to the menu: the Window menu also lists a window titled "Trash".
        tap(button.menuItems[name].firstMatch.waitToAppear())
        #else
        tap(menuItem(name).waitToAppear())
        #endif
    }

    /// A text field or text view by identifier; a multi-line field is a text view on the Mac.
    @MainActor private func field(_ identifier: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: identifier).firstMatch
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
    func testNotesLinksSearchAndTokens() async throws {
        try await start()
        let note = marker("note")
        save("Plan for \(note)", expecting: note)
        save("https://example.org/\(marker("page"))", expecting: "example.org")

        let search = app.searchFields.firstMatch
        tap(search)
        enter(note, into: search)
        XCTAssertTrue(tile(containing: note).waitForExistence(timeout: 10))
        tile(containing: "example.org").waitToDisappear()

        // Return turns typed text into tokens; "link" is a type token.
        #if os(macOS)
        search.typeKey("a", modifierFlags: .command)
        #else
        search.typeText(XCUIKeyboardKey.delete.rawValue.repeated(note.count))
        #endif
        submit("link", into: search)
        tile(containing: "example.org").waitToAppear()
        tile(containing: note).waitToDisappear()
    }

    @MainActor
    func testFavoriteEditTrashRestoreAndDeleteForever() async throws {
        try await start()
        let note = marker("card")
        save("Keep \(note)", expecting: note)

        // Favorite and edit notes and tags from the detail page.
        tap(tile(containing: note))
        tap(app.buttons["Favorite"].firstMatch.waitToAppear())
        app.buttons["Unfavorite"].firstMatch.waitToAppear()
        tap(menu("More").waitToAppear())
        tap(menuItem("Edit Notes and Tags").waitToAppear())
        let notes = field("edit.notes").waitToAppear()
        tap(notes)
        enter("Notes for \(note)", into: notes)
        let tagField = field("edit.tag")
        tap(tagField)
        submit("uitag", into: tagField)
        tap(app.buttons["Save"].firstMatch)
        app.staticTexts["Notes for \(note)"].waitToAppear()

        // A tag filters the library.
        tap(app.buttons["Search for uitag"].firstMatch.waitToAppear())
        tile(containing: note).waitToAppear()
        XCTAssertTrue(app.staticTexts["#uitag"].firstMatch.exists || app.buttons["#uitag"].firstMatch.exists
            || app.searchFields.firstMatch.exists)

        // Delete to Trash, restore, then delete forever.
        tap(tile(containing: note))
        tap(menu("More").waitToAppear())
        tap(menuItem("Delete Card").waitToAppear())
        tile(containing: note).waitToDisappear()

        filter("Trash")
        tile(containing: note).waitToAppear().openContextMenu()
        tap(menuItem("Restore").waitToAppear())
        tile(containing: note).waitToDisappear()
        filter("Trash")
        tile(containing: note).waitToAppear()

        tap(tile(containing: note))
        tap(menu("More").waitToAppear())
        tap(menuItem("Delete Card").waitToAppear())
        filter("Trash")
        tile(containing: note).waitToAppear().openContextMenu()
        tap(menuItem("Delete Forever").waitToAppear())
        tap(confirmation("Delete Forever").waitToAppear())
        tile(containing: note).waitToDisappear()
    }

    @MainActor
    func testSelectionBulkFavorite() async throws {
        try await start()
        let first = marker("bulk")
        let second = marker("bulk")
        save("One \(first)", expecting: first)
        save("Two \(second)", expecting: second)
        tap(app.buttons["library.select"].firstMatch.waitToAppear())
        tap(tile(containing: first))
        tap(tile(containing: second))
        app.staticTexts["2 Selected"].firstMatch.waitToAppear()
        tap(app.buttons["Favorite"].firstMatch)
        app.staticTexts["Favorited 2 cards"].firstMatch.waitToAppear()
        filter("Favorites")
        tile(containing: first).waitToAppear()
        tile(containing: second).waitToAppear()
    }

    #if os(macOS)
    /// The Mac sidebar opens Add, filters the library by view and type, and
    /// opens Settings; the toolbar's Add menu writes a note.
    @MainActor
    func testMacSidebarAndAddMenu() async throws {
        try await start()
        let note = marker("side")
        save("Sidebar \(note)", expecting: note)
        save("https://example.org/\(marker("side"))", expecting: "example.org")
        let sidebar = app.outlines.firstMatch

        tap(sidebar.staticTexts["Links"].waitToAppear())
        tile(containing: "example.org").waitToAppear()
        tile(containing: note).waitToDisappear()

        tap(sidebar.staticTexts["Add"])
        app.buttons["Choose Files…"].firstMatch.waitToAppear()

        tap(sidebar.staticTexts["Home"])
        tile(containing: note).waitToAppear()

        tap(app.menuButtons["library.add"].firstMatch)
        tap(app.menuButtons["library.add"].menuItems["New Note"].firstMatch.waitToAppear())
        let editor = app.textViews["composer.text"].waitToAppear()
        let menuNote = marker("menu")
        enter(menuNote, into: editor)
        tap(app.buttons["composer.save"])
        tile(containing: menuNote).waitToAppear(20)

        tap(app.buttons["Settings"].firstMatch.waitToAppear())
        app.buttons["settings.logOut"].firstMatch.waitToAppear()
    }
    #endif

    @MainActor
    func testLogOutReturnsToWelcome() async throws {
        try await start()
        #if os(macOS)
        app.typeKey(",", modifierFlags: .command)
        #else
        tap(tab("Settings"))
        #endif
        tap(app.buttons["settings.logOut"].firstMatch.waitToAppear())
        tap(confirmation("Log Out").waitToAppear())
        app.buttons["signIn.emailSignIn"].waitToAppear(20)
    }
}

private extension String {
    func repeated(_ count: Int) -> String { String(repeating: self, count: count) }
}
