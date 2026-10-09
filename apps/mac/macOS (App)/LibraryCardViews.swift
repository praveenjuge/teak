import AppKit
import AVKit
import SwiftUI

extension Color {
    init?(teakHex: String) {
        let digits = teakHex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
        let expanded: String
        switch digits.count {
        case 3, 4:
            expanded = digits.map { "\($0)\($0)" }.joined()
        case 6, 8:
            expanded = digits
        default:
            return nil
        }
        guard let value = UInt64(expanded, radix: 16) else { return nil }
        let hasAlpha = expanded.count == 8
        let rgb = hasAlpha ? value >> 8 : value
        self.init(.sRGB,
                  red: Double((rgb >> 16) & 0xff) / 255,
                  green: Double((rgb >> 8) & 0xff) / 255,
                  blue: Double(rgb & 0xff) / 255,
                  opacity: hasAlpha ? Double(value & 0xff) / 255 : 1)
    }
}

/// Card surface shared by grid tiles, the note composer, and detail boxes:
/// a rounded content background with a hairline border, like the web cards.
struct TeakCardSurface: ViewModifier {
    var cornerRadius: CGFloat = 16

    func body(content: Content) -> some View {
        let shape = RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
        content
            .background(Color(nsColor: .controlBackgroundColor), in: shape)
            .clipShape(shape)
            .overlay { shape.strokeBorder(.separator) }
    }
}

extension View {
    func teakCardSurface(cornerRadius: CGFloat = 16) -> some View {
        modifier(TeakCardSurface(cornerRadius: cornerRadius))
    }
}

struct LibraryCardTile: View {
    let card: LibraryCard
    let isSaving: Bool
    let onOpen: () -> Void

    var body: some View {
        tileContent
            .teakCardSurface()
            .overlay(alignment: .topTrailing) {
                if card.isFavorited {
                    Image(systemName: "heart.fill")
                        .font(.system(size: 13))
                        .foregroundStyle(.red)
                        .padding(12)
                }
            }
            .overlay { if isSaving { ProgressView() } }
            .opacity(isSaving ? 0.7 : card.isDeleted == true ? 0.6 : 1)
            .allowsHitTesting(!isSaving)
            .contentShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            .onTapGesture(perform: onOpen)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("\(card.cardType?.title ?? "Card"): \(card.title)")
            .accessibilityAddTraits(.isButton)
            .accessibilityAction(named: "Open card", onOpen)
    }

    @ViewBuilder private var tileContent: some View {
        switch card.cardType {
        case .text, nil:
            Text(card.cardType == nil ? card.content ?? "" : card.previewText)
                .font(.body.weight(.medium))
                .lineLimit(2)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(16)
        case .quote:
            QuoteTile(text: card.previewText)
        case .link:
            if let url = card.displayImageURL {
                VStack(spacing: 0) {
                    CardImage(url: url, ratio: imageRatio)
                    Divider()
                    Text(card.linkTitle)
                        .font(.body.weight(.medium))
                        .lineLimit(1)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 12)
                }
            } else {
                Text(card.linkTitle)
                    .font(.body.weight(.medium))
                    .lineLimit(1)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(16)
            }
        case .image:
            CardImage(url: card.displayImageURL, ratio: imageRatio,
                      placeholder: card.colors?.first.flatMap { Color(teakHex: $0.hex) })
        case .video:
            VideoTile(card: card, ratio: imageRatio)
        case .audio:
            WaveformBars(seed: card.id)
                .frame(height: 40)
                .padding(.horizontal, 16)
                .padding(.vertical, 8)
        case .document:
            VStack(spacing: 0) {
                if let url = card.displayImageURL {
                    CardImage(url: url, ratio: card.fileWidth == nil ? 3 / 4 : imageRatio, contentMode: .fit)
                        .background(.quinary)
                    Divider()
                }
                Label(card.fileName ?? "Document", systemImage: "doc")
                    .font(.callout.weight(.medium))
                    .lineLimit(1)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 16)
                    .padding(.vertical, card.displayImageURL == nil ? 16 : 12)
            }
        case .palette:
            if let colors = card.colors, !colors.isEmpty {
                HStack(spacing: 0) {
                    ForEach(Array(colors.prefix(12).enumerated()), id: \.offset) { _, color in
                        Rectangle().fill(Color(teakHex: color.hex) ?? .secondary).help(color.hex)
                    }
                }
                .frame(height: 56)
            } else {
                Text(card.content ?? "")
                    .font(.body.weight(.medium))
                    .lineLimit(2)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(16)
            }
        }
    }

    private var imageRatio: CGFloat {
        if card.cardType != .link, let width = card.fileWidth, let height = card.fileHeight, width > 0, height > 0 {
            return CGFloat(width) / CGFloat(height)
        }
        if let media = card.linkPreviewMedia?.first(where: { $0.type == "image" }),
           let width = media.width, let height = media.height, width > 0, height > 0 {
            return CGFloat(width) / CGFloat(height)
        }
        return 4 / 3
    }
}

struct CardImage: View {
    let url: URL?
    var ratio: CGFloat = 4 / 3
    var contentMode: ContentMode = .fill
    var placeholder: Color?

    var body: some View {
        GeometryReader { geometry in
            AsyncImage(url: url) { phase in
                if let image = phase.image {
                    image.resizable().aspectRatio(contentMode: contentMode)
                        .frame(width: geometry.size.width, height: geometry.size.height)
                } else { Rectangle().fill(placeholder.map(AnyShapeStyle.init) ?? AnyShapeStyle(.quinary)) }
            }.clipped()
        }.aspectRatio(ratio, contentMode: .fit)
    }
}

private struct QuoteTile: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.body.weight(.medium))
            .italic()
            .multilineTextAlignment(.center)
            .lineLimit(2)
            .lineSpacing(3)
            .frame(maxWidth: .infinity)
            .padding(.horizontal, 24)
            .padding(.vertical, 16)
            .overlay(alignment: .topLeading) { QuoteMark("\u{201C}").padding(.leading, 8) }
            .overlay(alignment: .bottomTrailing) { QuoteMark("\u{201D}").padding(.trailing, 8).offset(y: 14) }
    }
}

/// Faint serif quotation mark used around quote cards and quote previews.
struct QuoteMark: View {
    let glyph: String
    var size: CGFloat = 36
    init(_ glyph: String, size: CGFloat = 36) {
        self.glyph = glyph
        self.size = size
    }

    var body: some View {
        Text(glyph)
            .font(.system(size: size))
            .fontDesign(.serif)
            .foregroundStyle(.quaternary)
            .accessibilityHidden(true)
    }
}

/// The web app's deterministic waveform, so a recording looks the same on
/// every surface. Bars before `progress` use the accent color.
struct WaveformBars: View {
    let seed: String
    var progress: Double = 0
    static let barCount = 45

    var body: some View {
        let heights = Self.heights(seed: seed)
        let played = Int((progress * Double(Self.barCount)).rounded())
        GeometryReader { geometry in
            HStack(alignment: .center, spacing: 0) {
                ForEach(heights.indices, id: \.self) { index in
                    if index > 0 { Spacer(minLength: 1) }
                    Capsule()
                        .fill(index < played ? AnyShapeStyle(Color.accentColor) : AnyShapeStyle(.secondary))
                        .frame(width: 2, height: geometry.size.height * heights[index])
                }
            }
            .frame(maxHeight: .infinity)
        }
        .accessibilityHidden(true)
    }

    /// Port of `getAudioWaveHeight` in packages/ui AudioWavePreview: 20–80% of the height.
    static func heights(seed: String) -> [CGFloat] {
        (0..<barCount).map { index in
            var hash = Int32(truncatingIfNeeded: index)
            for unit in seed.utf16 {
                hash = (hash &<< 5) &- hash &+ Int32(unit)
            }
            return CGFloat(abs(sin(Double(hash))) * 0.6 + 0.2)
        }
    }
}

private struct VideoTile: View {
    let card: LibraryCard
    let ratio: CGFloat
    @State private var hovering = false

    var body: some View {
        ZStack {
            if hovering, let url = LibraryCard.safeURL(card.fileUrl) {
                HoverVideo(url: url)
            } else if let url = card.displayImageURL {
                CardImage(url: url, ratio: ratio)
            } else { Rectangle().fill(.black) }
            if !hovering {
                Color.black.opacity(0.2)
                Image(systemName: "play.fill")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(width: 44, height: 44)
                    .glassEffect(.clear.tint(.black.opacity(0.35)), in: .circle)
            }
        }
        .aspectRatio(ratio, contentMode: .fit)
        .onHover { hovering = $0 }
    }
}

private struct HoverVideo: NSViewRepresentable {
    let url: URL
    func makeNSView(context: Context) -> AVPlayerView {
        let view = AVPlayerView()
        view.controlsStyle = .none
        view.player = AVPlayer(url: url)
        view.player?.isMuted = true
        view.player?.play()
        return view
    }
    func updateNSView(_ view: AVPlayerView, context: Context) {}
    static func dismantleNSView(_ view: AVPlayerView, coordinator: ()) { view.player?.pause() }
}
