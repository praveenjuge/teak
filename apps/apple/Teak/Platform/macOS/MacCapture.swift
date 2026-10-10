#if os(macOS)
import AppKit
import Carbon.HIToolbox
import SwiftUI
import TeakCore
import UniformTypeIdentifiers

/// Settings that only exist on the Mac.
enum MacPreferences {
    static let menuBarKey = "teak.menuBarItemEnabled"
    static let quickCaptureKey = "teak.quickCaptureShortcutEnabled"
}

/// Reads what a paste or drop carries the way the web does: files first, then
/// an image, then text.
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

/// Saves from outside the library window and confirms with the HUD, so
/// Services, the menu bar and Quick Capture never need the window open.
@MainActor
enum BackgroundCapture {
    static func save(_ items: [SharedItem]) {
        let services = AppServices.shared
        guard !items.isEmpty else { return CaptureHUD.show("The clipboard is empty", isError: true) }
        guard services.app.user != nil else {
            CaptureHUD.show("Sign in to Teak first", isError: true)
            services.showMainWindow()
            return
        }
        Task {
            let before = services.capture.savedCount
            await services.capture.save(items)
            if let alert = services.capture.alert {
                services.capture.alert = nil
                CaptureHUD.show(alert.isCardLimit ? "You've reached the Free plan's card limit" : alert.message, isError: true)
            } else if services.capture.savedCount > before {
                CaptureHUD.show(services.capture.lastSaved ?? "Saved to Teak")
            }
        }
    }
}

/// A brief, non-activating confirmation near the top of the screen, announced to VoiceOver.
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

/// A floating composer that opens from anywhere, like the web composer without switching apps.
@MainActor
final class QuickCapturePanel: NSObject, NSWindowDelegate {
    static let shared = QuickCapturePanel()
    private var panel: NSPanel?

    func show() {
        if panel == nil { panel = makePanel() }
        NSApp.activate()
        panel?.center()
        panel?.makeKeyAndOrderFront(nil)
    }

    func close() { panel?.orderOut(nil) }

    private func makePanel() -> NSPanel {
        let panel = NSPanel(contentRect: NSRect(x: 0, y: 0, width: 520, height: 260),
                            styleMask: [.titled, .closable, .resizable, .fullSizeContentView], backing: .buffered, defer: false)
        panel.title = "Quick Capture"
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
                .accessibilityLabel("Write a note or paste a link")
                .overlay(alignment: .topLeading) {
                    if text.isEmpty {
                        Text("Write a note or paste a link…").foregroundStyle(.secondary).allowsHitTesting(false)
                    }
                }
            HStack {
                Button("Choose Files…", systemImage: "paperclip") { choosingFiles = true }
                Spacer()
                Button("Cancel", action: onClose).keyboardShortcut(.cancelAction)
                Button("Save", action: save)
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
            CaptureHUD.show("Sign in to Teak first", isError: true)
            return
        }
        Task {
            if await capture.saveText(text) != nil {
                text = ""
                onClose()
                CaptureHUD.show(capture.lastSaved ?? "Saved to Teak")
            } else if let alert = capture.alert {
                capture.alert = nil
                CaptureHUD.show(alert.message, isError: true)
            }
        }
    }
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
        let id = EventHotKeyID(signature: OSType(0x5445_414B), id: 1) // "TEAK"
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

/// "Save to Teak" in every app's Services menu (text, URLs, files, images).
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

    override init() {
        super.init()
        statusRow.isEnabled = false
        menu.delegate = self
        menu.addItem(statusRow)
        menu.addItem(.separator())
        add("Quick Capture…", #selector(quickCapture))
        add("Paste as New Card", #selector(paste))
        menu.addItem(.separator())
        add("Open Teak Library", #selector(openLibrary))
        add("Settings…", #selector(openSettings))
        menu.addItem(.separator())
        add("Quit Teak", #selector(quit))
    }

    private func add(_ title: String, _ action: Selector) {
        let item = NSMenuItem(title: title, action: action, keyEquivalent: "")
        item.target = self
        menu.addItem(item)
    }

    func sync(enabled: Bool) {
        if enabled, statusItem == nil {
            let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
            if let button = item.button {
                button.image = NSImage(named: "MenuBarIcon")
                button.image?.size = NSSize(width: 18, height: 18)
                button.image?.isTemplate = true
                button.setAccessibilityLabel("Teak")
                button.toolTip = "Teak — drop files or text here to save them"
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
            statusRow.title = services.app.isConnected ? "Signed in as \(email)" : "Offline — \(email)"
        } else {
            statusRow.title = "Signed out — open Teak to sign in."
        }
    }

    @objc private func quickCapture() { QuickCapturePanel.shared.show() }
    @objc private func paste() { BackgroundCapture.save(PasteboardReader.items(from: .general)) }
    @objc private func openLibrary() { AppServices.shared.showMainWindow() }
    @objc private func openSettings() { AppServices.shared.showSettings() }
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

/// Wires the Mac-only pieces: Services, the hotkey and the menu bar item.
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

/// Settings for the menu bar item and the shortcut.
struct MacOptionsSection: View {
    @AppStorage(MacPreferences.menuBarKey) private var menuBar = false
    @AppStorage(MacPreferences.quickCaptureKey) private var quickCapture = false

    var body: some View {
        Section("Mac") {
            Toggle("Show Teak in the menu bar", isOn: $menuBar)
                .onChange(of: menuBar) { _, enabled in MenuBarItem.shared.sync(enabled: enabled) }
            Toggle(isOn: $quickCapture) {
                Text("Quick Capture shortcut")
                Text("Press ⌃⌥⌘T anywhere to write a note.")
            }
            .onChange(of: quickCapture) { _, enabled in QuickCaptureHotKey.shared.sync(enabled: enabled) }
        }
    }
}
#endif
