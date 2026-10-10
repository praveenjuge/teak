import SwiftUI
import TeakCore

/// New Note: one field for a note or a pasted link. ⌘↩ saves.
struct NoteComposerView: View {
    @Environment(CaptureModel.self) private var capture
    @Environment(AppRouter.self) private var router
    @Environment(\.dismiss) private var dismiss
    @FocusState private var focused: Bool

    var body: some View {
        @Bindable var router = router
        NavigationStack {
            TextEditor(text: $router.composerText)
                .focused($focused)
                .accessibilityLabel("Write a note or paste a link")
                .accessibilityIdentifier("composer.text")
                .scrollContentBackground(.hidden)
                .padding(.horizontal, 12)
                .overlay(alignment: .topLeading) {
                    if router.composerText.isEmpty {
                        Text("Write a note or paste a link")
                            .foregroundStyle(.tertiary)
                            .padding(.horizontal, 17)
                            .padding(.top, 8)
                            .allowsHitTesting(false)
                    }
                }
                .navigationTitle("New Note")
                #if os(iOS)
                .navigationBarTitleDisplayMode(.inline)
                #endif
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Cancel") { dismiss() }
                    }
                    ToolbarItem(placement: .confirmationAction) {
                        Button(capture.isSavingText ? "Saving…" : "Save") { save() }
                            .buttonStyle(.glassProminent)
                            .disabled(capture.isSavingText || router.composerText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                            .keyboardShortcut(.return, modifiers: .command)
                            .accessibilityHint("Saves this text card.")
                            .accessibilityIdentifier("composer.save")
                    }
                }
        }
        .frame(minWidth: 420, minHeight: 320)
        .onAppear { focused = true }
    }

    private func save() {
        Task {
            if await capture.saveText(router.composerText) != nil {
                router.composerText = ""
                // Like the iPhone app, a saved note lands back in the library.
                router.tab = .home
                dismiss()
            }
        }
    }
}

/// The composer as the first tile of the grid on iPad and Mac.
struct InlineComposerTile: View {
    let width: Double
    @Environment(CaptureModel.self) private var capture
    @State private var text = ""
    @FocusState private var focused: Bool

    var body: some View {
        VStack(alignment: .trailing, spacing: 8) {
            TextField("Write a note or paste a link", text: $text, axis: .vertical)
                .lineLimit(2...8)
                .textFieldStyle(.plain)
                .focused($focused)
                .onSubmit { if !text.contains("\n") { save() } }
            if focused || !text.isEmpty {
                Button(capture.isSavingText ? "Saving…" : "Save", action: save)
                    .buttonStyle(.glassProminent)
                    .controlSize(.small)
                    .keyboardShortcut(.return, modifiers: .command)
                    .disabled(capture.isSavingText || text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
        .padding(14)
        .frame(width: width, alignment: .leading)
        .background(.background.secondary, in: .rect(cornerRadius: CardGrid.tileRadius, style: .continuous))
        .animation(.smooth, value: focused)
    }

    private func save() {
        Task {
            if await capture.saveText(text) != nil {
                text = ""
                focused = false
            }
        }
    }
}
