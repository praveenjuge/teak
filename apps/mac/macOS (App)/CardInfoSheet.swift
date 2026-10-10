import AppKit
import SwiftUI

struct CardInfoSheet: View {
    let card: LibraryCard
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack {
            Text("More Information").font(.headline)
            Form {
                info("Created At", Date(timeIntervalSince1970: card.createdAt / 1000).formatted())
                info("Updated At", Date(timeIntervalSince1970: card.updatedAt / 1000).formatted())
                if let name = card.fileName { info("File Name", name) }
                if let size = card.fileSize {
                    info("File Size", ByteCountFormatter.string(fromByteCount: Int64(size), countStyle: .file))
                }
                if let type = card.mimeType ?? card.fileKind { info("File Type", type) }
                if let url = card.url { copyable("URL", url) }
                if let content = card.content, !content.isEmpty { copyable("Original Content", content) }
            }
            .formStyle(.grouped)
            Button("Close") { dismiss() }.keyboardShortcut(.cancelAction)
        }
        .frame(minWidth: 440, minHeight: 360)
    }

    private func info(_ title: String, _ value: String) -> some View {
        LabeledContent(title) { Text(value).textSelection(.enabled) }
    }

    private func copyable(_ title: String, _ value: String) -> some View {
        LabeledContent(title) {
            HStack {
                Text(value).textSelection(.enabled)
                Button("Copy", systemImage: "doc.on.doc") {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(value, forType: .string)
                }
            }
        }
    }
}

struct CardNotesSheet: View {
    let card: LibraryCard
    @ObservedObject var store: LibraryStore
    let onSaved: (LibraryCard) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var notes: String
    @State private var error: String?

    init(card: LibraryCard, store: LibraryStore, onSaved: @escaping (LibraryCard) -> Void) {
        self.card = card
        self.store = store
        self.onSaved = onSaved
        _notes = State(initialValue: card.notes ?? "")
    }

    var body: some View {
        VStack {
            Text("Notes").font(.headline)
            TextEditor(text: $notes)
                .overlay(alignment: .topLeading) {
                    if notes.isEmpty {
                        Text("Add your notes here...").foregroundStyle(.secondary).allowsHitTesting(false)
                    }
                }
            if let error { Text(error).foregroundStyle(.red) }
            HStack {
                Button("Cancel") { dismiss() }.keyboardShortcut(.cancelAction)
                Spacer()
                Button(card.notes?.isEmpty == false ? "Update" : "Add") { save() }
                    .keyboardShortcut(.defaultAction)
                    .disabled(store.mutatingIDs.contains(card.id))
            }
        }
        .scenePadding()
        .frame(minWidth: 440, minHeight: 300)
    }

    private func save() {
        Task {
            do {
                onSaved(try await store.update(card, title: card.metadataTitle ?? "", content: nil,
                                               notes: notes, tags: card.tags))
                dismiss()
            } catch { self.error = error.localizedDescription }
        }
    }
}

struct CardTagsSheet: View {
    let card: LibraryCard
    @ObservedObject var store: LibraryStore
    let onSaved: (LibraryCard) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var current: LibraryCard
    @State private var newTag = ""
    @State private var error: String?

    init(card: LibraryCard, store: LibraryStore, onSaved: @escaping (LibraryCard) -> Void) {
        self.card = card
        self.store = store
        self.onSaved = onSaved
        _current = State(initialValue: card)
    }

    var body: some View {
        VStack {
            Text("Manage Tags").font(.headline)
            Form {
                Section("Add New Tag") {
                    HStack {
                        TextField("Enter tag name", text: $newTag).onSubmit(addTag)
                        Button("Add", action: addTag).disabled(newTag.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }
                }
                Section("Your Tags") {
                    if current.tags.isEmpty { Text("No tags yet. Add your first tag above!").foregroundStyle(.secondary) }
                    ForEach(current.tags, id: \.self) { tag in
                        HStack {
                            Text(tag)
                            Spacer()
                            Button("Remove", systemImage: "minus.circle") { save(current.tags.filter { $0 != tag }) }
                        }
                    }
                }
                Section("Tags by Teak") {
                    if current.aiTags.isEmpty { Text("Teak hasn't added any tags.").foregroundStyle(.secondary) }
                    ForEach(current.aiTags, id: \.self) { tag in
                        HStack {
                            Label(tag, systemImage: "sparkles")
                            Spacer()
                            Button("Remove", systemImage: "minus.circle") { removeAiTag(tag) }
                                .help("Remove this tag Teak added")
                        }
                    }
                }
            }
            .formStyle(.grouped)
            .disabled(store.mutatingIDs.contains(card.id))
            if let error { Text(error).foregroundStyle(.red) }
            Button("Close") { dismiss() }.keyboardShortcut(.cancelAction)
        }
        .frame(minWidth: 440, minHeight: 360)
    }

    private func addTag() {
        let tag = newTag.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !tag.isEmpty, !current.tags.contains(tag) else { return }
        save(current.tags + [tag])
    }

    private func removeAiTag(_ tag: String) {
        Task {
            do {
                current = try await store.removeAiTag(tag, from: current)
                onSaved(current)
            } catch { self.error = error.localizedDescription }
        }
    }

    private func save(_ tags: [String]) {
        Task {
            do {
                current = try await store.update(current, title: current.metadataTitle ?? "", content: nil,
                                                  notes: current.notes ?? "", tags: tags)
                newTag = ""
                onSaved(current)
            } catch { self.error = error.localizedDescription }
        }
    }
}

/// Wraps native controls without choosing custom chip styling or spacing.
struct CardChipFlow: Layout {
    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        arrange(subviews, width: proposal.width ?? .infinity).size
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let positions = arrange(subviews, width: bounds.width).positions
        for (index, view) in subviews.enumerated() {
            view.place(at: CGPoint(x: bounds.minX + positions[index].x, y: bounds.minY + positions[index].y), proposal: .unspecified)
        }
    }

    private func arrange(_ subviews: Subviews, width: CGFloat) -> (size: CGSize, positions: [CGPoint]) {
        var positions: [CGPoint] = []
        var x: CGFloat = 0
        var y: CGFloat = 0
        var rowHeight: CGFloat = 0
        var usedWidth: CGFloat = 0
        for (index, view) in subviews.enumerated() {
            let size = view.sizeThatFits(.unspecified)
            let gap = index == 0 ? 0 : subviews[index - 1].spacing.distance(to: view.spacing, along: .horizontal)
            if x > 0, x + gap + size.width > width {
                y += rowHeight + subviews[index - 1].spacing.distance(to: view.spacing, along: .vertical)
                x = 0
                rowHeight = 0
            } else if x > 0 { x += gap }
            positions.append(CGPoint(x: x, y: y))
            x += size.width
            usedWidth = max(usedWidth, x)
            rowHeight = max(rowHeight, size.height)
        }
        return (CGSize(width: usedWidth, height: y + rowHeight), positions)
    }
}
