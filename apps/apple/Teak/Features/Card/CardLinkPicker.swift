import SwiftUI
import TeakCore
import TeakSync

@MainActor @Observable
final class CardLinkPickerModel {
    enum Results: Equatable {
        case loading, failed, ready([LinkedCard])
    }

    private(set) var open: CardLinks.OpenQuery?
    private(set) var results: Results = .loading
    private(set) var highlighted = 0

    @ObservationIgnored private let cardId: String
    @ObservationIgnored private let backend: TeakBackend
    @ObservationIgnored private var dismissedStart: Int?
    @ObservationIgnored private var search: Task<Void, Never>?

    /// As on the web: search once typing pauses.
    private static let debounce = Duration.milliseconds(150)

    init(cardId: String, backend: TeakBackend) {
        self.cardId = cardId
        self.backend = backend
    }

    var isOpen: Bool { open != nil }

    var cards: [LinkedCard] {
        if case .ready(let cards) = results { cards } else { [] }
    }

    var message: String? {
        switch results {
        case .loading: tr("native.linkPicker.searching")
        case .failed: tr("native.linkPicker.failed")
        case .ready(let cards) where cards.isEmpty:
            open?.query.isEmpty == false ? tr("native.linkPicker.noMatches") : tr("native.linkPicker.noCards")
        case .ready: nil
        }
    }

    /// A typed change or a cursor move; `cursor` is a UTF-16 offset, or nil
    /// when text is selected.
    func update(text: String, cursor: Int?) {
        let next = cursor.flatMap { CardLinks.openQuery(in: text, cursor: $0) }
        if next?.start != dismissedStart { dismissedStart = nil }
        show(next?.start == dismissedStart ? nil : next)
    }

    func dismiss() {
        dismissedStart = open?.start
        show(nil)
    }

    /// `text` with the typed `[[query` swapped for a link to `card`, and
    /// where the cursor goes (a UTF-16 offset).
    func pick(_ card: LinkedCard, in text: String) -> (text: String, cursor: Int)? {
        guard let open else { return nil }
        show(nil)
        return CardLinks.insertingLink(in: text, replacing: open, title: card.title, id: card.id)
    }

    var highlightedCard: LinkedCard? {
        cards.indices.contains(highlighted) ? cards[highlighted] : nil
    }

    func moveHighlight(by step: Int) {
        guard !cards.isEmpty else { return }
        highlighted = (highlighted + step + cards.count) % cards.count
    }

    private func show(_ next: CardLinks.OpenQuery?) {
        let previous = open
        open = next
        guard let next else {
            search?.cancel()
            search = nil
            results = .loading
            return
        }
        guard previous == nil || previous?.query != next.query else { return }
        search?.cancel()
        let query = next.query
        search = Task { [weak self, backend, cardId] in
            try? await Task.sleep(for: Self.debounce)
            guard !Task.isCancelled else { return }
            let args: ConvexArgs = ["query": .string(query), "excludeCardId": .string(cardId)]
            do {
                let cards = try await backend.query(ConvexFunctions.searchCardLinkSuggestions, args)
                guard !Task.isCancelled, let self else { return }
                results = .ready(cards)
                highlighted = 0
            } catch {
                guard !Task.isCancelled, let self else { return }
                results = .failed
            }
        }
    }
}

/// The note's text and selection, watched together so the picker sees both
/// after a change.
struct LinkEditPoint: Equatable {
    let text: String
    let selection: TextSelection?

    /// The caret as a UTF-16 offset, or nil when text is selected.
    var cursor: Int? {
        guard case .selection(let range)? = selection?.indices, range.isEmpty, range.upperBound <= text.endIndex else {
            return nil
        }
        return range.lowerBound.utf16Offset(in: text)
    }
}

struct CardLinkPicker: View {
    let model: CardLinkPickerModel
    let onPick: (LinkedCard) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            ForEach(Array(model.cards.enumerated()), id: \.element.id) { index, card in
                Button { onPick(card) } label: {
                    Label(card.title, systemImage: card.type.symbol)
                        .lineLimit(1)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.vertical, 6)
                        .padding(.horizontal, 8)
                        .background(index == model.highlighted ? Color.accentColor.opacity(0.15) : .clear,
                                    in: .rect(cornerRadius: 8))
                        .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(tr("native.linkPicker.option", card.title))
                .accessibilityAddTraits(index == model.highlighted ? .isSelected : [])
            }
            if let message = model.message {
                Text(message)
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .padding(.vertical, 6)
                    .padding(.horizontal, 8)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(tr("native.linkPicker.label"))
        .accessibilityIdentifier("edit.linkPicker")
    }
}
