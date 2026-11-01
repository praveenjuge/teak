import AppIntents
import CoreSpotlight
import TeakCore
import UniformTypeIdentifiers

/// A card in Shortcuts, Siri and Spotlight. Spotlight indexes this same
/// entity, so a Spotlight result and a card in a shortcut are one thing.
struct CardEntity: IndexedEntity {
    static let typeDisplayRepresentation = TypeDisplayRepresentation(
        name: LocalizedStringResource("intents.cardEntity", table: "AppIntents"))
    static let defaultQuery = CardEntityQuery()

    let id: String
    let card: IndexedCard

    @Property(title: LocalizedStringResource("intents.titleProperty", table: "AppIntents"))
    var title: String

    @Property(title: LocalizedStringResource("intents.linkProperty", table: "AppIntents"))
    var link: URL?

    init(_ card: IndexedCard) {
        id = card.id
        self.card = card
        title = card.title
        link = card.url
    }

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "\(card.title)", subtitle: "\(card.subtitle)",
                              image: card.thumbnailURL.map { .init(url: $0) } ?? .init(systemName: card.type.symbol))
    }

    var attributeSet: CSSearchableItemAttributeSet {
        let set = CSSearchableItemAttributeSet(contentType: card.type.contentType)
        set.title = card.title
        set.displayName = card.title
        set.contentDescription = card.summary
        set.keywords = card.keywords
        set.kind = card.type.label
        set.contentCreationDate = Date(timeIntervalSince1970: card.creationTime / 1000)
        return set
    }
}

extension CardType {
    var contentType: UTType {
        switch self {
        case .text, .quote: .text
        case .link: .url
        case .image: .image
        case .video: .movie
        case .audio: .audio
        case .document, .palette: .content
        }
    }
}

struct CardEntityQuery: EntityStringQuery {
    func entities(for identifiers: [CardEntity.ID]) async throws -> [CardEntity] {
        let http = try await IntentSession.http()
        var cards: [CardEntity] = []
        for id in identifiers where TeakLink.isCardId(id) {
            let card = try await http.query(ConvexFunctions.getCard, ["id": .string(id)])
            // Search Teak can return archived cards, so a later action still finds them.
            if let indexed = card.flatMap({ IndexedCard($0, includeArchived: true) }) { cards.append(CardEntity(indexed)) }
        }
        return cards
    }

    func entities(matching string: String) async throws -> [CardEntity] {
        try await CardSearch.run(string)
    }

    func suggestedEntities() async throws -> [CardEntity] {
        try await CardSearch.run("")
    }
}

enum CardSearch {
    static func run(_ text: String, includeArchived: Bool = false) async throws -> [CardEntity] {
        guard !CardIndex.revealsHidden(text) else {
            try await IntentSession.requireSignedIn()
            return []
        }
        let http = try await IntentSession.http()
        async let active = http.query(ConvexFunctions.searchCardSummaries, CardIndex.searchArgs(text))
        let archived = includeArchived
            ? try await http.query(ConvexFunctions.searchCardSummaries, CardIndex.searchArgs(text, archivedOnly: true)).page.page
            : []
        return CardIndex.results(try await active.page.page, archived: archived, includeArchived: includeArchived)
            .map(CardEntity.init)
    }
}
