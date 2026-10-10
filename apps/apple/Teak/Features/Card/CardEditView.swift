import SwiftUI
import TeakCore

/// Edits a card's content (notes and quotes), notes and tags. Saves one field
/// update per change.
struct CardEditView: View {
    let cardId: String
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var model: CardDetailModel?
    @State private var draft: CardEditDraft?
    @State private var newTag = ""
    @State private var error: String?
    @State private var confirmDiscard = false
    @FocusState private var tagFieldFocused: Bool

    var body: some View {
        NavigationStack {
            Group {
                if let card = model?.card, let draft {
                    form(card, Binding(get: { draft }, set: { self.draft = $0 }))
                } else if model?.isLoading == false {
                    ContentUnavailableView("Card unavailable", systemImage: "exclamationmark.triangle",
                                           description: Text("It may have been deleted."))
                } else {
                    ProgressView()
                }
            }
            .navigationTitle("Edit Card")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { hasChanges ? (confirmDiscard = true) : dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(model?.isSaving == true ? "Saving…" : "Save") { save() }
                        .disabled(!hasChanges || model?.isSaving == true)
                        .keyboardShortcut(.return, modifiers: .command)
                }
            }
            .confirmationDialog("Discard Changes?", isPresented: $confirmDiscard) {
                Button("Discard Changes", role: .destructive) { dismiss() }
                Button("Keep Editing", role: .cancel) {}
            }
            .alert("Couldn't save changes", isPresented: .constant(error != nil)) {
                Button("OK") { error = nil }
            } message: {
                Text(error ?? "")
            }
        }
        .interactiveDismissDisabled(hasChanges)
        .frame(minWidth: 420, minHeight: 480)
        .task {
            if model == nil { model = CardDetailModel(id: cardId, backend: app.backend) }
            model?.start()
        }
        .onChange(of: model?.card) { _, card in
            if draft == nil, let card { draft = CardEdit.draft(for: card) }
        }
        .onDisappear { model?.stop() }
    }

    private var hasChanges: Bool {
        guard let card = model?.card, let draft else { return false }
        return !CardEdit.changes(from: card, to: draft).isEmpty || !newTag.trimmingCharacters(in: .whitespaces).isEmpty
    }

    private func form(_ card: Card, _ draft: Binding<CardEditDraft>) -> some View {
        Form {
            if CardEdit.canEditContent(card.type) {
                Section(card.type == .quote ? "Quote" : "Note") {
                    TextField(card.type == .quote ? "Write the quote" : "Write a note",
                              text: Binding(get: { draft.wrappedValue.content ?? "" }, set: { draft.wrappedValue.content = $0 }),
                              axis: .vertical)
                        .lineLimit(4...16)
                }
            }
            Section("Notes") {
                TextField("Add notes", text: draft.notes, axis: .vertical)
                    .lineLimit(3...10)
            }
            Section("Tags") {
                ForEach(draft.wrappedValue.tags, id: \.self) { tag in
                    HStack {
                        Text(tag)
                        Spacer()
                        Button("Remove \(tag)", systemImage: "xmark.circle.fill") {
                            draft.wrappedValue.tags.removeAll { $0 == tag }
                        }
                        .labelStyle(.iconOnly)
                        .buttonStyle(.borderless)
                        .foregroundStyle(.secondary)
                    }
                }
                HStack {
                    TextField("Add a tag", text: $newTag)
                        .focused($tagFieldFocused)
                        .onSubmit { addTag(draft) }
                        #if os(iOS)
                        .textInputAutocapitalization(.never)
                        #endif
                    Button("Add") { addTag(draft) }
                        .disabled(newTag.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
            if !draft.wrappedValue.aiTags.isEmpty {
                Section {
                    ForEach(draft.wrappedValue.aiTags, id: \.self) { tag in
                        HStack {
                            Label(tag, systemImage: "sparkles")
                            Spacer()
                            Button("Remove \(tag)", systemImage: "xmark.circle.fill") {
                                draft.wrappedValue.aiTags.removeAll { $0 == tag }
                            }
                            .labelStyle(.iconOnly)
                            .buttonStyle(.borderless)
                            .foregroundStyle(.secondary)
                        }
                    }
                } header: {
                    Text("Tags by Teak")
                }
            }
        }
        .formStyle(.grouped)
    }

    private func addTag(_ draft: Binding<CardEditDraft>) {
        draft.wrappedValue.tags = CardEdit.adding(newTag, to: draft.wrappedValue.tags)
        newTag = ""
        tagFieldFocused = true
    }

    private func save() {
        guard let model, let card = model.card, var edit = draft else { return }
        if !newTag.trimmingCharacters(in: .whitespaces).isEmpty {
            edit.tags = CardEdit.adding(newTag, to: edit.tags)
        }
        if let validation = CardEdit.validationError(for: card, draft: edit) {
            error = validation
            return
        }
        Task {
            do {
                try await model.save(CardEdit.changes(from: card, to: edit))
                dismiss()
            } catch {
                self.error = error.teakMessage
            }
        }
    }
}
