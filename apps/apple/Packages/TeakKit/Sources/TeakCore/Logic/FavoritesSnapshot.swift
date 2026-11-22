import Foundation

/// The newest favorites as the Favorites widget shows them. The app writes it
/// to the app group while it runs and signed in, and empties it on sign-out,
/// so the widget never signs in or touches the network. It holds what a card
/// tile shows (title, site, type, palette, a small thumbnail), never notes or
/// full text, and never a card in Trash, the Archive or a hidden one.
public struct FavoritesSnapshot: Codable, Equatable, Sendable {
    public struct Card: Codable, Hashable, Sendable, Identifiable {
        public let id: String
        public let type: CardType
        public let title: String
        public let host: String?
        /// A palette's first colors, as `#RRGGBB`.
        public let colors: [String]
        /// The thumbnail's file name in the snapshot's folder, when it has one.
        public var image: String?

        public init(id: String, type: CardType, title: String, host: String? = nil, colors: [String] = [],
                    image: String? = nil) {
            self.id = id
            self.type = type
            self.title = title
            self.host = host
            self.colors = colors
            self.image = image
        }

        /// The card as a library page lists it, and where its thumbnail comes from. The file
        /// name changes with the thumbnail, so a replaced image is fetched again.
        public static func from(_ summary: CardSummary) -> (card: Card, thumbnail: URL?)? {
            guard let indexed = IndexedCard(summary) else { return nil }
            let colors = (summary.colors ?? []).compactMap(PaletteEdit.storedHex).prefix(FavoritesSnapshot.maxColors)
            let card = Card(id: indexed.id, type: indexed.type, title: indexed.title, host: indexed.host,
                            colors: Array(colors),
                            image: indexed.thumbnailURL.map { _ in "\(indexed.id)-\(indexed.fingerprint).jpg" })
            return (card, indexed.thumbnailURL)
        }

        public var subtitle: String { host ?? type.label }
        public var link: URL { TeakLink.card(id).url }
    }

    public var cards: [Card]

    public init(cards: [Card] = []) {
        self.cards = cards
    }

    /// The widget's kind, so the app can ask WidgetKit to reload it.
    public static let widgetKind = "com.praveenjuge.teak.widgets.favorites"
    /// The most a widget shows: one small, four medium, six large.
    public static let limit = 6
    public static let maxColors = 5
    private static let fileName = "Favorites.json"

    /// Arguments for the newest favorites, as the library's Favorites filter reads them. A live
    /// page keeps the end it first loaded with, so unfavoriting shrinks it rather than pulling
    /// in the next favorite: a full page leaves room for that, and for cards the snapshot skips.
    public static var searchArgs: ConvexArgs {
        var args = CardIndex.searchArgs("", limit: CardIndex.maxPageSize)
        args["favoritesOnly"] = true
        return args
    }

    public static func folder(in container: URL) -> URL {
        container.appending(path: "Widgets", directoryHint: .isDirectory)
    }

    public static func read(from container: URL) -> FavoritesSnapshot {
        let file = folder(in: container).appending(path: fileName)
        guard let data = try? Data(contentsOf: file) else { return FavoritesSnapshot() }
        return (try? JSONDecoder().decode(FavoritesSnapshot.self, from: data)) ?? FavoritesSnapshot()
    }

    /// Writes the snapshot and its thumbnails, keyed by file name, then drops thumbnails it no longer names.
    public func write(to container: URL, images: [String: Data]) throws {
        let folder = Self.folder(in: container)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        for (name, data) in images { try data.write(to: folder.appending(path: name), options: .atomic) }
        try JSONEncoder().encode(self).write(to: folder.appending(path: Self.fileName), options: .atomic)
        let kept = Set(cards.compactMap(\.image) + [Self.fileName])
        for file in (try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)) ?? []
            where !kept.contains(file.lastPathComponent) {
            try? FileManager.default.removeItem(at: file)
        }
    }

    public static func clear(in container: URL) {
        try? FileManager.default.removeItem(at: folder(in: container))
    }
}
