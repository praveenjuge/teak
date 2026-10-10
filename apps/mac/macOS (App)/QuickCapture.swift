import AppKit
import Carbon.HIToolbox
import SwiftUI
import UniformTypeIdentifiers

extension Notification.Name {
    /// Posted with the new card ID when a card is saved outside the library
    /// window (Services, the menu bar, quick capture), so an open library shows it.
    static let libraryCardCreated = Notification.Name("teak.library.cardCreated")
}

/// What a paste or drop carries, read the way the web reads a paste: files
/// first, then an image, then text.
enum PasteboardCapture {
    enum Content {
        case files([URL])
        case text(String)
    }

    static func read(_ pasteboard: NSPasteboard) -> Content? {
        let options: [NSPasteboard.ReadingOptionKey: Any] = [.urlReadingFileURLsOnly: true]
        if let files = pasteboard.readObjects(forClasses: [NSURL.self], options: options) as? [URL],
           !files.isEmpty {
            return .files(files)
        }
        if let image = pasteboard.readObjects(forClasses: [NSImage.self])?.first as? NSImage,
           let file = writeTemporaryPNG(image) {
            return .files([file])
        }
        if let text = pasteboard.string(forType: .string)?.trimmingCharacters(in: .whitespacesAndNewlines),
           !text.isEmpty {
            return .text(text)
        }
        return nil
    }

    static func mimeType(for file: URL) -> String {
        UTType(filenameExtension: file.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
    }

    /// Saves the content and returns the new card IDs. Text goes up as typed;
    /// Teak decides whether it's a link, quote, palette, or note.
    static func save(_ content: Content, api: LibraryAPI = LibraryAPI()) async throws -> [String] {
        switch content {
        case .text(let text):
            return [try await api.createText(text, idempotencyKey: UUID().uuidString)]
        case .files(let files):
            var ids: [String] = []
            for file in files {
                ids.append(try await api.createFile(file, mimeType: mimeType(for: file),
                                                    idempotencyKey: UUID().uuidString))
            }
            return ids
        }
    }

    private static func writeTemporaryPNG(_ image: NSImage) -> URL? {
        guard let tiff = image.tiffRepresentation,
              let png = NSBitmapImageRep(data: tiff)?.representation(using: .png, properties: [:]) else { return nil }
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("Pasted Images", isDirectory: true)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let stamp = ISO8601DateFormatter().string(from: Date()).replacingOccurrences(of: ":", with: ".")
        let file = folder.appendingPathComponent("Pasted Image \(stamp).png")
        do { try png.write(to: file) } catch { return nil }
        return file
    }
}

/// Saves from outside the library and confirms with a small HUD, so Services,
/// the menu bar, and quick capture never need the library window open.
@MainActor
enum BackgroundCapture {
    static func save(_ content: PasteboardCapture.Content) {
        Task { @MainActor in
            do {
                let ids = try await PasteboardCapture.save(content)
                for id in ids { NotificationCenter.default.post(name: .libraryCardCreated, object: id) }
                CaptureHUD.show(ids.count == 1 ? "Saved to Teak" : "Saved \(ids.count) cards to Teak")
            } catch SafariServiceError.unauthenticated {
                CaptureHUD.show("Sign in to Teak first", isError: true)
                (NSApp.delegate as? AppDelegate)?.showLibraryWindow()
            } catch SafariServiceError.cardLimit {
                CaptureHUD.show("You've reached the Free plan's card limit", isError: true)
            } catch {
                CaptureHUD.show(error.localizedDescription, isError: true)
            }
        }
    }
}

/// A brief, non-activating confirmation near the top of the screen.
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
        let hud = NSPanel(contentRect: NSRect(origin: .zero, size: size),
                          styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        hud.isOpaque = false
        hud.backgroundColor = .clear
        hud.level = .statusBar
        hud.hasShadow = true
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
        hideTask = Task { @MainActor in
            try? await Task.sleep(nanoseconds: 2_000_000_000)
            guard !Task.isCancelled else { return }
            hud.orderOut(nil)
        }
    }

    private struct HUDView: View {
        let message: String
        let isError: Bool

        var body: some View {
            Label(message, systemImage: isError ? "exclamationmark.circle.fill" : "checkmark.circle.fill")
                .font(.system(.body, design: .rounded).weight(.medium))
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                .background(.regularMaterial, in: Capsule())
                .padding(8)
        }
    }
}

/// A floating note composer that opens from anywhere with the quick capture
/// shortcut or the menu bar, like the web composer without switching apps.
@MainActor
final class QuickCaptureController: NSObject, NSWindowDelegate {
    static let shared = QuickCaptureController()
    private var panel: NSPanel?
    private let draft = LibraryNoteDraft()

    func show() {
        if panel == nil { panel = makePanel() }
        NSApp.activate(ignoringOtherApps: true)
        panel?.center()
        panel?.makeKeyAndOrderFront(nil)
    }

    func close() { panel?.orderOut(nil) }

    private func makePanel() -> NSPanel {
        let panel = NSPanel(contentRect: NSRect(x: 0, y: 0, width: 520, height: 260),
                            styleMask: [.titled, .closable, .resizable, .fullSizeContentView],
                            backing: .buffered, defer: false)
        panel.title = "Quick Capture"
        panel.titlebarAppearsTransparent = true
        panel.isFloatingPanel = true
        panel.level = .floating
        panel.hidesOnDeactivate = false
        panel.isReleasedWhenClosed = false
        panel.collectionBehavior = [.moveToActiveSpace, .fullScreenAuxiliary]
        panel.delegate = self
        panel.contentView = NSHostingView(rootView: QuickCaptureView(draft: draft, onClose: { [weak self] in
            self?.close()
        }))
        return panel
    }
}

private struct QuickCaptureView: View {
    @ObservedObject var draft: LibraryNoteDraft
    let onClose: () -> Void
    @FocusState private var focused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            TextEditor(text: $draft.text)
                .font(.body)
                .scrollContentBackground(.hidden)
                .focused($focused)
                .disabled(draft.saving)
                .accessibilityLabel("Write a note or paste a link")
                .overlay(alignment: .topLeading) {
                    if draft.text.isEmpty {
                        Text("Write a note or paste a link…").foregroundStyle(.secondary).allowsHitTesting(false)
                    }
                }
            if let error = draft.error { Text(error).foregroundStyle(.red).font(.callout) }
            HStack {
                Button("Choose Files…", systemImage: "paperclip", action: chooseFiles)
                Spacer()
                Button("Cancel", action: onClose).keyboardShortcut(.cancelAction)
                Button("Save") { save() }
                    .keyboardShortcut(.return, modifiers: .command)
                    .buttonStyle(.borderedProminent)
                    .disabled(draft.saving || draft.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
        .padding(.horizontal, 20)
        .padding(.top, 32)
        .padding(.bottom, 16)
        .frame(minWidth: 420, minHeight: 200)
        .fontDesign(.rounded)
        .onAppear { focused = true }
    }

    private func save() {
        Task { @MainActor in
            await draft.save(onCreated: { id in
                NotificationCenter.default.post(name: .libraryCardCreated, object: id)
                CaptureHUD.show("Saved to Teak")
                onClose()
            }, onAuthenticationRequired: {
                onClose()
                (NSApp.delegate as? AppDelegate)?.showLibraryWindow()
            })
        }
    }

    private func chooseFiles() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = true
        guard panel.runModal() == .OK, !panel.urls.isEmpty else { return }
        onClose()
        BackgroundCapture.save(.files(panel.urls))
    }
}

/// The system-wide quick capture shortcut, Control-Option-Command-T.
final class QuickCaptureHotKey {
    static let enabledDefaultsKey = "teak.quickCaptureShortcutEnabled"
    static let displayName = "⌃⌥⌘T"
    static var isEnabled: Bool {
        get { UserDefaults.standard.bool(forKey: enabledDefaultsKey) }
        set { UserDefaults.standard.set(newValue, forKey: enabledDefaultsKey) }
    }

    private var hotKey: EventHotKeyRef?
    private var handler: EventHandlerRef?
    private let action: () -> Void

    init(action: @escaping () -> Void) { self.action = action }

    func sync() {
        if Self.isEnabled { register() } else { unregister() }
    }

    private func register() {
        guard hotKey == nil else { return }
        var spec = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        let context = Unmanaged.passUnretained(self).toOpaque()
        InstallEventHandler(GetApplicationEventTarget(), { _, _, context in
            guard let context else { return noErr }
            let owner = Unmanaged<QuickCaptureHotKey>.fromOpaque(context).takeUnretainedValue()
            DispatchQueue.main.async { owner.action() }
            return noErr
        }, 1, &spec, context, &handler)
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

/// "Save to Teak" in the Services menu of any app, for selected text or files.
final class TeakServicesProvider: NSObject {
    @objc func saveToTeak(_ pasteboard: NSPasteboard, userData: String?,
                          error: AutoreleasingUnsafeMutablePointer<NSString?>) {
        guard let content = PasteboardCapture.read(pasteboard) else {
            error.pointee = "There's nothing to save." as NSString
            return
        }
        Task { @MainActor in BackgroundCapture.save(content) }
    }
}
