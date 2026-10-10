import AppKit
import SwiftUI

final class LibraryWindowController: NSWindowController {
    init(onSettings: @escaping () -> Void, onAuthenticationRequired: @escaping () -> Void) {
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1120, height: 760),
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        window.title = "Teak Library"
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.collectionBehavior = [.fullScreenPrimary]
        window.minSize = NSSize(width: 650, height: 480)
        window.isReleasedWhenClosed = false
        window.contentViewController = NSHostingController(rootView: LibraryView(
            onSettings: onSettings,
            onAuthenticationRequired: onAuthenticationRequired
        ))
        window.initialFirstResponder = window.contentView
        window.setContentSize(NSSize(width: 1120, height: 760))
        super.init(window: window)
        shouldCascadeWindows = false
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    /// Edit › Paste reaches here when no text field has focus, so ⌘V on the
    /// library saves the clipboard as a card, like pasting on the web.
    @objc func paste(_ sender: Any?) {
        guard window?.attachedSheet == nil,
              let content = PasteboardCapture.read(.general) else { NSSound.beep(); return }
        NotificationCenter.default.post(name: .libraryPaste, object: content)
    }

    func present() {
        guard let window else { return }
        let wasVisible = window.isVisible
        if !wasVisible { window.center() }
        window.makeKeyAndOrderFront(nil)
        if !wasVisible { window.makeFirstResponder(nil) }
    }
}
