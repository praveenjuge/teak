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
    /// Changes on `reset()`, so a change started by the last account can't land after it.
    @ObservationIgnored private var epoch = 0

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

    /// Signing out drops the last account's tags and any change still running; the next `start()` loads again.
    func reset() {
        epoch += 1
        stop()
        operationTask?.cancel()
        operationTask = nil
        summary = nil
        isLoaded = false
        operation = nil
        finished = nil
        notice = nil
        error = nil
    }

    var items: [TagSummary.Item] {
        let items = summary?.items ?? []
        guard let finished, finished.summaryAt == summary?.computedAt else { return items }
        return TagOperations.applying(finished.operation.kind, from: finished.operation.from, to: finished.operation.to, to: items)
    }

    func start(_ kind: TagOperations.Kind, from: String, to: String? = nil) async {
        if let to, let invalid = TagChangeText.invalidName(to) { return error = invalid }
        error = nil
        notice = nil
        var args: ConvexArgs = ["kind": .string(kind.rawValue), "from": .string(from)]
        if let to { args["to"] = .string(to.trimmingCharacters(in: .whitespacesAndNewlines)) }
        let startedIn = epoch
        do {
            let started = try await backend.mutation(ConvexFunctions.startTagOperation, args)
            guard startedIn == epoch else { return }
            follow(started)
        } catch {
            guard startedIn == epoch else { return }
            self.error = (error as? TeakError)?.message ?? tr("native.tags.startFailed")
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
                        error = TagChangeText.failed(value.kind, changed: Int(value.changed), total: Int(value.total))
                            + "\n" + tr("native.tags.tryRest")
                    } else {
                        notice = TagChangeText.completed(value.kind, from: value.from, to: value.to)
                            + "\n" + tr("native.tags.changed", count: Int(value.changed))
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

/// What a tag change says while it runs, once it's done and when it fails.
enum TagChangeText {
    private static func number(_ value: Int) -> String { value.formatted(.number.locale(AppLanguage.locale)) }

    static func invalidName(_ name: String) -> String? {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return tr("errors.tags.EMPTY_NAME") }
        guard trimmed.utf16.count > TagOperations.maxNameLength else { return nil }
        return tr("errors.tags.NAME_TOO_LONG", number(TagOperations.maxNameLength))
    }

    static func running(_ kind: TagOperations.Kind, from: String, to: String?) -> String {
        switch kind {
        case .rename: tr("native.tags.renaming", from, to ?? "")
        case .merge: tr("native.tags.merging", from, to ?? "")
        case .delete: tr("native.tags.deleting", from)
        }
    }

    static func progress(changed: Int, total: Int) -> String {
        let total = max(total, 0)
        return tr("native.tags.progress", count: total, number(min(changed, total)))
    }

    static func completed(_ kind: TagOperations.Kind, from: String, to: String?) -> String {
        switch kind {
        case .rename: tr("native.tags.renamed", from, to ?? "")
        case .merge: tr("native.tags.merged", from, to ?? "")
        case .delete: tr("native.tags.deleted", from)
        }
    }

    static func failed(_ kind: TagOperations.Kind, changed: Int, total: Int) -> String {
        let total = max(total, 0)
        let changed = number(min(changed, total))
        return switch kind {
        case .rename: tr("native.tags.renameFailed", count: total, changed)
        case .merge: tr("native.tags.mergeFailed", count: total, changed)
        case .delete: tr("native.tags.deleteFailed", count: total, changed)
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
                        Text(TagChangeText.running(operation.kind, from: operation.from, to: operation.to))
                            .font(.subheadline.weight(.medium))
                        ProgressView(value: operation.total > 0 ? min(operation.processed / operation.total, 1) : 0)
                        Text(TagChangeText.progress(changed: Int(operation.changed), total: Int(operation.total)))
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
                        Text(Int(item.count), format: .number.locale(AppLanguage.locale))
                            .foregroundStyle(.secondary).monospacedDigit()
                    }
                }
                .accessibilityLabel(tr("native.tags.rowLabel", count: Int(item.count), item.name))
                .contextMenu { menu(item) }
                .swipeActions {
                    Button(tr("native.tags.deleteMenu"), systemImage: "trash", role: .destructive) { deleting = item }
                    Button(tr("native.folders.renameMenu"), systemImage: "pencil") { rename(item) }
                }
                .disabled(model.operation != nil)
            }
        }
        .tint(.primary)
        .overlay {
            if !model.isLoaded {
                ProgressView().accessibilityLabel(tr("native.tags.loading"))
            } else if model.items.isEmpty {
                ContentUnavailableView(tr("native.tags.emptyTitle"), systemImage: "number",
                                       description: Text(tr("native.tags.emptyMessage")))
            } else if visible.isEmpty {
                ContentUnavailableView.search(text: query)
            }
        }
        .searchable(text: $query, prompt: tr("native.tags.find"))
        .navigationTitle(tr("native.tags.title"))
        .task { model.start() }
        .alert(tr("native.tags.renameTitle"), isPresented: Binding(presenting: $renaming), presenting: renaming) { item in
            TextField(tr("native.tags.newName"), text: $newName)
            Button(tr("common.cancel"), role: .cancel) {}
            Button(tr("common.rename")) { Task { await model.start(.rename, from: item.name, to: newName) } }
        } message: { item in
            Text(tr("native.tags.renameMessage", count: Int(item.count), item.name))
        }
        .confirmationDialog(tr("native.tags.deleteTitle", deleting?.name ?? ""), isPresented: Binding(presenting: $deleting),
                            titleVisibility: .visible, presenting: deleting) { item in
            Button(tr("native.tags.deleteTag"), role: .destructive) { Task { await model.start(.delete, from: item.name) } }
        } message: { item in
            Text(tr("native.tags.deleteMessage", count: Int(item.count), item.name))
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

    private func rename(_ item: TagSummary.Item) {
        newName = item.name
        renaming = item
    }

    @ViewBuilder private func menu(_ item: TagSummary.Item) -> some View {
        Button(tr("native.folders.renameMenu"), systemImage: "pencil") { rename(item) }
        Button(tr("native.tags.mergeMenu"), systemImage: "arrow.triangle.merge") { merging = item }
        Button(tr("native.tags.deleteMenu"), systemImage: "trash", role: .destructive) { deleting = item }
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
                Text(tr("native.tags.mergeMessage", source.name))
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
                            Text(Int(tag.count), format: .number.locale(AppLanguage.locale)).foregroundStyle(.secondary)
                        }
                    }
                }
                if targets.isEmpty {
                    Text(query.isEmpty ? tr("native.tags.noOthers") : tr("native.tags.noneByName")).foregroundStyle(.secondary)
                }
            }
            .tint(.primary)
            .searchable(text: $query, prompt: tr("native.tags.find"))
            .navigationTitle(tr("native.tags.mergeTitle", source.name))
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button(tr("common.cancel")) { dismiss() } } }
        }
        .frame(minWidth: 360, minHeight: 420)
    }

    private var targets: [TagSummary.Item] {
        let others = tags.filter { $0.name.lowercased() != source.name.lowercased() }
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? others : others.filter { $0.name.localizedCaseInsensitiveContains(trimmed) }
    }
}
