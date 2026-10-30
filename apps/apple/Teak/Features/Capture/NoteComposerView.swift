import SwiftUI
import TeakCore

struct NoteComposerView: View {
    @Environment(CaptureModel.self) private var capture
    @Environment(AppRouter.self) private var router
    @Environment(\.dismiss) private var dismiss
    /// Local, so typing re-renders only this sheet. A text view that waits on
    /// app-wide updates drops keystrokes on the Mac.
    @State private var text = ""
    @State private var confirmDiscard = false
    @FocusState private var focused: Bool

    private var hasText: Bool { !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    var body: some View {
        NavigationStack {
            TextEditor(text: $text)
                .focused($focused)
                .accessibilityLabel(tr("native.capture.notePlaceholder"))
                .accessibilityIdentifier("composer.text")
                .scrollContentBackground(.hidden)
                #if os(macOS)
                // The Mac's text view ignores content margins, so the editor itself is inset to meet the placeholder.
                .padding(.horizontal, 20)
                .padding(.top, 20)
                .padding(.bottom, 12)
                #else
                .contentMargins(.horizontal, 20, for: .scrollContent)
                .contentMargins(.vertical, 12, for: .scrollContent)
                #endif
                .overlay(alignment: .topLeading) {
                    if text.isEmpty {
                        Text(tr("native.capture.notePlaceholder"))
                            .foregroundStyle(.tertiary)
                            .padding(.horizontal, 25)
                            .padding(.top, 20)
                            .allowsHitTesting(false)
                    }
                }
                .navigationTitle(tr("native.capture.newNote"))
                #if os(iOS)
                .navigationBarTitleDisplayMode(.inline)
                #endif
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button(tr("common.cancel")) {
                            if hasText { confirmDiscard = true } else { discard() }
                        }
                        // A save under way would still land after a discard.
                        .disabled(capture.isSavingText)
                        .confirmationDialog(tr("native.capture.discardNoteTitle"), isPresented: $confirmDiscard) {
                            Button(tr("native.capture.discard"), role: .destructive) { discard() }
                            Button(tr("native.card.edit.keepEditing"), role: .cancel) {}
                        } message: {
                            Text(tr("native.capture.discardNoteMessage"))
                        }
                    }
                    ToolbarItem(placement: .confirmationAction) {
                        Button { save() } label: {
                            Text(capture.isSavingText ? tr("common.saving") : tr("common.save")).foregroundStyle(.white)
                        }
                            .buttonStyle(.glassProminent)
                            .disabled(capture.isSavingText || !hasText)
                            .keyboardShortcut(.return, modifiers: .command)
                            .accessibilityHint(tr("native.capture.saveNoteHint"))
                            .accessibilityIdentifier("composer.save")
                    }
                }
        }
        .frame(minWidth: 420, minHeight: 320)
        // A note is never lost to a swipe: Cancel asks first.
        .interactiveDismissDisabled(hasText || capture.isSavingText)
        // A failed save shows here, over the note, which stays open.
        .captureAlert()
        .onAppear {
            text = router.composerText
            focused = true
        }
    }

    private func discard() {
        router.composerText = ""
        dismiss()
    }

    private func save() {
        // Return doesn't go through the button, so it checks what disables it.
        guard !capture.isSavingText, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        Task {
            if await capture.saveText(text) != nil {
                text = ""
                router.composerText = ""
                router.tab = .home
                dismiss()
            }
        }
    }
}

struct InlineComposerTile: View {
    let width: Double
    @Environment(CaptureModel.self) private var capture
    @State private var text = ""
    @FocusState private var focused: Bool

    var body: some View {
        VStack(alignment: .trailing, spacing: 8) {
            TextField(tr("native.capture.notePlaceholder"), text: $text, axis: .vertical)
                .lineLimit(2...8)
                .textFieldStyle(.plain)
                .focused($focused)
                .onSubmit { if !text.contains("\n") { save() } }
            if focused || !text.isEmpty {
                Button(capture.isSavingText ? tr("common.saving") : tr("common.save"), action: save)
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
        // Return doesn't go through the button, so it checks what disables it.
        guard !capture.isSavingText, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        Task {
            if await capture.saveText(text) != nil {
                text = ""
                focused = false
            }
        }
    }
}
