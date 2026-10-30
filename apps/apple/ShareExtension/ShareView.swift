import Foundation
import Observation
import SwiftUI
import TeakCore
import TeakUI

@MainActor @Observable
final class ShareModel {
    enum Phase: Equatable {
        case saving
        case done(ShareImportResult)
        case empty
    }

    private(set) var phase: Phase = .saving
    /// What's being saved, shown while it uploads; nil until the items load.
    private(set) var preview: SharePreview?
    /// Thumbnails of the preview's files, added as each is drawn.
    private(set) var thumbnails: [URL: CGImage] = [:]
    private(set) var isSavingDetails = false
    var detailsError: String?
    /// The user's folders, loaded once the folder checklist opens; nil until then.
    private(set) var folders: [Folder]?
    private(set) var foldersError: String?
    /// The folders picked for the saved cards, and the ones already saved on them.
    var folderIds: [String] = []
    private var savedFolderIds: [String] = []
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

    /// Every card just saved, which can go into folders together.
    var savedCardIds: [String] {
        guard case let .done(result) = phase, result.isComplete else { return [] }
        return result.createdCardIds
    }

    /// The picked folders' names, in the order picked.
    var folderNames: [String] {
        folderIds.compactMap { id in folders?.first { $0.id == id }?.name }
    }

    func loadFolders() async {
        guard folders == nil, let convex else { return }
        foldersError = nil
        do {
            folders = try await convex.query(ConvexFunctions.listFolders)
        } catch {
            foldersError = tr("native.folders.loadFailed")
        }
    }

    /// Puts the saved cards in the picked folders, and takes them out of ones unpicked since.
    /// The cards are added to, or removed from, each folder the choice changed; other folders stay.
    func saveFolders() async -> Bool {
        let cardIds = savedCardIds
        guard let convex else { return true }
        let change = FolderChoice.change(selected: folderIds, saved: savedFolderIds, cardCount: cardIds.count)
        guard change != .none else { return true }
        isSavingDetails = true
        defer { isSavingDetails = false }
        var saved = true
        do {
            switch change {
            case .none:
                break
            case let .update(add, remove):
                let cards = ConvexValue.array(cardIds.map(ConvexValue.string))
                for folderId in add {
                    let result = try await convex.mutation(ConvexFunctions.addCardsToFolder,
                                                           ["folderId": .string(folderId), "cardIds": cards])
                    if result.failedIds.isEmpty { savedFolderIds.append(folderId) } else { saved = false }
                }
                for folderId in remove {
                    let result = try await convex.mutation(ConvexFunctions.removeCardsFromFolder,
                                                           ["folderId": .string(folderId), "cardIds": cards])
                    if result.failedIds.isEmpty { savedFolderIds.removeAll { $0 == folderId } } else { saved = false }
                }
            }
        } catch {
            saved = false
        }
        detailsError = saved ? nil : tr("native.share.foldersFailed")
        return saved
    }

    /// Saves the folders picked and the tags and note typed after saving. Empty fields change nothing.
    func saveDetails(tags: String, note: String) async -> Bool {
        guard await saveFolders() else { return false }
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

    /// Saves what was shared, drawing the preview's thumbnails at `thumbnailSize` points alongside.
    func run(thumbnailSize: CGFloat, scale: CGFloat) async {
        let loaded = await ItemProviders.load(providers, limit: TeakLimits.maxFilesPerUpload)
        // Blank text saves nothing, so it says so rather than failing as if offline.
        let items = ShareImporter.removingEmptyAndDuplicates(loaded)
        guard !items.isEmpty else { return phase = .empty }
        let preview = SharePreview(items: items)
        self.preview = preview
        // An upload deletes its file once saved, so each one waits for its own thumbnail first.
        let drawing = Dictionary(preview.files.map { file in
            (file, Task { await SharePreview.thumbnail(of: file, size: thumbnailSize, scale: scale) })
        }, uniquingKeysWith: { first, _ in first })
        for (file, task) in drawing {
            Task {
                guard let image = await task.value else { return }
                withAnimation(.easeOut(duration: 0.35)) { thumbnails[file] = image }
            }
        }
        let session = TeakServices.session()
        let user = try? await session.restore()
        let convex = TeakServices.http(session: session)
        self.convex = convex
        let pipeline = UploadPipeline(convex: convex)
        let importer = ShareImporter(
            createText: { text in try await convex.mutation(ConvexFunctions.createCard, LinkDetection.resolve(text).createArgs) },
            upload: { item in
                _ = await drawing[item.fileURL]?.value
                return try await pipeline.upload(item)
            })
        phase = .done(await importer.importItems(items, isAuthenticated: user != nil))
    }
}

/// What you shared and how saving went, then tags, a note and folders for what was saved.
/// On iPhone and iPad the preview sits large in the sheet with the controls near your thumb;
/// on the Mac it's a compact row.
struct ShareView: View {
    let model: ShareModel
    let close: () -> Void
    let openApp: () -> Void
    @State private var tags = ""
    @State private var note = ""
    @State private var isEditing = false
    @State private var isPickingFolders = false
    @State private var hasAppeared = false
    /// How much of the auto-close wait is left, from 1 to 0, drawn inside the Done button.
    @State private var countdown: CGFloat = 1
    @State private var isCountingDown = false
    @State private var shakes = 0
    @FocusState private var focus: Field?
    @Environment(\.displayScale) private var displayScale
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    enum Field { case tags, note }

    /// A quick save closes by itself after this long; typing or choosing folders keeps it open.
    private static let autoClose: Double = 3

    #if os(iOS)
    private static let tileSize: CGFloat = 128
    private static let badgeSize: CGFloat = 36
    #else
    private static let tileSize: CGFloat = 56
    private static let badgeSize: CGFloat = 24
    #endif

    /// Teak red, the app's AccentColor; the extension has no asset catalog of its own.
    private static let teak = Color(red: 0.863, green: 0.149, blue: 0.149)

    var body: some View {
        layout
            .fontDesign(.rounded)
            .tint(Self.teak)
            .task {
                await model.run(thumbnailSize: Self.tileSize, scale: displayScale)
                guard case let .done(result) = model.phase, result.isComplete else { return }
                isCountingDown = true
                withAnimation(.linear(duration: Self.autoClose)) { countdown = 0 }
                try? await Task.sleep(for: .seconds(Self.autoClose))
                if !isEditing { close() }
            }
            .onAppear {
                withAnimation(.spring(duration: 0.6, bounce: 0.3)) { hasAppeared = true }
            }
            .onChange(of: focus) { _, field in if field != nil { startEditing() } }
            .onChange(of: isPickingFolders) { _, picking in if picking { startEditing() } }
            .onChange(of: model.phase) { _, phase in
                if case let .done(result) = phase, !result.isComplete, !result.needsSignIn { shake() }
            }
            .sheet(isPresented: $isPickingFolders, onDismiss: { Task { await model.saveFolders() } }) {
                @Bindable var model = model
                FolderChecklist(folders: model.folders, loadError: model.foldersError, selection: $model.folderIds) {
                    Task { await model.loadFolders() }
                }
                .task { await model.loadFolders() }
            }
            .sensoryFeedback(trigger: model.phase) { _, phase in
                guard case let .done(result) = phase else { return nil }
                return result.isComplete ? .success : .error
            }
    }

    // MARK: Layout

    #if os(iOS)
    /// Fills the sheet when there's room; scrolls in landscape or above the keyboard when there isn't.
    private var layout: some View {
        GeometryReader { proxy in
            ScrollView {
                VStack(spacing: 0) {
                    Spacer(minLength: 24)
                    hero
                    Spacer(minLength: 28)
                    controls
                }
                .padding(.horizontal, 24)
                .padding(.bottom, 16)
                .frame(maxWidth: 480)
                .frame(maxWidth: .infinity, minHeight: proxy.size.height)
            }
            .scrollBounceBehavior(.basedOnSize)
            .scrollDismissesKeyboard(.interactively)
        }
        .background(alignment: .top) { ambience }
        .animation(.spring(duration: 0.5, bounce: 0.2), value: model.phase)
    }

    /// A soft wash of the shared image's colors behind the top of the sheet.
    private var ambience: some View {
        GeometryReader { proxy in
            if let file = model.preview?.files.first, let image = model.thumbnails[file] {
                Image(decorative: image, scale: displayScale)
                    .resizable()
                    .scaledToFill()
                    .frame(width: proxy.size.width, height: proxy.size.height * 0.6)
                    .saturation(1.8)
                    .blur(radius: 60)
                    .opacity(0.55)
                    .mask(LinearGradient(colors: [.black, .black.opacity(0.4), .clear], startPoint: .top, endPoint: .bottom))
                    .clipped()
                    .transition(.opacity)
            }
        }
        .ignoresSafeArea()
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    private var hero: some View {
        VStack(spacing: 22) {
            previewWithBadge
                .scaleEffect(hasAppeared || reduceMotion ? 1 : 0.7)
                .opacity(hasAppeared ? 1 : 0)
            VStack(spacing: 6) {
                Text(title)
                    .font(.title2.weight(.semibold))
                    .contentTransition(.opacity)
                if let subtitle, !subtitle.isEmpty {
                    Text(subtitle)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                        .contentTransition(.opacity)
                }
            }
            .multilineTextAlignment(.center)
            .offset(y: hasAppeared || reduceMotion ? 0 : 10)
            .opacity(hasAppeared ? 1 : 0)
            .animation(.smooth(duration: 0.3), value: title)
        }
        .modifier(Shake(trigger: shakes))
        .accessibilityElement(children: .combine)
    }
    #else
    private var layout: some View {
        VStack(spacing: 18) {
            HStack(spacing: 16) {
                previewWithBadge
                VStack(alignment: .leading, spacing: 3) {
                    Text(title).font(.headline).contentTransition(.opacity)
                    if let subtitle, !subtitle.isEmpty {
                        Text(subtitle).font(.subheadline).foregroundStyle(.secondary).lineLimit(2)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .modifier(Shake(trigger: shakes))
            .accessibilityElement(children: .combine)
            controls
        }
        .padding(20)
        .frame(minWidth: 360, minHeight: 280, alignment: .top)
        .animation(.spring(duration: 0.5, bounce: 0.2), value: model.phase)
    }
    #endif

    private var previewWithBadge: some View {
        SharePreviewTile(preview: model.preview, thumbnails: model.thumbnails, size: Self.tileSize)
            .scaleEffect(model.phase == .saving && !reduceMotion ? 0.94 : 1)
            .overlay(alignment: .bottomTrailing) {
                ShareStatusBadge(status: status, size: Self.badgeSize)
                    .offset(x: Self.badgeSize * 0.3, y: Self.badgeSize * 0.3)
            }
            .animation(reduceMotion ? .easeInOut(duration: 0.2) : .spring(duration: 0.55, bounce: 0.5), value: model.phase)
    }

    /// The fields and Done after a save, or the way out after anything else.
    @ViewBuilder private var controls: some View {
        if isSaved {
            details
        } else if model.phase != .saving {
            actions.transition(.opacity.combined(with: .offset(y: 12)))
        }
    }

    // MARK: Status text

    private var isSaved: Bool {
        if case let .done(result) = model.phase { return result.isComplete }
        return false
    }

    private var status: ShareStatusBadge.Status {
        switch model.phase {
        case .saving: .saving
        case .empty: .attention
        case let .done(result):
            if result.needsSignIn { .attention } else if result.isComplete { .saved } else if result.isPartial { .partial } else { .failed }
        }
    }

    private var title: String {
        switch model.phase {
        case .saving: tr("native.share.saving")
        case .empty: tr("native.share.nothingToSave")
        case let .done(result):
            if result.needsSignIn {
                tr("native.share.signInRequired")
            } else if result.isComplete {
                Self.savedSummary(result)
            } else {
                result.isPartial ? Self.partialSummary(result) : tr("native.capture.couldntSave")
            }
        }
    }

    private var subtitle: String? {
        switch model.phase {
        case .saving: model.preview?.title
        case .empty: tr("native.share.nothingToSaveMessage")
        case let .done(result):
            if result.needsSignIn {
                tr("native.share.signInMessage")
            } else if result.isComplete {
                // "Saved 3 items" already says how many.
                result.successfulItems == 1 ? model.preview?.title : nil
            } else {
                Self.failureMessage(result)
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

    // MARK: Actions

    /// Close, or open Teak to sign in.
    @ViewBuilder private var actions: some View {
        if case let .done(result) = model.phase, result.needsSignIn {
            HStack(spacing: 10) {
                closeButton
                Button(action: openApp) {
                    Text(tr("native.share.openTeak"))
                        .fontWeight(.semibold)
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.glassProminent)
                .controlSize(.large)
            }
        } else {
            closeButton
        }
    }

    private var closeButton: some View {
        Button(action: close) {
            Text(tr("common.close"))
                .fontWeight(.medium)
                .foregroundStyle(.primary)
                .frame(maxWidth: .infinity)
        }
        .buttonStyle(.glass)
        .controlSize(.large)
    }

    /// Tags and a note for one saved card; folders for one or several. Rows rise in one after another.
    private var details: some View {
        VStack(spacing: 14) {
            VStack(spacing: 0) {
                if model.savedCardId != nil {
                    cardFields
                }
                foldersRow.reveal(order: 2)
            }
            .background(.fill.quaternary, in: .rect(cornerRadius: 20, style: .continuous))
            if let error = model.detailsError {
                Label(error, systemImage: "exclamationmark.circle.fill")
                    .font(.footnote)
                    .foregroundStyle(.red)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .transition(.opacity)
            }
            doneButton.reveal(order: 3)
        }
        .animation(.smooth(duration: 0.25), value: model.detailsError)
    }

    @ViewBuilder private var cardFields: some View {
        row(symbol: "number") {
            TextField(tr("native.actions.addTags"), text: $tags)
                .focused($focus, equals: .tags)
                .submitLabel(.next)
                .onSubmit { focus = .note }
                .accessibilityLabel(tr("native.tags.title"))
                .accessibilityIdentifier("share.tags")
                #if os(iOS)
                .textInputAutocapitalization(.never)
                #endif
        }
        .reveal(order: 0)
        Divider().padding(.leading, 48)
        row(symbol: "text.alignleft") {
            TextField(tr("native.share.addNote"), text: $note, axis: .vertical)
                .focused($focus, equals: .note)
                .lineLimit(1...4)
                .accessibilityLabel(tr("native.share.note"))
                .accessibilityIdentifier("share.note")
        }
        .reveal(order: 1)
        Divider().padding(.leading, 48)
    }

    private func row(symbol: String, @ViewBuilder content: () -> some View) -> some View {
        HStack(spacing: 12) {
            Image(systemName: symbol)
                .font(.body.weight(.medium))
                .foregroundStyle(.secondary)
                .frame(width: 24)
            content()
                .textFieldStyle(.plain)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .frame(minHeight: 50)
    }

    /// Opens the folder checklist; shows the folders picked, or a prompt like the fields above.
    private var foldersRow: some View {
        let names = model.folderNames
        let summary = names.formatted(.list(type: .and).locale(AppLanguage.locale))
        return Button { isPickingFolders = true } label: {
            row(symbol: names.isEmpty ? "folder" : "folder.fill") {
                HStack {
                    Text(names.isEmpty ? tr("native.share.addToFolders") : summary)
                        .foregroundStyle(names.isEmpty ? .secondary : .primary)
                        .lineLimit(1)
                        .contentTransition(.opacity)
                    Spacer(minLength: 0)
                    Image(systemName: "chevron.right")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(.tertiary)
                }
            }
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(tr("native.folders.title"))
        .accessibilityValue(summary)
        .accessibilityIdentifier("share.folders")
        .animation(.smooth(duration: 0.25), value: names)
    }

    /// Saves what was typed, then closes. While the card waits to close by itself, a lighter
    /// band drains across the button.
    private var doneButton: some View {
        Button(action: finish) {
            ZStack {
                Text(isEditing ? tr("common.save") : tr("common.done"))
                    .fontWeight(.semibold)
                    .foregroundStyle(.white)
                    .contentTransition(.opacity)
                    .opacity(model.isSavingDetails ? 0 : 1)
                if model.isSavingDetails { ProgressView().controlSize(.small) }
            }
            .frame(maxWidth: .infinity)
            .background(alignment: .leading) {
                GeometryReader { proxy in
                    Capsule()
                        .fill(.white.opacity(0.18))
                        .frame(width: proxy.size.width * countdown)
                }
                .padding(.horizontal, -20)
                .padding(.vertical, -14)
                .opacity(isCountingDown ? 1 : 0)
                .animation(.easeOut(duration: 0.3), value: isCountingDown)
            }
        }
        .buttonStyle(.glassProminent)
        .controlSize(.large)
        .disabled(model.isSavingDetails)
        .animation(.smooth(duration: 0.25), value: isEditing)
        .accessibilityIdentifier("share.done")
    }

    // MARK: Closing

    private func startEditing() {
        isEditing = true
        isCountingDown = false
    }

    private func finish() {
        Task {
            if await model.saveDetails(tags: tags, note: note) { close() } else { shake() }
        }
    }

    private func shake() {
        guard !reduceMotion else { return }
        shakes += 1
    }
}

/// Shakes its content side to side once each time the trigger changes, like a wrong password.
private struct Shake: ViewModifier {
    let trigger: Int

    func body(content: Content) -> some View {
        content.keyframeAnimator(initialValue: CGFloat.zero, trigger: trigger) { content, x in
            content.offset(x: x)
        } keyframes: { _ in
            KeyframeTrack {
                SpringKeyframe(12, duration: 0.07)
                SpringKeyframe(-10, duration: 0.08)
                SpringKeyframe(6, duration: 0.08)
                SpringKeyframe(0, duration: 0.2)
            }
        }
    }
}

private extension View {
    /// Fades and lifts a row into place, a beat after the one before it.
    func reveal(order: Int) -> some View {
        modifier(Reveal(order: order))
    }
}

private struct Reveal: ViewModifier {
    let order: Int
    @State private var isVisible = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        content
            .opacity(isVisible ? 1 : 0)
            .offset(y: isVisible || reduceMotion ? 0 : 18)
            .onAppear {
                withAnimation(.spring(duration: 0.55, bounce: 0.25).delay(0.1 + Double(order) * 0.06)) {
                    isVisible = true
                }
            }
    }
}
