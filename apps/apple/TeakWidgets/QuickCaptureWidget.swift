import SwiftUI
import TeakCore
import TeakUI
import WidgetKit

/// One tap to start saving: a note, a voice memo, photos, the camera or
/// files. Each button is a `teak://` link the app follows once it opens.
/// It shows no cards, so it reads nothing and never changes.
struct QuickCaptureWidget: Widget {
    static let kind = "com.praveenjuge.teak.widgets.quick-capture"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: Self.kind, provider: QuickCaptureProvider()) { _ in
            QuickCaptureView()
        }
        .configurationDisplayName(tr("native.widgets.quickCapture"))
        .description(tr("native.widgets.quickCaptureDescription"))
        .supportedFamilies(Self.families)
        .contentMarginsDisabled()
    }

    private static var families: [WidgetFamily] {
        #if os(iOS)
        [.systemSmall, .systemMedium, .accessoryCircular]
        #else
        [.systemSmall, .systemMedium]
        #endif
    }
}

struct QuickCaptureProvider: TimelineProvider {
    func placeholder(in context: Context) -> QuickCaptureEntry { QuickCaptureEntry(date: .now) }

    func getSnapshot(in context: Context, completion: @escaping (QuickCaptureEntry) -> Void) {
        completion(QuickCaptureEntry(date: .now))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<QuickCaptureEntry>) -> Void) {
        completion(Timeline(entries: [QuickCaptureEntry(date: .now)], policy: .never))
    }
}

struct QuickCaptureEntry: TimelineEntry {
    let date: Date
}

private struct CaptureAction: Identifiable {
    let link: TeakLink
    /// What VoiceOver reads; the tile itself shows only the symbol.
    let title: String
    let symbol: String

    var id: String { symbol }

    static var all: [CaptureAction] {
        var actions = [
            CaptureAction(link: .newNote, title: tr("native.capture.newNote"), symbol: "square.and.pencil"),
            CaptureAction(link: .voiceMemo, title: tr("native.capture.voiceMemo"), symbol: "mic"),
            CaptureAction(link: .photos, title: tr("native.capture.photosAndVideos"), symbol: "photo.on.rectangle"),
        ]
        #if os(iOS)
        actions.append(CaptureAction(link: .camera, title: tr("native.capture.camera"), symbol: "camera"))
        #endif
        actions.append(CaptureAction(link: .files, title: tr("native.capture.files"), symbol: "folder"))
        return actions
    }
}

struct QuickCaptureView: View {
    @Environment(\.widgetFamily) private var family

    var body: some View {
        content
            .containerBackground(.background, for: .widget)
    }

    @ViewBuilder private var content: some View {
        let actions = CaptureAction.all
        switch family {
        case .systemMedium:
            // A large New Note beside the rest, two to a row.
            HStack(spacing: WidgetTiles.gap) {
                CaptureTile(action: actions[0], large: true)
                    .aspectRatio(1, contentMode: .fit)
                VStack(spacing: WidgetTiles.gap) {
                    ForEach(Self.rows(Array(actions.dropFirst())), id: \.first?.id) { row in
                        HStack(spacing: WidgetTiles.gap) {
                            ForEach(row) { CaptureTile(action: $0) }
                        }
                    }
                }
            }
            .padding(WidgetTiles.inset)
        #if os(iOS)
        case .accessoryCircular:
            // A Lock Screen widget has one tap target: a new note.
            ZStack {
                AccessoryWidgetBackground()
                Image(systemName: "square.and.pencil")
                    .font(.allo(.title3).weight(.medium))
            }
            .widgetURL(TeakLink.newNote.url)
            .accessibilityLabel(actions[0].title)
        #endif
        default:
            // The four most used, two by two.
            VStack(spacing: WidgetTiles.gap) {
                ForEach(Self.rows(Array(actions.prefix(4))), id: \.first?.id) { row in
                    HStack(spacing: WidgetTiles.gap) {
                        ForEach(row) { CaptureTile(action: $0) }
                    }
                }
            }
            .padding(WidgetTiles.inset)
        }
    }

    /// Two to a row; with an odd count, the first row holds one, as wide as two.
    private static func rows(_ actions: [CaptureAction]) -> [[CaptureAction]] {
        var rest = actions
        var rows: [[CaptureAction]] = []
        if rest.count % 2 == 1 { rows.append([rest.removeFirst()]) }
        while !rest.isEmpty {
            rows.append(Array(rest.prefix(2)))
            rest.removeFirst(min(2, rest.count))
        }
        return rows
    }
}

private struct CaptureTile: View {
    let action: CaptureAction
    var large = false

    var body: some View {
        Link(destination: action.link.url) {
            Image(systemName: action.symbol)
                .font(Font.allo(large ? .title : .title3).weight(.medium))
                .foregroundStyle(.primary)
                .widgetAccentable()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(.fill.tertiary, in: ContainerRelativeShape())
        }
        .accessibilityLabel(action.title)
    }
}
