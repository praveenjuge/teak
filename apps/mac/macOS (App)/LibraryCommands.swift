import AppKit

extension Notification.Name {
    static let libraryRefresh = Notification.Name("teak.library.refresh")
    static let librarySearch = Notification.Name("teak.library.search")
    static let libraryNewNote = Notification.Name("teak.library.newNote")
}

extension AppDelegate {
    func configureKeyboardMenus() {
        guard let menu = NSApp.mainMenu, let appMenu = menu.items.first?.submenu else { return }
        let settings = NSMenuItem(title: "Settings…", action: #selector(openSettingsFromMenu), keyEquivalent: ",")
        settings.target = self
        appMenu.insertItem(settings, at: min(2, appMenu.numberOfItems))

        let file = addMenu("File", to: menu, at: 1)
        addCommand("New Note", action: #selector(newNoteFromMenu), key: "n", to: file)
        addCommand("Upload Files…", action: #selector(uploadFromMenu), key: "u", modifiers: [.command, .shift], to: file)
        file.addItem(.separator())
        file.addItem(withTitle: "Close Window", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")

        let edit = addMenu("Edit", to: menu, at: 2)
        for (title, action, key) in [
            ("Undo", "undo:", "z"), ("Redo", "redo:", "Z"),
            ("Cut", "cut:", "x"), ("Copy", "copy:", "c"),
            ("Paste", "paste:", "v"), ("Select All", "selectAll:", "a")
        ] {
            edit.addItem(withTitle: title, action: Selector(action), keyEquivalent: key)
        }
        edit.addItem(.separator())
        addCommand("Find in Library", action: #selector(searchFromMenu), key: "f", to: edit)

        let view = addMenu("View", to: menu, at: 3)
        addCommand("Refresh Library", action: #selector(refreshFromMenu), key: "r", to: view)
        let alternate = addCommand("Refresh Library", action: #selector(refreshFromMenu), key: "r", modifiers: [.command, .option], to: view)
        alternate.isAlternate = true
        let fullscreen = view.addItem(withTitle: "Enter Full Screen", action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f")
        fullscreen.keyEquivalentModifierMask = [.command, .control]

        let window = addMenu("Window", to: menu, at: 4)
        window.addItem(withTitle: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        window.addItem(withTitle: "Zoom", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
        NSApp.windowsMenu = window
    }

    private func addMenu(_ title: String, to parent: NSMenu, at index: Int) -> NSMenu {
        let item = NSMenuItem(title: title, action: nil, keyEquivalent: "")
        let menu = NSMenu(title: title)
        item.submenu = menu
        parent.insertItem(item, at: min(index, parent.numberOfItems))
        return menu
    }

    @discardableResult private func addCommand(_ title: String, action: Selector, key: String,
                                              modifiers: NSEvent.ModifierFlags = .command, to menu: NSMenu) -> NSMenuItem {
        let item = menu.addItem(withTitle: title, action: action, keyEquivalent: key)
        item.target = self
        item.keyEquivalentModifierMask = modifiers
        return item
    }

    @objc private func openSettingsFromMenu() { showSettingsWindow() }
    @objc private func refreshFromMenu() { NotificationCenter.default.post(name: .libraryRefresh, object: nil) }
    @objc private func searchFromMenu() { NotificationCenter.default.post(name: .librarySearch, object: nil) }
    @objc private func newNoteFromMenu() { NotificationCenter.default.post(name: .libraryNewNote, object: nil) }
    @objc private func uploadFromMenu() { NotificationCenter.default.post(name: .libraryUpload, object: nil) }
}

extension Notification.Name {
    static let libraryUpload = Notification.Name("teak.library.upload")
}

extension AppDelegate: NSMenuItemValidation {
    func validateMenuItem(_ menuItem: NSMenuItem) -> Bool {
        if menuItem.action == #selector(openSettingsFromMenu) { return true }
        return (NSApp.keyWindow?.windowController is LibraryWindowController) && NSApp.keyWindow?.attachedSheet == nil
    }
}
