#if os(macOS)
import AppKit
import Carbon.HIToolbox
import SwiftUI
import TeakCore
import UniformTypeIdentifiers

enum MacPreferences {
    static let menuBarKey = "teak.menuBarItemEnabled"
    static let quickCaptureKey = "teak.quickCaptureShortcutEnabled"
    static let quickCaptureDraftKey = "teak.quickCaptureDraft"
}

@MainActor
enum PasteboardReader {
    static func items(from pasteboard: NSPasteboard) -> [SharedItem] {
        let options: [NSPasteboard.ReadingOptionKey: Any] = [.urlReadingFileURLsOnly: true]
        if let files = pasteboard.readObjects(forClasses: [NSURL.self], options: options) as? [URL], !files.isEmpty {
            return files.compactMap { try? ItemProviders.copyPicked($0) }.map(SharedItem.file)
        }
        if let image = pasteboard.readObjects(forClasses: [NSImage.self])?.first as? NSImage, let file = writePNG(image) {
            return [.file(ItemProviders.item(for: file, type: .png))]
        }
        if let text = pasteboard.string(forType: .string)?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty {
            return [.text(text)]
        }
        return []
    }

    private static func writePNG(_ image: NSImage) -> URL? {
        guard let tiff = image.tiffRepresentation,
              let png = NSBitmapImageRep(data: tiff)?.representation(using: .png, properties: [:]),
              let folder = try? ItemProviders.temporaryFolder()
        else { return nil }
        let stamp = ISO8601DateFormatter().string(from: Date()).replacingOccurrences(of: ":", with: ".")
        let file = folder.appending(path: "Pasted Image \(stamp).png")
        return (try? png.write(to: file)) != nil ? file : nil
    }
}

@MainActor
enum BackgroundCapture {
    /// `finished` gets whether everything saved.
    static func save(_ items: [SharedItem], finished: (@MainActor (Bool) -> Void)? = nil) {
        let services = AppServices.shared
        guard !items.isEmpty else {
            finished?(false)
            return CaptureHUD.show(tr("apple.mac.clipboardEmpty"), isError: true)
        }
        guard services.app.user != nil else {
            finished?(false)
            CaptureHUD.show(tr("apple.mac.signInFirst"), isError: true)
            services.showMainWindow()
            return
        }
        Task {
            let before = services.capture.savedCount
            if let failure = await services.capture.save(items, showsAlert: false) {
                CaptureHUD.show(failure.isCardLimit ? tr("native.capture.cardLimitMessage") : failure.message, isError: true)
                finished?(false)
            } else {
                // No failure and nothing saved: signing out cut the save short.
                let saved = services.capture.savedCount > before
                if saved {
                    CaptureHUD.show(services.capture.lastSaved ?? tr("native.capture.savedToTeak"))
                }
                finished?(saved)
            }
        }
    }
}

@MainActor
enum CaptureHUD {
    private static var panel: NSPanel?
    private static var hideTask: Task<Void, Never>?

    static func show(_ message: String, isError: Bool = false) {
        hideTask?.cancel()
        panel?.orderOut(nil)
        let content = hudView(message: message, isError: isError)
        let size = content.frame.size
        var origin = NSPoint.zero
        if let screen = NSScreen.main?.visibleFrame {
            origin = NSPoint(x: screen.midX - size.width / 2, y: screen.maxY - size.height - 24)
        }
        let hud = NSPanel(contentRect: NSRect(origin: origin, size: size), styleMask: [.borderless, .nonactivatingPanel],
                          backing: .buffered, defer: false)
        hud.isOpaque = false
        hud.backgroundColor = .clear
        hud.level = .statusBar
        hud.hasShadow = false
        hud.ignoresMouseEvents = true
        hud.collectionBehavior = [.canJoinAllSpaces, .transient]
        hud.contentView = content
        hud.orderFrontRegardless()
        NSAccessibility.post(element: content, notification: .announcementRequested,
                             userInfo: [.announcement: message, .priority: NSAccessibilityPriorityLevel.high.rawValue])
        panel = hud
        hideTask = Task {
            try? await Task.sleep(for: .seconds(2))
            guard !Task.isCancelled else { return }
            hud.orderOut(nil)
        }
    }

    /// AppKit rather than SwiftUI: a hosting view as a borderless panel's content kept
    /// resizing the panel to its corner safe areas until AppKit threw (macOS 26).
    private static func hudView(message: String, isError: Bool) -> NSView {
        let font = NSFont.systemFont(ofSize: NSFont.systemFontSize, weight: .medium)
        let label = NSTextField(wrappingLabelWithString: message)
        label.font = font.fontDescriptor.withDesign(.rounded).flatMap { NSFont(descriptor: $0, size: font.pointSize) } ?? font
        label.preferredMaxLayoutWidth = 420
        let icon = NSImageView(image: NSImage(systemSymbolName: isError ? "exclamationmark.circle.fill" : "checkmark.circle.fill",
                                              accessibilityDescription: nil) ?? NSImage())
        icon.symbolConfiguration = .init(pointSize: font.pointSize, weight: .medium)
        let stack = NSStackView(views: [icon, label])
        stack.spacing = 6
        stack.edgeInsets = NSEdgeInsets(top: 10, left: 16, bottom: 10, right: 16)
        // A horizontal stack's fitting height leaves out part of its vertical insets.
        let inner = NSSize(width: stack.fittingSize.width,
                           height: max(label.fittingSize.height, icon.fittingSize.height) + stack.edgeInsets.top + stack.edgeInsets.bottom)
        let glass = NSGlassEffectView(frame: NSRect(x: 8, y: 8, width: inner.width, height: inner.height))
        glass.cornerRadius = inner.height / 2
        glass.contentView = stack
        let container = NSView(frame: NSRect(x: 0, y: 0, width: inner.width + 16, height: inner.height + 16))
        container.addSubview(glass)
        return container
    }
}

@MainActor
final class QuickCapturePanel: NSObject, NSWindowDelegate {
    static let shared = QuickCapturePanel()
    private var panel: NSPanel?
    private var language: String?

    func show(draft: String = "") {
        if !draft.isEmpty { UserDefaults.standard.set(draft, forKey: MacPreferences.quickCaptureDraftKey) }
        if panel == nil || language != AppLanguage.current {
            panel?.orderOut(nil)
            panel = makePanel()
            language = AppLanguage.current
        }
        // An AppKit panel follows the system, not the scenes' preferredColorScheme, so it takes Teak's theme here.
        panel?.appearance = switch Appearance(rawValue: UserDefaults.standard.string(forKey: "teak.appearance") ?? "") {
        case .light: NSAppearance(named: .aqua)
        case .dark: NSAppearance(named: .darkAqua)
        case .auto, nil: nil
        }
        NSApp.activate()
        panel?.center()
        panel?.makeKeyAndOrderFront(nil)
    }

    func close() { panel?.orderOut(nil) }

    private func makePanel() -> NSPanel {
        let panel = NSPanel(contentRect: NSRect(x: 0, y: 0, width: 520, height: 260),
                            styleMask: [.titled, .closable, .resizable, .fullSizeContentView], backing: .buffered, defer: false)
        panel.title = tr("apple.mac.quickCaptureTitle")
        panel.titlebarAppearsTransparent = true
        panel.isFloatingPanel = true
        panel.level = .floating
        panel.hidesOnDeactivate = false
        panel.isReleasedWhenClosed = false
        panel.collectionBehavior = [.moveToActiveSpace, .fullScreenAuxiliary]
        panel.delegate = self
        let services = AppServices.shared
        panel.contentView = NSHostingView(rootView: QuickCaptureView(onClose: { [weak self] in self?.close() })
            .environment(services.capture)
            .environment(services.app)
            .fontDesign(.rounded)
            .tint(.accentColor))
        return panel
    }
}

private struct QuickCaptureView: View {
    let onClose: () -> Void
    @Environment(CaptureModel.self) private var capture
    @Environment(AppModel.self) private var app
    @AppStorage(MacPreferences.quickCaptureDraftKey) private var text = ""
    @State private var choosingFiles = false
    @FocusState private var focused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            TextEditor(text: $text)
                .font(.body)
                .scrollContentBackground(.hidden)
                .focused($focused)
                .disabled(capture.isSavingText)
                .accessibilityLabel(tr("native.capture.notePlaceholder"))
                .accessibilityIdentifier("composer.text")
                .overlay(alignment: .topLeading) {
                    if text.isEmpty {
                        // The text view pads each line by 5pt, so the placeholder starts where the caret does.
                        Text(tr("native.capture.notePlaceholder"))
                            .foregroundStyle(.secondary)
                            .padding(.leading, 5)
                            .allowsHitTesting(false)
                    }
                }
            HStack {
                Button(tr("native.capture.chooseFiles"), systemImage: "paperclip") { choosingFiles = true }
                Spacer()
                Button(tr("common.cancel"), action: onClose).keyboardShortcut(.cancelAction)
                Button(tr("common.save"), action: save)
                    .keyboardShortcut(.return, modifiers: .command)
                    .buttonStyle(.glassProminent)
                    .disabled(capture.isSavingText || text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    .accessibilityIdentifier("composer.save")
            }
        }
        .padding(.horizontal, 20)
        .padding(.top, 32)
        .padding(.bottom, 16)
        .frame(minWidth: 420, minHeight: 200)
        .onAppear { focused = true }
        .fileImporter(isPresented: $choosingFiles, allowedContentTypes: [.item], allowsMultipleSelection: true) { result in
            guard case let .success(urls) = result else { return }
            onClose()
            BackgroundCapture.save(urls.compactMap { try? ItemProviders.copyPicked($0) }.map(SharedItem.file))
        }
    }

    private func save() {
        guard app.user != nil else {
            CaptureHUD.show(tr("apple.mac.signInFirst"), isError: true)
            return
        }
        Task {
            if await capture.saveText(text) != nil {
                text = ""
                onClose()
                CaptureHUD.show(capture.lastSaved ?? tr("native.capture.savedToTeak"))
            } else if let alert = capture.alert {
                capture.alert = nil
                CaptureHUD.show(alert.message, isError: true)
            }
        }
    }
}

private func fourCharCode(_ code: String) -> OSType {
    code.utf8.reduce(0) { $0 << 8 | OSType($1) }
}

/// The global ⌃⌥⌘T shortcut. SwiftUI has no system-wide hotkey, so this uses Carbon.
@MainActor
final class QuickCaptureHotKey {
    static let shared = QuickCaptureHotKey()
    private var hotKey: EventHotKeyRef?
    private var handler: EventHandlerRef?

    func sync(enabled: Bool) {
        enabled ? register() : unregister()
    }

    private func register() {
        guard hotKey == nil else { return }
        var spec = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        InstallEventHandler(GetApplicationEventTarget(), { _, _, _ in
            Task { @MainActor in QuickCapturePanel.shared.show() }
            return noErr
        }, 1, &spec, nil, &handler)
        let id = EventHotKeyID(signature: fourCharCode("TEAK"), id: 1)
        let status = RegisterEventHotKey(UInt32(kVK_ANSI_T), UInt32(controlKey | optionKey | cmdKey), id,
                                         GetApplicationEventTarget(), 0, &hotKey)
        // Another app may hold the shortcut; leave nothing half registered.
        if status != noErr { unregister() }
    }

    private func unregister() {
        if let hotKey { UnregisterEventHotKey(hotKey) }
        if let handler { RemoveEventHandler(handler) }
        hotKey = nil
        handler = nil
    }
}

final class TeakServicesProvider: NSObject {
    @objc func saveToTeak(_ pasteboard: NSPasteboard, userData: String?, error: AutoreleasingUnsafeMutablePointer<NSString?>) {
        nonisolated(unsafe) let pasteboard = pasteboard
        MainActor.assumeIsolated {
            BackgroundCapture.save(PasteboardReader.items(from: pasteboard))
        }
    }
}

/// The opt-in menu bar item. `MenuBarExtra` can't take drops, so this uses
/// `NSStatusItem`: dropping files or text on the icon saves them.
@MainActor
final class MenuBarItem: NSObject, NSMenuDelegate, NSDraggingDestination, NSWindowDelegate {
    static let shared = MenuBarItem()
    private var statusItem: NSStatusItem?
    private let menu = NSMenu()
    private let statusRow = NSMenuItem(title: "", action: nil, keyEquivalent: "")
    private var titles: [(item: NSMenuItem, title: () -> String)] = []
    /// Drawn over the button while a drop saves, since a button's own image can't run symbol effects.
    private let stateIcon = StateIconView()
    private var savingCount = 0
    private var anyFailed = false
    private var resetTask: Task<Void, Never>?

    private final class StateIconView: NSImageView {
        // Clicks and drops belong to the button underneath.
        override func hitTest(_ point: NSPoint) -> NSView? { nil }
    }

    override init() {
        super.init()
        statusRow.isEnabled = false
        menu.delegate = self
        menu.addItem(statusRow)
        menu.addItem(.separator())
        add({ tr("apple.commands.quickCapture") }, #selector(quickCapture))
        add({ tr("apple.commands.voiceMemo") }, #selector(voiceMemo))
        add({ tr("apple.commands.pasteAsNewCard") }, #selector(paste))
        menu.addItem(.separator())
        add({ tr("apple.mac.openLibrary") }, #selector(openLibrary))
        add({ tr("apple.mac.settings") }, #selector(showTeakSettings))
        menu.addItem(.separator())
        add({ tr("apple.mac.quit") }, #selector(quit))
    }

    private func add(_ title: @escaping () -> String, _ action: Selector) {
        let item = NSMenuItem(title: title(), action: action, keyEquivalent: "")
        item.target = self
        if #available(macOS 27, *) { item.preferredImageVisibility = .hidden }
        menu.addItem(item)
        titles.append((item, title))
    }

    func sync(enabled: Bool) {
        if enabled, statusItem == nil {
            let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
            if let button = item.button {
                button.image = Self.appIcon
                button.setAccessibilityLabel("Teak")
                button.toolTip = tr("apple.mac.menuBarTooltip")
                button.window?.registerForDraggedTypes([.fileURL, .URL, .string, .png, .tiff])
                button.window?.delegate = self
                stateIcon.frame = button.bounds
                stateIcon.autoresizingMask = [.width, .height]
                stateIcon.isHidden = true
                button.addSubview(stateIcon)
            }
            item.menu = menu
            statusItem = item
        } else if !enabled, let item = statusItem {
            showIdle()
            stateIcon.removeFromSuperview()
            NSStatusBar.system.removeStatusItem(item)
            statusItem = nil
        }
    }

    private static var appIcon: NSImage? {
        let image = NSImage(named: "MenuBarIcon")
        image?.size = NSSize(width: 18, height: 18)
        image?.isTemplate = true
        return image
    }

    private static func symbol(_ name: String) -> NSImage? {
        NSImage(systemSymbolName: name, accessibilityDescription: nil)?
            .withSymbolConfiguration(.init(pointSize: 15, weight: .medium))
    }

    // Saving bounces an upload arrow; when every drop is done the icon shows
    // a check (or a warning) for a moment, then goes back to Teak's.
    private func showSaving() {
        savingCount += 1
        resetTask?.cancel()
        guard savingCount == 1, let button = statusItem?.button else { return }
        button.image = nil
        stateIcon.isHidden = false
        stateIcon.removeAllSymbolEffects(animated: false)
        stateIcon.image = Self.symbol("arrow.up.circle")
        stateIcon.addSymbolEffect(.bounce.up, options: .repeat(.continuous))
    }

    private func finishSaving(_ saved: Bool) {
        savingCount = max(0, savingCount - 1)
        anyFailed = anyFailed || !saved
        guard savingCount == 0, statusItem != nil else { return }
        let failed = anyFailed
        anyFailed = false
        stateIcon.removeAllSymbolEffects()
        if let image = Self.symbol(failed ? "exclamationmark.circle" : "checkmark.circle") {
            stateIcon.setSymbolImage(image, contentTransition: .replace)
        }
        if failed {
            stateIcon.addSymbolEffect(.wiggle, options: .nonRepeating)
        } else {
            stateIcon.addSymbolEffect(.bounce, options: .nonRepeating)
        }
        resetTask = Task {
            try? await Task.sleep(for: .seconds(failed ? 2.5 : 1.5))
            guard !Task.isCancelled else { return }
            showIdle()
        }
    }

    private func showIdle() {
        resetTask?.cancel()
        savingCount = 0
        anyFailed = false
        stateIcon.removeAllSymbolEffects(animated: false)
        stateIcon.isHidden = true
        statusItem?.button?.image = Self.appIcon
    }

    func menuWillOpen(_ menu: NSMenu) {
        let services = AppServices.shared
        if let email = services.app.user?.email {
            statusRow.title = services.app.isConnected ? tr("apple.mac.signedInAs", email) : tr("apple.mac.offline", email)
        } else {
            statusRow.title = tr("apple.mac.signedOut")
        }
        for (item, title) in titles { item.title = title() }
        statusItem?.button?.toolTip = tr("apple.mac.menuBarTooltip")
    }

    @objc private func quickCapture() { QuickCapturePanel.shared.show() }
    @objc private func voiceMemo() {
        let services = AppServices.shared
        guard services.app.user != nil else {
            CaptureHUD.show(tr("apple.mac.signInFirst"), isError: true)
            return services.showMainWindow()
        }
        services.router.record()
    }
    @objc private func paste() { BackgroundCapture.save(PasteboardReader.items(from: .general)) }
    @objc private func openLibrary() { AppServices.shared.showMainWindow() }
    // Not "openSettings": macOS 26 adds a gear to items with that action.
    @objc private func showTeakSettings() { AppServices.shared.showSettings() }
    @objc private func quit() { NSApp.terminate(nil) }

    func draggingEntered(_ sender: any NSDraggingInfo) -> NSDragOperation {
        PasteboardReader.items(from: sender.draggingPasteboard).isEmpty ? [] : .copy
    }

    func performDragOperation(_ sender: any NSDraggingInfo) -> Bool {
        let items = PasteboardReader.items(from: sender.draggingPasteboard)
        guard !items.isEmpty else { return false }
        showSaving()
        BackgroundCapture.save(items) { [weak self] saved in self?.finishSaving(saved) }
        return true
    }
}

final class MacAppDelegate: NSObject, NSApplicationDelegate {
    private let services = TeakServicesProvider()

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.servicesProvider = services
        NSUpdateDynamicServices()
        MainActor.assumeIsolated {
            let defaults = UserDefaults.standard
            MenuBarItem.shared.sync(enabled: defaults.bool(forKey: MacPreferences.menuBarKey))
            QuickCaptureHotKey.shared.sync(enabled: defaults.bool(forKey: MacPreferences.quickCaptureKey))
        }
    }

    /// Teak keeps running while the menu bar item or the ⌃⌥⌘T shortcut
    /// can still be used with no window open.
    /// A Dock click with no window open brings the library back. Until it
    /// has shown once, SwiftUI opens it itself.
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows: Bool) -> Bool {
        guard !hasVisibleWindows else { return true }
        return MainActor.assumeIsolated {
            guard AppServices.shared.openMainWindow != nil else { return true }
            AppServices.shared.showMainWindow()
            return false
        }
    }

    /// `teak://` links land here rather than in a window's `onOpenURL`, so
    /// they work while the main window is closed: it opens, then follows them.
    func application(_ application: NSApplication, open urls: [URL]) {
        MainActor.assumeIsolated {
            let services = AppServices.shared
            services.showMainWindow()
            for url in urls { services.router.handle(url, phase: services.app.phase) }
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        let defaults = UserDefaults.standard
        return !defaults.bool(forKey: MacPreferences.menuBarKey) && !defaults.bool(forKey: MacPreferences.quickCaptureKey)
    }
}

struct MacOptionsSection: View {
    @AppStorage(MacPreferences.menuBarKey) private var menuBar = false
    @AppStorage(MacPreferences.quickCaptureKey) private var quickCapture = false

    var body: some View {
        Section(tr("apple.mac.capture")) {
            Toggle(tr("apple.mac.showInMenuBar"), isOn: $menuBar)
                .onChange(of: menuBar) { _, enabled in MenuBarItem.shared.sync(enabled: enabled) }
            Toggle(isOn: $quickCapture) {
                Text(tr("apple.mac.quickCaptureShortcut"))
                Text(tr("apple.mac.quickCaptureHint"))
            }
            .onChange(of: quickCapture) { _, enabled in QuickCaptureHotKey.shared.sync(enabled: enabled) }
        }
    }
}
#endif
