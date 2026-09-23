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
        window.minSize = NSSize(width: 650, height: 480)
        window.isReleasedWhenClosed = false
        window.contentViewController = NSHostingController(rootView: LibraryView(
            onSettings: onSettings,
            onAuthenticationRequired: onAuthenticationRequired
        ))
        super.init(window: window)
        shouldCascadeWindows = false
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    func present() {
        guard let window else { return }
        if !window.isVisible { window.center() }
        window.makeKeyAndOrderFront(nil)
    }
}
