import AppKit
import SwiftUI
import UniformTypeIdentifiers

enum LibraryCapture: String, Identifiable {
    case note, quote, file, audio
    var id: String { rawValue }
    var title: String {
        switch self {
        case .note: "New note"
        case .quote: "New quote"
        case .file: "Upload a file"
        case .audio: "Record audio"
        }
    }
}

struct TextCaptureSheet: View {
    let kind: LibraryCapture
    let onCreated: (String) -> Void
    let onAuthenticationRequired: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @State private var idempotencyKey = UUID().uuidString
    @State private var error: String?
    @State private var isSaving = false

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text(kind.title).font(.title3.weight(.semibold))
            TextEditor(text: $text).disabled(isSaving)
                .onChange(of: text) { _, _ in idempotencyKey = UUID().uuidString }
                .frame(height: 180).accessibilityLabel(kind == .quote ? "Quote" : "Note")
            if let error { Text(error).font(.caption).foregroundStyle(.red) }
            HStack {
                Spacer()
                Button("Cancel") { dismiss() }.disabled(isSaving)
                Button(isSaving ? "Saving…" : "Save") { Task { await save() } }
                    .buttonStyle(.borderedProminent)
                    .disabled(isSaving || text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
        .padding(24).frame(width: 460)
        .interactiveDismissDisabled(isSaving)
    }

    private func save() async {
        guard !isSaving else { return }
        isSaving = true
        defer { isSaving = false }
        do {
            let api = LibraryAPI()
            let id = try await kind == .quote ? api.createQuote(text, idempotencyKey: idempotencyKey) : api.createText(text, idempotencyKey: idempotencyKey)
            onCreated(id)
            dismiss()
        } catch SafariServiceError.unauthenticated { onAuthenticationRequired() }
        catch { self.error = error.localizedDescription }
    }
}

struct FileCaptureSheet: View {
    let onCreated: (String) -> Void
    let onAuthenticationRequired: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var file: URL?
    @State private var error: String?
    @State private var isSaving = false
    @State private var api = LibraryAPI()
    @State private var idempotencyKey = UUID().uuidString

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Upload a file").font(.title3.weight(.semibold))
            Text(file?.lastPathComponent ?? "Choose an image, video, audio file, or document.")
                .lineLimit(2).foregroundStyle(.secondary)
            Button("Choose File…") { choose() }.disabled(isSaving)
            if let error { Text(error).font(.caption).foregroundStyle(.red) }
            HStack {
                Spacer()
                Button("Cancel") { dismiss() }.disabled(isSaving)
                Button(isSaving ? "Uploading…" : "Upload") { Task { await save() } }
                    .buttonStyle(.borderedProminent).disabled(isSaving || file == nil)
            }
        }
        .padding(24).frame(width: 460)
        .interactiveDismissDisabled(isSaving)
    }

    private func choose() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = false
        guard panel.runModal() == .OK else { return }
        file = panel.url
        error = nil
        idempotencyKey = UUID().uuidString
    }

    private func save() async {
        guard !isSaving, let file else { return }
        isSaving = true
        defer { isSaving = false }
        do {
            let mime = UTType(filenameExtension: file.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
            let id = try await api.createFile(file, mimeType: mime, idempotencyKey: idempotencyKey)
            onCreated(id)
            dismiss()
        } catch SafariServiceError.unauthenticated { onAuthenticationRequired() }
        catch { self.error = error.localizedDescription }
    }
}

struct EditCardSheet: View {
    let card: LibraryCard
    @ObservedObject var store: LibraryStore
    let onUpdated: (LibraryCard) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var title: String
    @State private var content: String
    @State private var notes: String
    @State private var tags: String
    @State private var error: String?
    @State private var isSaving = false

    init(card: LibraryCard, store: LibraryStore, onUpdated: @escaping (LibraryCard) -> Void) {
        self.card = card
        self.store = store
        self.onUpdated = onUpdated
        _title = State(initialValue: card.metadataTitle ?? "")
        _content = State(initialValue: card.content ?? "")
        _notes = State(initialValue: card.notes ?? "")
        _tags = State(initialValue: card.tags.joined(separator: ", "))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Edit card").font(.title3.weight(.semibold))
            TextField("Title", text: $title).accessibilityLabel("Title")
            if card.cardType == .text || card.cardType == .quote {
                Text("Content").font(.caption).foregroundStyle(.secondary)
                TextEditor(text: $content).frame(height: 130).accessibilityLabel("Content")
            }
            Text("Notes").font(.caption).foregroundStyle(.secondary)
            TextEditor(text: $notes).frame(height: 80).accessibilityLabel("Notes")
            TextField("Tags, separated by commas", text: $tags).accessibilityLabel("Tags")
            if let error { Text(error).font(.caption).foregroundStyle(.red) }
            HStack {
                Spacer()
                Button("Cancel") { dismiss() }.disabled(isSaving)
                Button(isSaving ? "Saving…" : "Save") { Task { await save() } }
                    .buttonStyle(.borderedProminent).disabled(isSaving || title.count > 512)
            }
        }
        .textFieldStyle(.roundedBorder)
        .padding(24).frame(width: 480)
        .interactiveDismissDisabled(isSaving)
    }

    private func save() async {
        guard !isSaving else { return }
        isSaving = true
        defer { isSaving = false }
        let parsed = Array(NSOrderedSet(array: tags.split(separator: ",").map {
            $0.trimmingCharacters(in: .whitespacesAndNewlines)
        }.filter { !$0.isEmpty })) as? [String] ?? []
        do {
            let updated = try await store.update(card, title: title, content: [.text, .quote].contains(card.cardType)
                ? content : nil, notes: notes, tags: parsed)
            onUpdated(updated)
            dismiss()
        } catch { self.error = error.localizedDescription }
    }
}
