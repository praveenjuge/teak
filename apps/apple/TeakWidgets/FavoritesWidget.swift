import ImageIO
import SwiftUI
import TeakCore
import WidgetKit

/// The newest favorites, from the snapshot the app keeps in the app group.
/// The app reloads it when they change; tapping a card opens it in Teak.
struct FavoritesWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: FavoritesSnapshot.widgetKind, provider: FavoritesProvider()) { entry in
            FavoritesView(entry: entry)
        }
        .configurationDisplayName(tr("native.filters.favorites"))
        .description(tr("native.widgets.favoritesDescription"))
        .supportedFamilies(Self.families)
        // The tiles set their own inset, so their corners follow the widget's.
        .contentMarginsDisabled()
    }

    private static var families: [WidgetFamily] {
        #if os(iOS)
        [.systemSmall, .systemMedium, .systemLarge, .accessoryRectangular, .accessoryInline]
        #else
        [.systemSmall, .systemMedium, .systemLarge]
        #endif
    }
}

struct FavoritesEntry: TimelineEntry {
    let date: Date
    let cards: [FavoritesSnapshot.Card]
    let images: [String: Image]

    func image(_ card: FavoritesSnapshot.Card) -> Image? { card.image.flatMap { images[$0] } }

    static var current: FavoritesEntry {
        guard let container = TeakConfig.current.sharedContainer else { return FavoritesEntry(date: .now, cards: [], images: [:]) }
        let snapshot = FavoritesSnapshot.read(from: container)
        let folder = FavoritesSnapshot.folder(in: container)
        var images: [String: Image] = [:]
        for name in snapshot.cards.compactMap(\.image) {
            guard let source = CGImageSourceCreateWithURL(folder.appending(path: name) as CFURL, nil),
                  let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else { continue }
            images[name] = Image(decorative: image, scale: 1)
        }
        return FavoritesEntry(date: .now, cards: snapshot.cards, images: images)
    }

    /// Shown redacted while the widget loads.
    static var placeholder: FavoritesEntry {
        let cards = [CardType.link, .image, .text, .palette, .quote, .document].enumerated().map { index, type in
            FavoritesSnapshot.Card(id: "placeholder\(index)", type: type, title: type.label)
        }
        return FavoritesEntry(date: .now, cards: cards, images: [:])
    }
}

struct FavoritesProvider: TimelineProvider {
    func placeholder(in context: Context) -> FavoritesEntry { .placeholder }

    func getSnapshot(in context: Context, completion: @escaping (FavoritesEntry) -> Void) {
        completion(.current)
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<FavoritesEntry>) -> Void) {
        completion(Timeline(entries: [.current], policy: .never))
    }
}

struct FavoritesView: View {
    @Environment(\.widgetFamily) private var family
    let entry: FavoritesEntry

    var body: some View {
        content
            .fontDesign(.rounded)
            .containerBackground(.background, for: .widget)
    }

    @ViewBuilder private var content: some View {
        if let first = entry.cards.first {
            switch family {
            case .systemMedium: grid(columns: 2, rows: 2)
            case .systemLarge: grid(columns: 2, rows: 3)
            #if os(iOS)
            case .accessoryRectangular:
                Label {
                    Text(first.title).lineLimit(3)
                } icon: {
                    Image(systemName: "heart.fill").widgetAccentable()
                }
                .font(.headline)
                .frame(maxWidth: .infinity, alignment: .leading)
                .widgetURL(first.link)
            case .accessoryInline:
                Label(first.title, systemImage: "heart.fill")
                    .widgetURL(first.link)
            #endif
            default:
                // One favorite, edge to edge.
                FavoriteTile(card: first, image: entry.image(first), fillsWidget: true)
                    .widgetURL(first.link)
            }
        } else {
            empty
        }
    }

    /// Equal tiles, inset and spaced alike, with corners that follow the widget's.
    private func grid(columns: Int, rows: Int) -> some View {
        VStack(spacing: WidgetTiles.gap) {
            ForEach(0..<rows, id: \.self) { row in
                HStack(spacing: WidgetTiles.gap) {
                    ForEach(0..<columns, id: \.self) { column in
                        let index = row * columns + column
                        if index < entry.cards.count {
                            let card = entry.cards[index]
                            Link(destination: card.link) {
                                FavoriteTile(card: card, image: entry.image(card))
                            }
                        } else {
                            ContainerRelativeShape().fill(.fill.quaternary)
                        }
                    }
                }
            }
        }
        .padding(WidgetTiles.inset)
    }

    @ViewBuilder private var empty: some View {
        switch family {
        #if os(iOS)
        case .accessoryRectangular, .accessoryInline:
            Label(tr("native.widgets.favoritesEmpty"), systemImage: "heart")
        #endif
        default:
            VStack(spacing: 8) {
                Image(systemName: "heart")
                    .font(.title2.weight(.medium))
                    .widgetAccentable()
                Text(tr("native.widgets.favoritesEmpty"))
                    .font(.subheadline.weight(.medium))
            }
            .foregroundStyle(.secondary)
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
}

/// The inset and spacing every Teak widget's tiles share.
enum WidgetTiles {
    static let inset = 12.0
    static let gap = 8.0
}

/// A card as itself, with no caption: its picture, its palette as bands, or
/// for text, its words on a quiet tile. A small widget shows it edge to edge.
private struct FavoriteTile: View {
    let card: FavoritesSnapshot.Card
    let image: Image?
    var fillsWidget = false

    var body: some View {
        if fillsWidget {
            tile
        } else {
            tile
                .background(.fill.tertiary)
                .clipShape(ContainerRelativeShape())
        }
    }

    @ViewBuilder private var tile: some View {
        if let image {
            Color.clear.overlay {
                image
                    .resizable()
                    .widgetAccentedRenderingMode(.desaturated)
                    .scaledToFill()
            }
            .clipped()
        } else if !card.colors.isEmpty {
            HStack(spacing: 0) {
                ForEach(Array(card.colors.enumerated()), id: \.offset) { _, hex in
                    Rectangle().fill(color(hex))
                }
            }
        } else {
            VStack(alignment: .leading, spacing: 8) {
                // Only the small widget has room for the type's symbol; a tile gives it to the words.
                if fillsWidget {
                    Image(systemName: card.type.symbol)
                        .font(.body.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .widgetAccentable()
                }
                Text(card.title)
                    .font(fillsWidget ? .headline : .footnote.weight(.semibold))
                    .foregroundStyle(.primary)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .padding(fillsWidget ? 16 : 10)
        }
    }

    /// The snapshot stores colors as `#RRGGBB`.
    private func color(_ hex: String) -> Color {
        guard let value = UInt32(hex.dropFirst(), radix: 16) else { return .gray }
        return Color(red: Double((value >> 16) & 0xFF) / 255, green: Double((value >> 8) & 0xFF) / 255,
                     blue: Double(value & 0xFF) / 255)
    }
}
