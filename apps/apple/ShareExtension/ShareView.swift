import Foundation
import Observation
import SwiftUI
import TeakCore

@MainActor @Observable
final class ShareModel {
    enum Phase: Equatable {
        case saving
        case done(ShareImportResult)
        case empty
    }

    private(set) var phase: Phase = .saving
    private(set) var isSavingDetails = false
    var detailsError: String?
    private let providers: [NSItemProvider]
    private var convex: ConvexHTTP?

    init(providers: [NSItemProvider]) {
        self.providers = providers
    }

    /// The one card just saved, which can take tags and a note.
    var savedCardId: String? {
        guard case let .done(result) = phase, result.isComplete, result.createdCardIds.count == 1 else { return nil }
        return result.createdCardIds.first
    }

    /// Saves the tags and note typed after saving. Empty fields change nothing.
    func saveDetails(tags: String, note: String) async -> Bool {
        guard let id = savedCardId, let convex else { return true }
        let tagList = CardEdit.adding(tags, to: [])
        let note = note.trimmingCharacters(in: .whitespacesAndNewlines)
        if tagList.contains(where: { $0.utf16.count > TagOperations.maxNameLength }) {
            detailsError = tr("errors.tags.NAME_TOO_LONG", TagOperations.maxNameLength.formatted(.number.locale(AppLanguage.locale)))
            return false
        }
        isSavingDetails = true
        defer { isSavingDetails = false }
        do {
            if !tagList.isEmpty {
                let _: ConvexVoid = try await convex.mutation(ConvexFunctions.updateCardField, CardFieldChange.tags(tagList).args(cardId: id))
            }
            if !note.isEmpty {
                let _: ConvexVoid = try await convex.mutation(ConvexFunctions.updateCardField, CardFieldChange.notes(note).args(cardId: id))
            }
            detailsError = nil
            return true
        } catch {
            detailsError = tagList.isEmpty ? tr("native.share.noteFailed") : tr("native.share.tagsFailed")
            return false
        }
    }

    func run() async {
        let items = await ItemProviders.load(providers, limit: TeakLimits.maxFilesPerUpload)
        guard !items.isEmpty else { return phase = .empty }
        let session = TeakServices.session()
        let user = try? await session.restore()
        let convex = TeakServices.http(session: session)
        self.convex = convex
        let pipeline = UploadPipeline(convex: convex)
        let importer = ShareImporter(
            createText: { text in try await convex.mutation(ConvexFunctions.createCard, LinkDetection.resolve(text).createArgs) },
            upload: { item in try await pipeline.upload(item) })
        phase = .done(await importer.importItems(items, isAuthenticated: user != nil))
    }
}

struct ShareView: View {
    let model: ShareModel
    let close: () -> Void
    let openApp: () -> Void
    @State private var tags = ""
    @State private var note = ""
    @State private var isEditing = false
    @FocusState private var focus: Field?

    enum Field { case tags, note }

    var body: some View {
        VStack(spacing: 18) {
            content
        }
        .padding(24)
        .frame(minWidth: 320, minHeight: 260)
        .fontDesign(.rounded)
        .task {
            await model.run()
            if case let .done(result) = model.phase, result.isComplete {
                // A quick save still closes by itself; typing keeps it open.
                try? await Task.sleep(for: .seconds(model.savedCardId == nil ? 1.2 : 3))
                if !isEditing { close() }
            }
        }
        .onChange(of: focus) { _, field in if field != nil { isEditing = true } }
        .sensoryFeedback(trigger: model.phase) { _, phase in
            guard case let .done(result) = phase else { return nil }
            return result.isComplete ? .success : .error
        }
    }

    @ViewBuilder private var content: some View {
        switch model.phase {
        case .saving:
            ProgressView().controlSize(.large)
            Text(tr("native.share.saving")).foregroundStyle(.secondary)
        case .empty:
            ContentUnavailableView(tr("native.share.nothingToSave"), systemImage: "tray",
                                   description: Text(tr("native.share.nothingToSaveMessage")))
            Button(tr("common.close"), action: close).buttonStyle(.glass)
        case let .done(result):
            if result.needsSignIn {
                ContentUnavailableView(tr("native.share.signInRequired"), systemImage: "person.crop.circle.badge.exclamationmark",
                                       description: Text(tr("native.share.signInMessage")))
                HStack {
                    Button(tr("common.close"), action: close).buttonStyle(.glass)
                    Button(tr("native.share.openTeak"), action: openApp).buttonStyle(.glassProminent)
                }
            } else if result.isComplete {
                ContentUnavailableView(tr("native.capture.saved"), systemImage: "checkmark.circle.fill",
                                       description: Text(Self.savedSummary(result)))
                    .symbolEffect(.bounce, value: result.successfulItems)
                if model.savedCardId != nil { details }
            } else {
                ContentUnavailableView(result.isPartial ? Self.partialSummary(result) : tr("native.capture.couldntSave"),
                                       systemImage: result.isPartial ? "exclamationmark.circle" : "xmark.circle",
                                       description: Text(Self.failureMessage(result)))
                Button(tr("common.close"), action: close).buttonStyle(.glass)
            }
        }
    }

    static func savedSummary(_ result: ShareImportResult) -> String {
        result.successfulItems == 1
            ? tr("native.capture.savedToTeak")
            : tr("native.capture.savedItems", count: result.successfulItems)
    }

    static func partialSummary(_ result: ShareImportResult) -> String {
        let locale = AppLanguage.locale
        return tr("native.capture.savedSome", result.successfulItems.formatted(.number.locale(locale)),
                  result.totalItems.formatted(.number.locale(locale)))
    }

    /// Why the first item wasn't saved. Too many items is Teak's own text; other reasons carry the error's.
    static func failureMessage(_ result: ShareImportResult) -> String {
        guard let failure = result.failures.first else { return tr("native.errors.offline") }
        if failure.reason == .tooManyItems {
            return tr("native.share.tooManyItems", TeakLimits.maxFilesPerUpload.formatted(.number.locale(AppLanguage.locale)))
        }
        return failure.message
    }

    private var details: some View {
        VStack(spacing: 10) {
            TextField(tr("native.actions.addTags"), text: $tags)
                .focused($focus, equals: .tags)
                .textFieldStyle(.roundedBorder)
                .accessibilityLabel(tr("native.tags.title"))
                .accessibilityIdentifier("share.tags")
                #if os(iOS)
                .textInputAutocapitalization(.never)
                #endif
            TextField(tr("native.share.addNote"), text: $note, axis: .vertical)
                .focused($focus, equals: .note)
                .lineLimit(2...4)
                .textFieldStyle(.roundedBorder)
                .accessibilityLabel(tr("native.share.note"))
                .accessibilityIdentifier("share.note")
            if let error = model.detailsError {
                Text(error).font(.footnote).foregroundStyle(.red)
            }
            Button(isEditing ? tr("common.save") : tr("common.done")) {
                Task { if await model.saveDetails(tags: tags, note: note) { close() } }
            }
            .buttonStyle(.glassProminent)
            .disabled(model.isSavingDetails)
            .accessibilityIdentifier("share.done")
        }
        .frame(maxWidth: 360)
    }
}
