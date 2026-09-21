//
//  MenuBarController.swift
//  macOS (App)
//

import Cocoa

/// Owns the opt-in menu bar item. Disabled by default; the Settings tab holds
/// the sole toggle (see SettingsViewController). Auth state reuses
/// TeakSafariService — this controller only presents it as a menu.
final class MenuBarController: NSObject, NSMenuDelegate {
    static let enabledDefaultsKey = "teak.menuBarItemEnabled"

    static var isEnabled: Bool {
        get { UserDefaults.standard.bool(forKey: enabledDefaultsKey) }
        set { UserDefaults.standard.set(newValue, forKey: enabledDefaultsKey) }
    }

    private var statusItem: NSStatusItem?
    private let menu = NSMenu()
    private let statusMenuItem = NSMenuItem(title: "", action: nil, keyEquivalent: "")

    override init() {
        super.init()
        statusMenuItem.isEnabled = false
        menu.delegate = self
        // macOS Tahoe fills menu rows with automatic SF Symbols. An explicit
        // (blank) image opts each row out and keeps the menu text-only.
        statusMenuItem.image = Self.blankImage()
        menu.addItem(statusMenuItem)
        menu.addItem(.separator())
        menu.addItem(Self.plainItem(title: "Open Teak Library", action: #selector(openLibrary), target: self))
        menu.addItem(Self.plainItem(title: "Open Settings…", action: #selector(openSettings), target: self))
        menu.addItem(.separator())
        menu.addItem(Self.plainItem(title: "Quit Teak for Safari", action: #selector(quitApp), target: self))
        sync()
    }

    private static func plainItem(title: String, action: Selector, target: AnyObject) -> NSMenuItem {
        let item = NSMenuItem(title: title, action: action, keyEquivalent: "")
        item.target = target
        item.image = Self.blankImage()
        return item
    }

    /// A valid 1x1 transparent image. Used instead of an empty NSImage so
    /// menu rendering always has a real bitmap to draw (and draw nothing).
    private static func blankImage() -> NSImage {
        let image = NSImage(size: NSSize(width: 1, height: 1))
        image.lockFocus()
        image.unlockFocus()
        return image
    }

    /// Creates or removes the status item to match the stored preference.
    func sync() {
        if Self.isEnabled {
            if statusItem == nil {
                let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
                item.behavior = .removalAllowed
                if let button = item.button {
                    if let icon = Self.menuIcon() {
                        button.image = icon
                    } else {
                        button.title = "Teak"
                    }
                    button.toolTip = "Teak for Safari"
                }
                item.menu = menu
                statusItem = item
            }
            statusItem?.isVisible = true
        } else if let item = statusItem {
            NSStatusBar.system.removeStatusItem(item)
            statusItem = nil
        }
    }

    func menuWillOpen(_ menu: NSMenu) {
        refreshStatus()
    }

    private func refreshStatus() {
        Task {
            let state = await TeakSafariService.shared.authState()
            if (state["authenticated"] as? Bool) == true {
                self.statusMenuItem.title = "Signed in."
            } else if let message = state["message"] as? String {
                self.statusMenuItem.title = message
            } else {
                self.statusMenuItem.title = "Signed out — sign in from Settings."
            }
        }
    }

    @objc private func openLibrary() {
        NSWorkspace.shared.open(TeakSafariService.appBaseURL)
    }

    @objc private func openSettings() {
        (NSApp.delegate as? AppDelegate)?.showSettingsWindow()
    }

    @objc private func quitApp() {
        NSApp.terminate(nil)
    }

    /// Rasterized at 2x from the shared toolbar glyph; rendered as a template
    /// so it adapts to light and dark menu bars. See toolbar-icon.svg.
    private static func menuIcon() -> NSImage? {
        guard let url = Bundle.main.url(forResource: "MenuBarIcon", withExtension: "png"),
              let image = NSImage(contentsOf: url) else { return nil }
        image.size = NSSize(width: 18, height: 18)
        image.isTemplate = true
        return image
    }
}
