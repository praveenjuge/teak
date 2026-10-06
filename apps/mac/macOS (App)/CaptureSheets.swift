import AppKit
import Combine
import SwiftUI

/// Owned by the library so filtering never discards an unsaved note.
@MainActor
final class LibraryNoteDraft: ObservableObject {
    @Published var text = "" {
        didSet { if text != oldValue { key = UUID().uuidString } }
    }
    @Published var expanded = false
    @Published var saving = false
    @Published var error: String?
    private var key = UUID().uuidString

    func save(onCreated: (String) -> Void, onAuthenticationRequired: () -> Void) async {
        guard !saving else { return }
        saving = true
        defer { saving = false }
        do {
            let id = try await LibraryAPI().createText(text, idempotencyKey: key)
            text = ""
            expanded = false
            error = nil
            onCreated(id)
        } catch SafariServiceError.unauthenticated { onAuthenticationRequired() }
        catch { self.error = error.localizedDescription }
    }
}

struct NoteComposer: View {
    @ObservedObject var draft: LibraryNoteDraft
    var isExpanded = false
    let onCreated: (String) -> Void
    let onAuthenticationRequired: () -> Void
    @FocusState private var editorFocused: Bool

    var body: some View {
        if isExpanded {
            VStack {
                editor
                HStack {
                    Button("Close") { draft.expanded = false }.keyboardShortcut(.cancelAction).disabled(draft.saving)
                    Spacer()
                    saveButton
                }
                errorMessage
            }
            .scenePadding()
            .frame(minWidth: 600, minHeight: 400)
            .interactiveDismissDisabled(draft.saving)
        } else {
            GroupBox {
                VStack {
                    editor.frame(minHeight: 100, maxHeight: 160).padding(12)
                    if !draft.text.isEmpty {
                        HStack {
                            Button("Open full-screen note", systemImage: "arrow.up.left.and.arrow.down.right") { draft.expanded = true }
                            Spacer()
                            saveButton
                        }
                    }
                    errorMessage
                }
            }
            .contentShape(Rectangle())
            .onTapGesture { editorFocused = true }
            .overlay { if draft.saving { ProgressView() } }
        }
    }

    private var editor: some View {
        TextEditor(text: $draft.text)
            .font(.body)
            .scrollContentBackground(.hidden)
            .focused($editorFocused)
            .disabled(draft.saving)
            .accessibilityLabel("Write a note...")
            .overlay(alignment: .topLeading) {
                if draft.text.isEmpty {
                    Text("Write a note...").foregroundStyle(.secondary).allowsHitTesting(false)
                }
            }
    }

    @ViewBuilder private var errorMessage: some View {
        if let error = draft.error { Text(error).foregroundStyle(.red) }
    }

    private var saveButton: some View {
        Button("Save") { Task { await draft.save(onCreated: onCreated, onAuthenticationRequired: onAuthenticationRequired) } }
            .keyboardShortcut(.return, modifiers: .command)
            .disabled(draft.saving || draft.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
    }
}
