import Foundation
import TeakCore
import TeakSync
import WidgetKit

/// Keeps the Favorites widget's snapshot in the app group: while Convex is
/// signed in it follows the newest favorites, saves them with small
/// thumbnails and asks WidgetKit to redraw. Signing out empties it, so the
/// widget never shows another account's cards.
@MainActor
final class FavoritesWidgetWriter {
    /// Large tiles are about 160 points wide, at up to 3x.
    private nonisolated static let thumbnailSize = 480

    private let backend: TeakBackend
    private let container: URL?
    private var following: Task<Void, Never>?
    /// The latest sign-out's clear. Following waits for it, so a clear that
    /// finishes late can't erase the next account's favorites.
    private var clearing: Task<Void, Never>?

    init(backend: TeakBackend, container: URL?) {
        self.backend = backend
        self.container = container
    }

    func start() {
        guard following == nil, let container else { return }
        following = Task { [backend, clearing] in
            await clearing?.value
            while !Task.isCancelled {
                do {
                    for try await result in backend.subscribe(ConvexFunctions.searchCardSummaries,
                                                              FavoritesSnapshot.searchArgs) {
                        if await Self.save(result.page.page, to: container) {
                            WidgetCenter.shared.reloadTimelines(ofKind: FavoritesSnapshot.widgetKind)
                        }
                    }
                } catch {}
                try? await Task.sleep(for: .seconds(5))
            }
        }
    }

    func stop() {
        following?.cancel()
        following = nil
    }

    func clear() {
        let previous = following
        stop()
        guard let container else { return }
        let earlier = clearing
        clearing = Task {
            await earlier?.value
            await previous?.value
            FavoritesSnapshot.clear(in: container)
            WidgetCenter.shared.reloadTimelines(ofKind: FavoritesSnapshot.widgetKind)
        }
    }

    /// Writes the favorites, fetching only thumbnails not saved yet. False when nothing changed.
    private nonisolated static func save(_ page: [CardSummary], to container: URL) async -> Bool {
        let folder = FavoritesSnapshot.folder(in: container)
        let favorites = Array(page.compactMap(FavoritesSnapshot.Card.from).prefix(FavoritesSnapshot.limit))
        let images: [String: Data] = await withTaskGroup(of: (String, Data?).self) { group in
            for (card, url) in favorites {
                guard let name = card.image, let url,
                      !FileManager.default.fileExists(atPath: folder.appending(path: name).path()) else { continue }
                group.addTask { (name, await SpotlightIndexer.thumbnail(url, maxPixelSize: thumbnailSize)) }
            }
            var result: [String: Data] = [:]
            for await (name, data) in group { if let data { result[name] = data } }
            return result
        }
        let cards = favorites.map { card, _ in
            var card = card
            // A thumbnail that failed to load shows as the card's type until the next try.
            if let name = card.image, images[name] == nil,
               !FileManager.default.fileExists(atPath: folder.appending(path: name).path()) {
                card.image = nil
            }
            return card
        }
        let snapshot = FavoritesSnapshot(cards: cards)
        // A sign-out while thumbnails loaded wins.
        guard !Task.isCancelled, snapshot != FavoritesSnapshot.read(from: container) || !images.isEmpty else { return false }
        return (try? snapshot.write(to: container, images: images)) != nil
    }
}
