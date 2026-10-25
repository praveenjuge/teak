#if os(macOS)
import AppKit
import Carbon.HIToolbox
import SwiftUI
import TeakCore
import UniformTypeIdentifiers

enum MacPreferences {
    static let menuBarKey = "teak.menuBarItemEnabled"
    static let quickCaptureKey = "teak.quickCaptureShortcutEnabled"
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
    static func save(_ items: [SharedItem]) {
        let services = AppServices.shared
        guard !items.isEmpty else { return CaptureHUD.show(tr("apple.mac.clipboardEmpty"), isError: true) }
        guard services.app.user != nil else {
            CaptureHUD.show(tr("apple.mac.signInFirst"), isError: true)
            services.showMainWindow()
            return
        }
        Task {
            let before = services.capture.savedCount
            await services.capture.save(items)
            if let alert = services.capture.alert {
                services.capture.alert = nil
                CaptureHUD.show(alert.isCardLimit ? tr("native.capture.cardLimitMessage") : alert.message, isError: true)
            } else if services.capture.savedCount > before {
                CaptureHUD.show(services.capture.lastSaved ?? tr("native.capture.savedToTeak"))
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
        let content = NSHostingView(rootView: HUDView(message: message, isError: isError))
        content.layoutSubtreeIfNeeded()
        let size = content.fittingSize
        let hud = NSPanel(contentRect: NSRect(origin: .zero, size: size), styleMask: [.borderless, .nonactivatingPanel],
                          backing: .buffered, defer: false)
        hud.isOpaque = false
        hud.backgroundColor = .clear
        hud.level = .statusBar
        hud.hasShadow = false
        hud.ignoresMouseEvents = true
        hud.collectionBehavior = [.canJoinAllSpaces, .transient]
        hud.contentView = content
        if let screen = NSScreen.main?.visibleFrame {
            hud.setFrameOrigin(NSPoint(x: screen.midX - size.width / 2, y: screen.maxY - size.height - 24))
        }
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

    private struct HUDView: View {
        let message: String
        let isError: Bool

        var body: some View {
            Label(message, systemImage: isError ? "exclamationmark.circle.fill" : "checkmark.circle.fill")
                .font(.body.weight(.medium))
                .fontDesign(.rounded)
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                .glassEffect(.regular, in: .capsule)
                .padding(8)
        }
    }
}

@MainActor
final class QuickCapturePanel: NSObject, NSWindowDelegate {
    static let shared = QuickCapturePanel()
    private var panel: NSPanel?
    /// The language the panel was built in; a new one rebuilds it.
    private var language: String?

    func show() {
        if panel == nil || language != AppLanguage.current {
            panel?.orderOut(nil)
            panel = makePanel()
            language = AppLanguage.current
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
    @AppStorage("teak.quickCaptureDraft") private var text = ""
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
                .overlay(alignment: .topLeading) {
                    if text.isEmpty {
                        Text(tr("native.capture.notePlaceholder")).foregroundStyle(.secondary).allowsHitTesting(false)
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
        RegisterEventHotKey(UInt32(kVK_ANSI_T), UInt32(controlKey | optionKey | cmdKey), id,
                            GetApplicationEventTarget(), 0, &hotKey)
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
    /// Each item's title, read again when the menu opens so it follows the app's language.
    private var titles: [(item: NSMenuItem, title: () -> String)] = []

    override init() {
        super.init()
        statusRow.isEnabled = false
        menu.delegate = self
        menu.addItem(statusRow)
        menu.addItem(.separator())
        add({ tr("apple.commands.quickCapture") }, #selector(quickCapture))
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
                button.image = NSImage(named: "MenuBarIcon")
                button.image?.size = NSSize(width: 18, height: 18)
                button.image?.isTemplate = true
                button.setAccessibilityLabel("Teak")
                button.toolTip = tr("apple.mac.menuBarTooltip")
                button.window?.registerForDraggedTypes([.fileURL, .URL, .string, .png, .tiff])
                button.window?.delegate = self
            }
            item.menu = menu
            statusItem = item
        } else if !enabled, let item = statusItem {
            NSStatusBar.system.removeStatusItem(item)
            statusItem = nil
        }
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
        BackgroundCapture.save(items)
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

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        !UserDefaults.standard.bool(forKey: MacPreferences.menuBarKey)
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
