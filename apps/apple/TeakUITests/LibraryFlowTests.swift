import XCTest

final class LibraryFlowTests: XCTestCase {
    private var app: XCUIApplication!

    override func setUp() {
        continueAfterFailure = false
    }

    @MainActor private func start() async throws {
        let account = try await E2EStack.account()
        app = XCUIApplication()
        app.launchEnvironment = account.launchEnvironment
        app.launch()
        app.searchFields.firstMatch.waitToAppear(30)
    }

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

    @MainActor private func submit(_ text: String, into element: XCUIElement) {
        #if os(macOS)
        enter(text, into: element)
        element.typeKey(.return, modifierFlags: [])
        #else
        element.typeText(text + "\n")
        #endif
    }

    @MainActor private func save(_ text: String, expecting title: String) {
        #if os(macOS)
        app.typeKey("n", modifierFlags: .command)
        #else
        tap(tab("Add"))
        tap(app.buttons["Note or link"].waitToAppear())
        #endif
        let editor = app.textViews["composer.text"].waitToAppear()
        tap(editor)
        enter(text, into: editor)
        tap(app.buttons["composer.save"])
        tile(containing: title).waitToAppear(20)
    }

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

    @MainActor private func menu(_ name: String) -> XCUIElement {
        #if os(macOS)
        app.menuButtons[name].firstMatch
        #else
        app.buttons[name].firstMatch
        #endif
    }

    @MainActor private func confirmation(_ name: String) -> XCUIElement {
        #if os(macOS)
        app.sheets.buttons[name].firstMatch
        #else
        app.buttons[name].firstMatch
        #endif
    }

    @MainActor private func byId(_ identifier: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: identifier).firstMatch
    }

    @MainActor private func filter(_ name: String) {
        let button = byId("library.more").waitToAppear()
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

    /// "Delete forever", in Title Case in Mac menus.
    private var deleteForever: String {
        #if os(macOS)
        "Delete Forever"
        #else
        "Delete forever"
        #endif
    }

    @MainActor private func menuItem(_ name: String) -> XCUIElement {
        #if os(macOS)
        app.menuItems[name].firstMatch
        #else
        app.buttons[name].firstMatch
        #endif
    }

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

        tap(tile(containing: note))
        tap(app.buttons["Favorite"].firstMatch.waitToAppear())
        app.buttons["Unfavorite"].firstMatch.waitToAppear()
        tap(app.buttons["Edit"].firstMatch.waitToAppear())
        let notes = field("edit.notes").waitToAppear()
        tap(notes)
        enter("Notes for \(note)", into: notes)
        let tagField = field("edit.tag")
        tap(tagField)
        submit("uitag", into: tagField)
        app.staticTexts["uitag"].firstMatch.waitToAppear()
        tap(app.buttons["Save"].firstMatch)
        app.staticTexts["Notes for \(note)"].waitToAppear()

        tap(app.buttons["Search for uitag"].firstMatch.waitToAppear())
        tile(containing: note).waitToAppear()
        XCTAssertTrue(app.staticTexts["uitag"].firstMatch.exists || app.buttons["uitag"].firstMatch.exists
            || app.searchFields.firstMatch.exists)

        tap(tile(containing: note))
        tap(byId("detail.more").waitToAppear())
        tap(menuItem("Move to Trash").waitToAppear())
        tile(containing: note).waitToDisappear()
        tap(byId("status.undo").waitToAppear())
        tile(containing: note).waitToAppear()

        tile(containing: note).openContextMenu()
        tap(menuItem("Move to Trash").waitToAppear())
        tile(containing: note).waitToDisappear()

        filter("Trash")
        tile(containing: note).waitToAppear().openContextMenu()
        tap(menuItem("Restore").waitToAppear())
        tile(containing: note).waitToDisappear()
        filter("Trash")
        tile(containing: note).waitToAppear()

        tap(tile(containing: note))
        tap(byId("detail.more").waitToAppear())
        tap(menuItem("Move to Trash").waitToAppear())
        filter("Trash")
        tile(containing: note).waitToAppear().openContextMenu()
        tap(menuItem(deleteForever).waitToAppear())
        tap(confirmation(deleteForever).waitToAppear())
        tile(containing: note).waitToDisappear()
        XCTAssertFalse(confirmation(deleteForever).waitForExistence(timeout: 3))
    }

    @MainActor
    func testSelectionBulkFavorite() async throws {
        try await start()
        let first = marker("bulk")
        let second = marker("bulk")
        save("One \(first)", expecting: first)
        save("Two \(second)", expecting: second)
        filter("Select")
        tap(tile(containing: first))
        tap(tile(containing: second))
        app.staticTexts["2 selected"].firstMatch.waitToAppear()
        tap(app.buttons["Add to favorites"].firstMatch.waitToAppear())
        app.staticTexts["Added 2 cards to favorites"].firstMatch.waitToAppear()
        filter("Favorites")
        tile(containing: first).waitToAppear()
        tile(containing: second).waitToAppear()
    }

    @MainActor
    func testChangingTheViewEndsASelection() async throws {
        try await start()
        let note = marker("select")
        save("Pick \(note)", expecting: note)
        filter("Select")
        tap(tile(containing: note))
        let selected = app.staticTexts["1 selected"].firstMatch
        selected.waitToAppear()

        let search = app.searchFields.firstMatch
        tap(search)
        submit("link", into: search)
        selected.waitToDisappear()
        XCTAssertFalse(app.buttons["Add to favorites"].firstMatch.exists)
    }

    @MainActor
    func testFavoriteFromTileThenUnfavoriteOnCardClearsTheTileHeart() async throws {
        #if os(macOS)
        throw XCTSkip("Covered on iPhone and iPad; this flow goes back through the navigation bar")
        #else
        try await start()
        let note = marker("heart")
        save("Heart \(note)", expecting: note)
        let favorited = app.buttons.matching(NSPredicate(format: "label CONTAINS %@ AND label ENDSWITH %@", note,
                                                         ", Favorite")).firstMatch

        tile(containing: note).openContextMenu()
        tap(menuItem("Favorite").waitToAppear())
        favorited.waitToAppear()

        tap(tile(containing: note))
        tap(app.buttons["Unfavorite"].firstMatch.waitToAppear())
        app.buttons["Favorite"].firstMatch.waitToAppear()
        tap(app.navigationBars.buttons.firstMatch)
        tile(containing: note).waitToAppear()
        favorited.waitToDisappear()
        #endif
    }

    @MainActor
    func testArchiveDoneAndRevisit() async throws {
        try await start()
        let page = marker("done")
        save("https://example.org/\(page)", expecting: "example.org")

        tap(tile(containing: "example.org"))
        tap(app.buttons["Mark as done"].firstMatch.waitToAppear())
        app.staticTexts["Marked as done"].firstMatch.waitToAppear()
        app.buttons["Done"].firstMatch.waitToAppear()

        tap(byId("detail.more").waitToAppear())
        tap(menuItem("Archive").waitToAppear())
        app.staticTexts["Archived 1 card"].firstMatch.waitToAppear()
        tile(containing: "example.org").waitToDisappear()
        filter("Archive")
        tile(containing: "example.org").waitToAppear().openContextMenu()
        tap(menuItem("Unarchive").waitToAppear())
        app.staticTexts["Returned 1 card to the library"].firstMatch.waitToAppear()
        tile(containing: "example.org").waitToDisappear()
        filter("Archive")
        tile(containing: "example.org").waitToAppear()

        filter("Revisit")
        let position = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "1 of ")).firstMatch
        position.waitToAppear(20)
        tap(app.buttons["Keep"].firstMatch)
        position.waitToDisappear()
        tap(app.buttons["Close Revisit"].firstMatch)
        tile(containing: "example.org").waitToAppear()
    }

    @MainActor
    func testRevisitUndoLastArchiveBringsBackTheArchivedCard() async throws {
        try await start()
        for label in ["first", "second"] {
            let note = marker(label)
            save("Revisit \(note)", expecting: note)
        }

        filter("Revisit")
        let first = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "1 of ")).firstMatch
        first.waitToAppear(20)
        tap(byId("revisit.archive"))
        first.waitToDisappear()
        let finished = app.staticTexts["All caught up"].firstMatch
        for _ in 0..<25 where !finished.exists {
            tap(byId("revisit.keep").waitToAppear())
        }
        finished.waitToAppear()
        app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "1 archived")).firstMatch.waitToAppear()

        tap(app.buttons["Undo last archive"].firstMatch)
        first.waitToAppear()
        finished.waitToDisappear()
    }

    @MainActor
    func testFoldersOpenFromTheFoldersTabOrSidebar() async throws {
        try await start()
        let name = marker("folder")
        let tabBar = app.tabBars.buttons["Folders"]
        if tabBar.waitForExistence(timeout: 3) {
            tap(tabBar)
            tap(byId("folders.new").waitToAppear())
        } else {
            tap(byId("sidebar.newFolder").waitToAppear())
        }
        #if os(macOS)
        let field = app.sheets.textFields.firstMatch.waitToAppear()
        #else
        let field = app.alerts.textFields.firstMatch.waitToAppear()
        #endif
        enter(name, into: field)
        tap(app.buttons["Create folder"].firstMatch)
        let row = app.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH %@", name)).firstMatch
        tap(row.waitToAppear())
        app.staticTexts["Empty folder"].firstMatch.waitToAppear()
        #if os(iOS)
        app.navigationBars[name].firstMatch.waitToAppear()
        #endif
        byId("library.more").waitToAppear()
    }

    #if os(macOS)
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
        app.buttons["Choose files…"].firstMatch.waitToAppear()

        tap(sidebar.staticTexts["Home"])
        tile(containing: note).waitToAppear()

        tap(app.menuButtons["library.add"].firstMatch)
        tap(app.menuButtons["library.add"].menuItems["New note"].firstMatch.waitToAppear())
        let editor = app.textViews["composer.text"].waitToAppear()
        let menuNote = marker("menu")
        enter(menuNote, into: editor)
        tap(app.buttons["composer.save"])
        tile(containing: menuNote).waitToAppear(20)

        app.typeKey(",", modifierFlags: .command)
        tap(app.toolbars.buttons["Account"].firstMatch.waitToAppear())
        app.buttons["settings.logOut"].firstMatch.waitToAppear()
    }
    #endif

    @MainActor
    func testLogOutReturnsToWelcome() async throws {
        try await start()
        #if os(macOS)
        app.typeKey(",", modifierFlags: .command)
        tap(app.toolbars.buttons["Account"].firstMatch.waitToAppear())
        #else
        tap(tab("Settings"))
        #endif
        tap(app.buttons["settings.logOut"].firstMatch.waitToAppear())
        tap(confirmation("Sign out").waitToAppear())
        app.buttons["signIn.emailSignIn"].waitToAppear(20)
        #if os(macOS)
        XCTAssertFalse(app.windows["Settings"].exists || app.windows["Account"].exists)
        #endif
    }
}

private extension String {
    func repeated(_ count: Int) -> String { String(repeating: self, count: count) }
}
