import SwiftUI
import TeakCore

struct CardEditView: View {
    let cardId: String
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var model: CardDetailModel?
    @State private var draft: CardEditDraft?
    @State private var base: Card?
    @State private var newTag = ""
    @State private var error: String?
    @State private var confirmDiscard = false
    @FocusState private var tagFieldFocused: Bool
    @State private var contentSelection: TextSelection?
    @State private var linkPicker: CardLinkPickerModel?

    var body: some View {
        NavigationStack {
            Group {
                if let card = model?.card, let draft {
                    form(card, Binding(get: { draft }, set: { self.draft = $0 }))
                } else if model?.isLoading == false {
                    ContentUnavailableView(tr("native.card.unavailable.title"), systemImage: "exclamationmark.triangle",
                                           description: Text(tr("native.card.unavailable.deletedMessage")))
                } else {
                    ProgressView()
                }
            }
            .navigationTitle(tr("native.card.edit.title"))
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(tr("common.cancel")) { hasChanges ? (confirmDiscard = true) : dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button { save() } label: {
                        Text(model?.isSaving == true ? tr("common.saving") : tr("common.save"))
                    }
                    .buttonStyle(.glassProminent)
                    .disabled(!hasChanges || model?.isSaving == true)
                    .keyboardShortcut(.return, modifiers: .command)
                }
            }
            .confirmationDialog(tr("native.card.edit.discardTitle"), isPresented: $confirmDiscard) {
                Button(tr("native.card.edit.discard"), role: .destructive) { dismiss() }
                Button(tr("native.card.edit.keepEditing"), role: .cancel) {}
            }
            .alert(tr("native.card.edit.saveFailed"), isPresented: Binding(presenting: $error)) {
                Button(tr("native.app.ok")) { error = nil }
            } message: {
                Text(error ?? "")
            }
        }
        .interactiveDismissDisabled(hasChanges)
        #if os(macOS)
        .frame(minWidth: 420, minHeight: 480)
        #endif
        .task {
            if model == nil { model = CardDetailModel(id: cardId, backend: app.backend) }
            if linkPicker == nil { linkPicker = CardLinkPickerModel(cardId: cardId, backend: app.backend) }
            model?.start()
        }
        .onChange(of: model?.card) { _, card in
            guard let card else { return }
            if let draft, let base {
                self.draft = CardEdit.rebased(draft, previous: base, card: card)
            } else {
                draft = CardEdit.draft(for: card)
            }
            base = card
        }
        .onDisappear { model?.stop() }
    }

    private var hasChanges: Bool {
        guard let card = model?.card, let draft else { return false }
        return !CardEdit.changes(from: card, to: draft).isEmpty || !newTag.trimmingCharacters(in: .whitespaces).isEmpty
    }

    private func form(_ card: Card, _ draft: Binding<CardEditDraft>) -> some View {
        Form {
            if card.type == .text {
                noteSection(draft)
            } else if CardEdit.canEditContent(card.type) {
                Section(tr("cards.types.quote")) {
                    TextField(tr("native.card.edit.quotePlaceholder"), text: contentBinding(draft),
                              prompt: Text(tr("native.card.edit.quotePlaceholder")), axis: .vertical)
                        .lineLimit(4...16)
                        .labelsHidden()
                }
            }
            Section(tr("native.card.sections.notes")) {
                TextField(tr("native.card.edit.notesPlaceholder"), text: draft.notes,
                          prompt: Text(tr("native.card.edit.notesPlaceholder")), axis: .vertical)
                    .lineLimit(3...10)
                    .labelsHidden()
                    .accessibilityIdentifier("edit.notes")
            }
            Section {
                ForEach(draft.wrappedValue.tags, id: \.self) { tag in
                    HStack {
                        Text(tag)
                        Spacer()
                        Button(tr("native.card.edit.removeTag", tag), systemImage: "xmark.circle.fill") {
                            draft.wrappedValue.tags.removeAll { $0 == tag }
                        }
                        .labelStyle(.iconOnly)
                        .buttonStyle(.borderless)
                        .foregroundStyle(.secondary)
                    }
                }
                HStack {
                    TextField(tr("native.card.edit.tagPlaceholder"), text: $newTag, prompt: Text(tr("native.card.edit.tagPlaceholder")))
                        .labelsHidden()
                        .focused($tagFieldFocused)
                        .accessibilityIdentifier("edit.tag")
                        .onSubmit { addTag(draft) }
                        #if os(iOS)
                        .textInputAutocapitalization(.never)
                        #endif
                    Button(tr("common.add")) { addTag(draft) }
                        .disabled(newTag.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            } header: {
                Text(tr("native.card.sections.tags"))
            } footer: {
                if let hint = HiddenTags.addedHint(before: card.tags, after: draft.wrappedValue.tags) {
                    Label(hint, systemImage: "eye.slash")
                        .accessibilityIdentifier("edit.hiddenHint")
                }
            }
            if !draft.wrappedValue.aiTags.isEmpty {
                Section {
                    ForEach(draft.wrappedValue.aiTags, id: \.self) { tag in
                        HStack {
                            Label {
                                Text(tag)
                            } icon: {
                                Image(systemName: "sparkles").foregroundStyle(.secondary)
                            }
                            Spacer()
                            Button(tr("native.card.edit.removeTag", tag), systemImage: "xmark.circle.fill") {
                                draft.wrappedValue.aiTags.removeAll { $0 == tag }
                            }
                            .labelStyle(.iconOnly)
                            .buttonStyle(.borderless)
                            .foregroundStyle(.secondary)
                        }
                    }
                } header: {
                    Text(tr("native.card.edit.aiTags"))
                }
            }
        }
        .formStyle(.grouped)
    }

    private func contentBinding(_ draft: Binding<CardEditDraft>) -> Binding<String> {
        Binding(get: { draft.wrappedValue.editableContent ?? "" }, set: { draft.wrappedValue.editableContent = $0 })
    }

    private func noteSection(_ draft: Binding<CardEditDraft>) -> some View {
        Section {
            // A Mac form shows a field's title as a leading label and right-aligns the text,
            // so the placeholder goes in the prompt and the label is hidden.
            TextField(tr("native.card.edit.notePlaceholder"), text: contentBinding(draft), selection: $contentSelection,
                      prompt: Text(tr("native.card.edit.notePlaceholder")), axis: .vertical)
                .lineLimit(4...16)
                .labelsHidden()
                .accessibilityIdentifier("edit.content")
                .onKeyPress(keys: [.escape, .upArrow, .downArrow, .return]) { press in
                    linkKey(press.key, draft)
                }
                .onChange(of: LinkEditPoint(text: draft.wrappedValue.editableContent ?? "", selection: contentSelection)) { _, point in
                    linkPicker?.update(text: point.text, cursor: point.cursor)
                }
            if let linkPicker, linkPicker.isOpen {
                CardLinkPicker(model: linkPicker) { pickLink($0, draft) }
            }
        } header: {
            Text(tr("native.card.note"))
        } footer: {
            Text(tr("native.linkPicker.hint"))
        }
    }

    private func linkKey(_ key: KeyEquivalent, _ draft: Binding<CardEditDraft>) -> KeyPress.Result {
        guard let linkPicker, linkPicker.isOpen else { return .ignored }
        switch key {
        case .escape: linkPicker.dismiss()
        case .upArrow, .downArrow:
            guard linkPicker.highlightedCard != nil else { return .ignored }
            linkPicker.moveHighlight(by: key == .upArrow ? -1 : 1)
        default:
            guard let card = linkPicker.highlightedCard else { return .ignored }
            pickLink(card, draft)
        }
        return .handled
    }

    private func pickLink(_ card: LinkedCard, _ draft: Binding<CardEditDraft>) {
        guard let result = linkPicker?.pick(card, in: draft.wrappedValue.editableContent ?? "") else { return }
        draft.wrappedValue.editableContent = result.text
        contentSelection = TextSelection(insertionPoint: String.Index(utf16Offset: result.cursor, in: result.text))
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
