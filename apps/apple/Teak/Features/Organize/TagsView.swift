import Observation
import SwiftUI
import TeakCore
import TeakSync

/// Every tag with its card count, and the rename, merge and delete jobs
/// that change it on every card.
@MainActor @Observable
final class TagsModel {
    private(set) var summary: TagSummary?
    private(set) var isLoaded = false
    private(set) var operation: TagOperation?
    /// A finished change the summary hasn't counted yet.
    private var finished: (operation: TagOperation, summaryAt: Double?)?
    var notice: String?
    var error: String?

    @ObservationIgnored private let backend: TeakBackend
    @ObservationIgnored private var task: Task<Void, Never>?
    @ObservationIgnored private var operationTask: Task<Void, Never>?

    init(backend: TeakBackend) {
        self.backend = backend
    }

    func start() {
        guard task == nil else { return }
        task = Task {
            let _: ConvexVoid? = try? await backend.mutation(ConvexFunctions.requestTagSummary)
            while !Task.isCancelled {
                do {
                    for try await value in backend.subscribe(ConvexFunctions.listTagSummary) {
                        summary = value
                        isLoaded = true
                    }
                } catch {
                    try? await Task.sleep(for: .seconds(5))
                }
            }
        }
    }

    func stop() {
        task?.cancel()
        task = nil
    }

    var items: [TagSummary.Item] {
        let items = summary?.items ?? []
        guard let finished, finished.summaryAt == summary?.computedAt else { return items }
        return TagOperations.applying(finished.operation.kind, from: finished.operation.from, to: finished.operation.to, to: items)
    }

    func start(_ kind: TagOperations.Kind, from: String, to: String? = nil) async {
        if let to, let invalid = TagOperations.invalidName(to) { return error = invalid }
        error = nil
        notice = nil
        var args: ConvexArgs = ["kind": .string(kind.rawValue), "from": .string(from)]
        if let to { args["to"] = .string(to.trimmingCharacters(in: .whitespacesAndNewlines)) }
        do {
            let started = try await backend.mutation(ConvexFunctions.startTagOperation, args)
            follow(started)
        } catch {
            self.error = (error as? TeakError)?.message ?? "Couldn't start the tag change"
        }
    }

    /// Watches the job until it finishes, then says what changed.
    private func follow(_ started: TagOperation) {
        operation = started
        operationTask?.cancel()
        operationTask = Task {
            do {
                for try await value in backend.subscribe(ConvexFunctions.getTagOperation, ["operationId": .string(started.id)]) {
                    guard let value else { continue }
                    operation = value
                    if value.isRunning { continue }
                    if value.isFailed {
                        error = TagOperations.failed(value.kind, changed: Int(value.changed), total: Int(value.total))
                            + " Try again to change the rest."
                    } else {
                        notice = TagOperations.completed(value.kind, from: value.from, to: value.to)
                            + ". " + TagOperations.changed(Int(value.changed)) + "."
                        finished = (value, summary?.computedAt)
                    }
                    operation = nil
                    return
                }
            } catch {
                operation = nil
            }
        }
    }
}

struct TagsView: View {
    let model: TagsModel
    var openTag: (String) -> Void
    @State private var query = ""
    @State private var renaming: TagSummary.Item?
    @State private var merging: TagSummary.Item?
    @State private var deleting: TagSummary.Item?
    @State private var newName = ""

    var body: some View {
        List {
            if let operation = model.operation {
                Section {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(TagOperations.running(operation.kind, from: operation.from, to: operation.to))
                            .font(.subheadline.weight(.medium))
                        ProgressView(value: operation.total > 0 ? min(operation.processed / operation.total, 1) : 0)
                        Text(TagOperations.progress(changed: Int(operation.changed), total: Int(operation.total)))
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                    .accessibilityElement(children: .combine)
                }
            }
            if let notice = model.notice {
                Label(notice, systemImage: "checkmark.circle").foregroundStyle(.green)
            }
            if let error = model.error {
                Label(error, systemImage: "exclamationmark.circle").foregroundStyle(.red)
            }
            ForEach(visible) { item in
                Button { openTag(item.name) } label: {
                    HStack {
                        Label(item.name, systemImage: HiddenTags.isHidden(item.name) ? "eye.slash" : "number")
                        Spacer()
                        Text(Int(item.count), format: .number).foregroundStyle(.secondary).monospacedDigit()
                    }
                }
                .accessibilityLabel("\(item.name), \(BulkCardAction.cards(Int(item.count)))")
                .contextMenu { menu(item) }
                .swipeActions {
                    Button("Delete…", systemImage: "trash", role: .destructive) { deleting = item }
                    Button("Rename…", systemImage: "pencil") { rename(item) }
                }
                .disabled(model.operation != nil)
            }
        }
        .tint(.primary)
        .overlay {
            if !model.isLoaded {
                ProgressView().accessibilityLabel("Loading tags")
            } else if model.items.isEmpty {
                ContentUnavailableView("No Tags Yet", systemImage: "number",
                                       description: Text("Tags you add to cards, and the ones Teak suggests, show up here."))
            } else if visible.isEmpty {
                ContentUnavailableView.search(text: query)
            }
        }
        .searchable(text: $query, prompt: "Find a tag")
        .navigationTitle("Tags")
        .task { model.start() }
        .alert("Rename Tag", isPresented: Binding(presenting: $renaming), presenting: renaming) { item in
            TextField("New name", text: $newName)
            Button("Cancel", role: .cancel) {}
            Button("Rename") { Task { await model.start(.rename, from: item.name, to: newName) } }
        } message: { item in
            Text("Renames \u{201C}\(item.name)\u{201D} on \(scope(item)).")
        }
        .confirmationDialog("Delete \u{201C}\(deleting?.name ?? "")\u{201D}?", isPresented: Binding(presenting: $deleting),
                            titleVisibility: .visible, presenting: deleting) { item in
            Button("Delete Tag", role: .destructive) { Task { await model.start(.delete, from: item.name) } }
        } message: { item in
            Text("Removes \u{201C}\(item.name)\u{201D} from \(scope(item)). The cards are kept. This can't be undone.")
        }
        .sheet(item: $merging) { item in
            MergeTagView(source: item, tags: model.items) { target in
                Task { await model.start(.merge, from: item.name, to: target) }
            }
        }
    }

    private var visible: [TagSummary.Item] {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? model.items : model.items.filter { $0.name.localizedCaseInsensitiveContains(trimmed) }
    }

    private func scope(_ item: TagSummary.Item) -> String {
        "\(BulkCardAction.cards(Int(item.count))), plus any in Archive or Trash"
    }

    private func rename(_ item: TagSummary.Item) {
        newName = item.name
        renaming = item
    }

    @ViewBuilder private func menu(_ item: TagSummary.Item) -> some View {
        Button("Rename…", systemImage: "pencil") { rename(item) }
        Button("Merge Into…", systemImage: "arrow.triangle.merge") { merging = item }
        Button("Delete…", systemImage: "trash", role: .destructive) { deleting = item }
    }
}

private struct MergeTagView: View {
    let source: TagSummary.Item
    let tags: [TagSummary.Item]
    let merge: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""

    var body: some View {
        NavigationStack {
            List {
                Text("Cards tagged \u{201C}\(source.name)\u{201D} get the tag you pick instead. A card with both keeps one.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                ForEach(targets.prefix(200)) { tag in
                    Button {
                        merge(tag.name)
                        dismiss()
                    } label: {
                        HStack {
                            Text(tag.name)
                            Spacer()
                            Text(Int(tag.count), format: .number).foregroundStyle(.secondary)
                        }
                    }
                }
                if targets.isEmpty {
                    Text(query.isEmpty ? "No other tags yet." : "No tag by that name.").foregroundStyle(.secondary)
                }
            }
            .tint(.primary)
            .searchable(text: $query, prompt: "Find a tag")
            .navigationTitle("Merge \u{201C}\(source.name)\u{201D} Into…")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
        }
        .frame(minWidth: 360, minHeight: 420)
    }

    private var targets: [TagSummary.Item] {
        let others = tags.filter { $0.name.lowercased() != source.name.lowercased() }
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? others : others.filter { $0.name.localizedCaseInsensitiveContains(trimmed) }
    }
}
