import CoreSpotlight
import Foundation
import ImageIO
import TeakCore
import UniformTypeIdentifiers

/// Puts the cards the app has seen into Spotlight, as `CardEntity`, so a
/// search on the device finds them and opens them in Teak.
///
/// Cards go in as library pages load and when the app opens (the newest 500),
/// and come out when the library sees them go to Trash, the Archive or a
/// hidden tag. Notes and full text never go in. Signing out empties it all.
/// A ledger of what's indexed, by account, keeps unchanged cards from being
/// sent again and lets a refresh find the ones that left while Teak was closed.
actor SpotlightIndexer {
    private static let domain = "cards"
    private static let thumbnailSize = 300
    /// Cards indexed together, so a first refresh doesn't fetch 500 thumbnails at once.
    private static let batchSize = 50
    private static let refreshInterval: Duration = .seconds(300)

    private struct Ledger: Codable {
        var owner: String?
        var cards: [String: Entry] = [:]
    }

    private struct Entry: Codable {
        let fingerprint: String
        let created: Double
    }

    private let session: TeakSession
    private let searchIndex = CSSearchableIndex.default()
    private let file = URL.applicationSupportDirectory.appending(path: "Spotlight.json")
    private var loaded: Ledger?
    private var inFlight: Set<String> = []
    /// Cards removed while their batch was being indexed; the batch leaves them out.
    private var withdrawn: Set<String> = []
    private var lastRefresh: ContinuousClock.Instant?
    /// Library changes and removals, applied one after another in the order they came.
    private let work: AsyncStream<CardIndex.Changes>.Continuation

    init(session: TeakSession) {
        self.session = session
        let (stream, work) = AsyncStream.makeStream(of: CardIndex.Changes.self)
        self.work = work
        Task { [weak self] in
            for await changes in stream {
                await self?.remove(changes.remove)
                await self?.index(changes.index)
            }
        }
    }

    // MARK: From the app

    /// Applies what a library view's cards say. Called on the main actor as pages load.
    nonisolated func apply(_ changes: CardIndex.Changes) {
        guard !changes.isEmpty else { return }
        work.yield(changes)
    }

    /// Follows a card opened on its own: once it's in Trash, archived or
    /// hidden, it leaves Spotlight. Library pages do the adding.
    nonisolated func follow(_ card: Card) {
        guard IndexedCard(card) == nil else { return }
        work.yield(CardIndex.Changes(remove: [card.id]))
    }

    /// Drops a card that no longer exists, such as one deleted on another device.
    nonisolated func forget(_ id: String) {
        work.yield(CardIndex.Changes(remove: [id]))
    }

    /// Reads the newest cards and indexes them, then drops the ones they show
    /// have left. Runs at most every five minutes.
    func refresh(_ backend: any ConvexCaller) async {
        if let lastRefresh, lastRefresh.duration(to: .now) < Self.refreshInterval { return }
        lastRefresh = .now
        var newest: [IndexedCard] = []
        var cursor: String?
        var complete = false
        do {
            while newest.count < CardIndex.refreshCount {
                let result = try await backend.query(ConvexFunctions.searchCardSummaries,
                                                     CardIndex.searchArgs("", limit: CardIndex.maxPageSize, cursor: cursor))
                newest += result.page.page.compactMap { IndexedCard($0) }
                cursor = result.page.continueCursor
                if result.page.isDone || cursor == nil {
                    complete = true
                    break
                }
            }
        } catch {
            lastRefresh = nil
            return
        }
        await index(newest)
        // What the read shows has left only counts while its account is still signed in.
        guard let owner = await session.user?.id, ledger().owner == owner else { return }
        await remove(CardIndex.stale(indexed: ledger().cards.mapValues(\.created), newest: newest, complete: complete))
    }

    /// Empties Teak's part of Spotlight, when no one is signed in.
    func removeAll() async {
        loaded = Ledger()
        lastRefresh = nil
        try? FileManager.default.removeItem(at: file)
        try? await searchIndex.deleteSearchableItems(withDomainIdentifiers: [Self.domain])
    }

    // MARK: Indexing

    private func index(_ cards: [IndexedCard]) async {
        guard let owner = await session.user?.id else { return }
        if ledger().owner != owner, !(await adopt(owner)) { return }
        let changed = cards.filter { ledger().cards[$0.id]?.fingerprint != $0.fingerprint && !inFlight.contains($0.id) }
        guard !changed.isEmpty, CSSearchableIndex.isIndexingAvailable() else { return }
        inFlight.formUnion(changed.map(\.id))
        defer {
            inFlight.subtract(changed.map(\.id))
            withdrawn.subtract(changed.map(\.id))
        }
        for start in stride(from: 0, to: changed.count, by: Self.batchSize) {
            await index(Array(changed[start..<min(start + Self.batchSize, changed.count)]), as: owner)
        }
    }

    private func index(_ changed: [IndexedCard], as owner: String) async {
        let thumbnails = await Self.thumbnails(for: changed)
        // Signing out while thumbnails load empties the index; nothing goes back in.
        guard await session.user?.id == owner, ledger().owner == owner else { return }
        // Nor does a card removed meanwhile.
        let changed = changed.filter { !withdrawn.contains($0.id) }
        guard !changed.isEmpty else { return }
        let items = changed.map { card in
            let entity = CardEntity(card)
            let item = CSSearchableItem(uniqueIdentifier: card.id, domainIdentifier: Self.domain,
                                        attributeSet: entity.attributeSet)
            item.associateAppEntity(entity)
            item.attributeSet.thumbnailData = thumbnails[card.id]
            // The ledger skips unchanged cards, so they mustn't expire on their own.
            item.expirationDate = .distantFuture
            return item
        }
        do {
            try await searchIndex.indexSearchableItems(items)
        } catch {
            return
        }
        // A card removed while this went in comes straight back out.
        let late = changed.map(\.id).filter(withdrawn.contains)
        if !late.isEmpty { try? await searchIndex.deleteSearchableItems(withIdentifiers: late) }
        for card in changed where !withdrawn.contains(card.id) {
            loaded?.cards[card.id] = Entry(fingerprint: card.fingerprint, created: card.creationTime)
        }
        save()
    }

    private func remove(_ ids: [String]) async {
        withdrawn.formUnion(ids.filter(inFlight.contains))
        let known = ids.filter { ledger().cards[$0] != nil }
        guard !known.isEmpty else { return }
        do {
            try await searchIndex.deleteSearchableItems(withIdentifiers: known)
        } catch {
            return
        }
        for id in known { loaded?.cards[id] = nil }
        save()
    }

    /// Another account's cards never stay indexed for this one.
    private func adopt(_ owner: String) async -> Bool {
        // Until the old account's items are gone, the ledger stays theirs and the next index tries again.
        guard (try? await searchIndex.deleteSearchableItems(withDomainIdentifiers: [Self.domain])) != nil else { return false }
        loaded = Ledger(owner: owner)
        save()
        return true
    }

    // MARK: Ledger

    private func ledger() -> Ledger {
        if let loaded { return loaded }
        let stored = (try? Data(contentsOf: file)).flatMap { try? JSONDecoder().decode(Ledger.self, from: $0) }
        loaded = stored ?? Ledger()
        return loaded ?? Ledger()
    }

    private func save() {
        guard let loaded, let data = try? JSONEncoder().encode(loaded) else { return }
        try? FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? data.write(to: file, options: .atomic)
    }

    // MARK: Thumbnails

    private static func thumbnails(for cards: [IndexedCard]) async -> [String: Data] {
        await withTaskGroup(of: (String, Data?).self) { group in
            for card in cards {
                guard let url = card.thumbnailURL else { continue }
                group.addTask { (card.id, await thumbnail(url)) }
            }
            var result: [String: Data] = [:]
            for await (id, data) in group { result[id] = data }
            return result
        }
    }

    /// A small JPEG of the card's image, as Spotlight shows beside a result.
    private static func thumbnail(_ url: URL) async -> Data? {
        guard let (data, response) = try? await URLSession.shared.data(from: url),
              (response as? HTTPURLResponse)?.statusCode == 200,
              let source = CGImageSourceCreateWithData(data as CFData, nil),
              let image = CGImageSourceCreateThumbnailAtIndex(source, 0, [
                  kCGImageSourceCreateThumbnailFromImageAlways: true,
                  kCGImageSourceCreateThumbnailWithTransform: true,
                  kCGImageSourceThumbnailMaxPixelSize: thumbnailSize,
              ] as CFDictionary)
        else { return nil }
        let output = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(output, UTType.jpeg.identifier as CFString, 1, nil)
        else { return nil }
        CGImageDestinationAddImage(destination, image, [kCGImageDestinationLossyCompressionQuality: 0.8] as CFDictionary)
        return CGImageDestinationFinalize(destination) ? output as Data : nil
    }
}
