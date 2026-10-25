import Observation
import SwiftUI
import TeakCore
import TeakSync

/// Revisit: up to 20 shuffled cards from the current view, one at a time.
/// Archive the ones you're done with, keep the rest.
@MainActor @Observable
final class RevisitModel {
    static let deckSize = 20

    private(set) var cards: [CardSummary] = []
    private(set) var index = 0
    private(set) var archived = 0
    private(set) var kept = 0
    private(set) var isLoading = true
    private(set) var isPending = false
    private(set) var failed = false
    private(set) var lastArchived: String?
    private(set) var isExhausted = false

    @ObservationIgnored private let backend: TeakBackend
    @ObservationIgnored private let library: LibraryModel
    @ObservationIgnored private var args: ConvexArgs
    @ObservationIgnored private var cursor: String?
    @ObservationIgnored private var seed = ShuffleSeed.next(after: nil)
    @ObservationIgnored private var history: [(id: String, archived: Bool)] = []

    init(backend: TeakBackend, library: LibraryModel) {
        self.backend = backend
        self.library = library
        var query = library.query
        query.sort = .newest
        args = query.searchArgs()
    }

    var current: CardSummary? { index < cards.count ? cards[index] : nil }
    var isFinished: Bool { !isLoading && !failed && !cards.isEmpty && current == nil }
    var position: String {
        tr("native.revisit.position", localizedNumber(min(index + 1, cards.count)), localizedNumber(cards.count))
    }

    func deal(startOver: Bool = false) async {
        if startOver {
            seed = ShuffleSeed.next(after: seed)
            cursor = nil
        }
        isLoading = true
        failed = false
        var query = args
        query["sort"] = "shuffle"
        query["shuffleSeed"] = .number(seed)
        do {
            // A shuffled page can come back short, so keep reading until the deck is full.
            var dealt: [CardSummary] = []
            var done = false
            while dealt.count < Self.deckSize, !done {
                query["paginationOpts"] = ["numItems": .number(Self.deckSize - dealt.count),
                                           "cursor": cursor.map(ConvexValue.string) ?? .null]
                let result = try await backend.query(ConvexFunctions.searchCardSummaries, query)
                dealt += result.page.page.filter { card in !dealt.contains { $0.id == card.id } }
                cursor = result.page.continueCursor
                done = result.page.isDone || cursor == nil
            }
            cards = Array(dealt.prefix(Self.deckSize))
            isExhausted = done
            index = 0
            archived = 0
            kept = 0
            history = []
            lastArchived = nil
        } catch {
            failed = true
        }
        isLoading = false
    }

    func archive() async {
        guard let card = current, !isPending else { return }
        isPending = true
        defer { isPending = false }
        do {
            try await library.updateArchive(card.id, true)
            history.append((card.id, true))
            lastArchived = card.id
            archived += 1
            index += 1
            AccessibilityNotification.Announcement(tr("native.revisit.archived")).post()
        } catch {
            library.show(error)
        }
    }

    func keep() {
        guard let card = current, !isPending else { return }
        history.append((card.id, false))
        kept += 1
        index += 1
    }

    /// Steps back one card; an archived one comes back to the library.
    func undo() async {
        guard let last = history.last, !isPending else { return }
        isPending = true
        defer { isPending = false }
        if last.archived {
            do {
                try await library.updateArchive(last.id, false)
                archived -= 1
            } catch {
                library.show(error)
                return
            }
        } else {
            kept -= 1
        }
        history.removeLast()
        index -= 1
        lastArchived = history.last(where: \.archived)?.id
    }
}

struct RevisitView: View {
    @State var model: RevisitModel
    @Environment(\.dismiss) private var dismiss
    @State private var drag = CGSize.zero
    @FocusState private var focused: Bool
    private let threshold = 96.0

    var body: some View {
        NavigationStack {
            content
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .padding(20)
                .navigationTitle(tr("native.revisit.title"))
                #if os(iOS)
                .navigationBarTitleDisplayMode(.inline)
                #endif
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button(tr("native.revisit.close"), systemImage: "xmark") { dismiss() }
                    }
                    if model.current != nil {
                        ToolbarItem(placement: .principal) {
                            Text(model.position).font(.subheadline.weight(.medium)).monospacedDigit()
                        }
                    }
                }
        }
        #if os(macOS)
        .frame(minWidth: 460, minHeight: 620)
        #endif
        .focusable()
        .focusEffectDisabled()
        .focused($focused)
        .onAppear { focused = true }
        .onKeyPress(keys: [.leftArrow, .rightArrow, "a", "k", "z"]) { press in
            guard press.modifiers.isEmpty else { return .ignored }
            switch press.key {
            case .leftArrow, "a": Task { await model.archive() }
            case .rightArrow, "k": model.keep()
            default: Task { await model.undo() }
            }
            return .handled
        }
        .task { if model.cards.isEmpty { await model.deal() } }
        .sensoryFeedback(.impact(weight: .light), trigger: model.index)
    }

    @ViewBuilder private var content: some View {
        if model.isLoading {
            ProgressView().accessibilityLabel(tr("native.library.loadingCards"))
        } else if model.failed {
            ContentUnavailableView {
                Label(tr("native.library.loadFailed.title"), systemImage: "exclamationmark.triangle")
            } description: {
                Text(tr("native.errors.offline"))
            } actions: {
                Button(tr("common.retry")) { Task { await model.deal() } }.buttonStyle(.bordered)
            }
        } else if model.cards.isEmpty {
            ContentUnavailableView {
                Label(tr("native.revisit.emptyTitle"), systemImage: "rectangle.stack")
            } description: {
                Text(tr("native.revisit.emptyMessage"))
            } actions: {
                Button(tr("common.done")) { dismiss() }.buttonStyle(.bordered)
            }
        } else if let card = model.current {
            deck(card)
        } else {
            finished
        }
    }

    private func deck(_ card: CardSummary) -> some View {
        VStack(spacing: 20) {
            Spacer(minLength: 0)
            GeometryReader { proxy in
                let width = min(proxy.size.width, 380)
                let height = min(CardGrid.estimatedHeight(card, columnWidth: width), max(proxy.size.height - 40, 80))
                VStack(spacing: 10) {
                    CardTile(card: card, width: width)
                        .frame(height: height, alignment: .top)
                        .clipShape(RoundedRectangle(cornerRadius: CardGrid.tileRadius, style: .continuous))
                        .shadow(color: .black.opacity(0.12), radius: 12, y: 6)
                        .overlay(alignment: .top) { swipeHint }
                    caption(card)
                }
                .frame(width: width)
                .offset(x: drag.width)
                .rotationEffect(.degrees(drag.width / 24))
                .gesture(swipe)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .accessibilityElement(children: .combine)
                .accessibilityAction(named: tr("native.actions.archive")) { Task { await model.archive() } }
                .accessibilityAction(named: tr("native.revisit.keep")) { model.keep() }
                .accessibilityAction(named: tr("common.undo")) { Task { await model.undo() } }
                .id(card.id)
                .transition(.asymmetric(insertion: .scale(scale: 0.95).combined(with: .opacity), removal: .opacity))
            }
            HStack(spacing: 16) {
                Button { Task { await model.archive() } } label: {
                    Label(tr("native.actions.archive"), systemImage: "archivebox").frame(maxWidth: .infinity)
                }
                Button { model.keep() } label: {
                    Label(tr("native.revisit.keep"), systemImage: "hand.thumbsup").frame(maxWidth: .infinity)
                }
            }
            .buttonStyle(.glass)
            .controlSize(.large)
            .disabled(model.isPending)
            .frame(maxWidth: 380)
            HStack(spacing: 12) {
                Text(hint).font(.footnote).foregroundStyle(.secondary)
                if model.lastArchived != nil {
                    Button(tr("common.undo")) { Task { await model.undo() } }
                        .font(.footnote.weight(.medium))
                        .buttonStyle(.borderless)
                }
            }
        }
        .animation(.smooth, value: model.index)
    }

    private var hint: String {
        #if os(macOS)
        tr("apple.library.revisitKeys")
        #else
        tr("native.revisit.swipeHint")
        #endif
    }

    @ViewBuilder private var swipeHint: some View {
        if abs(drag.width) > 24 {
            Text(drag.width < -threshold ? tr("native.revisit.releaseToArchive")
                 : drag.width > threshold ? tr("native.revisit.releaseToKeep")
                 : drag.width < 0 ? tr("native.actions.archive") : tr("native.revisit.keep"))
                .font(.footnote.weight(.semibold))
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .glassEffect(.regular, in: .capsule)
                .padding(.top, 12)
        }
    }

    private func caption(_ card: CardSummary) -> some View {
        let saved = Date(timeIntervalSince1970: card.creationTime / 1000)
            .formatted(Date.FormatStyle(date: .abbreviated, time: .omitted).locale(AppLanguage.locale))
        return Label(tr("native.revisit.caption", card.type.label, saved), systemImage: card.type.symbol)
            .font(.footnote)
            .foregroundStyle(.secondary)
    }

    private var swipe: some Gesture {
        DragGesture()
            .onChanged { drag = $0.translation }
            .onEnded { value in
                let width = value.translation.width
                withAnimation(.smooth) { drag = .zero }
                if width < -threshold {
                    Task { await model.archive() }
                } else if width > threshold {
                    model.keep()
                }
            }
    }

    private var finished: some View {
        ContentUnavailableView {
            Label(tr("native.revisit.finishedTitle"), systemImage: "checkmark.circle")
        } description: {
            Text(tr("native.revisit.summary", localizedNumber(model.archived), localizedNumber(model.kept)))
        } actions: {
            VStack(spacing: 10) {
                Button(model.isExhausted ? tr("native.revisit.startOver") : tr("native.revisit.revisitMore", count: RevisitModel.deckSize)) {
                    Task { await model.deal(startOver: model.isExhausted) }
                }
                .buttonStyle(.glassProminent)
                Button(tr("common.done")) { dismiss() }.buttonStyle(.bordered)
                if model.lastArchived != nil {
                    Button(tr("native.revisit.undoLastArchive")) { Task { await model.undo() } }.buttonStyle(.borderless)
                }
            }
        }
    }
}
