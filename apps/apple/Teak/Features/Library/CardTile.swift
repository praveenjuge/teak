import AVKit
import SwiftUI
import TeakCore
import TeakSync

/// One card in the grid, drawn like the web and iPhone tiles.
struct CardTile: View {
    let card: CardSummary
    let width: Double
    var isSelected: Bool?
    var isTrashed = false

    var body: some View {
        content
            .frame(width: width, alignment: .leading)
            .background(.background.secondary, in: shape)
            .clipShape(shape)
            .overlay(alignment: isSelected == nil ? .topTrailing : .bottomTrailing) { badge }
            .opacity(isTrashed ? 0.6 : 1)
            .contentShape(shape)
            .accessibilityElement(children: .combine)
            .accessibilityLabel(accessibilityText)
            .accessibilityAddTraits(isSelected == true ? [.isButton, .isSelected] : .isButton)
    }

    private var shape: some Shape { RoundedRectangle(cornerRadius: CardGrid.tileRadius, style: .continuous) }

    @ViewBuilder private var badge: some View {
        if let isSelected {
            Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                .font(.title3)
                .symbolRenderingMode(.palette)
                .foregroundStyle(isSelected ? .white : .secondary, isSelected ? Color.accentColor : .clear)
                .background(.background, in: .circle)
                .padding(8)
                .shadow(color: .black.opacity(0.2), radius: 2, y: 1)
                .contentTransition(.symbolEffect(.replace))
        } else if card.favorited {
            Image(systemName: "heart.fill")
                .font(.footnote)
                .foregroundStyle(.red)
                .padding(10)
                .shadow(color: .black.opacity(0.2), radius: 2, y: 1)
                .accessibilityLabel("Favorite")
        }
    }

    private var mediaHeight: Double { (width / CardGrid.tileImageRatio(card)).rounded() }
    private var imageURL: URL? { SafeURL.sanitize(CardGrid.tileImageURL(card)) }
    private var placeholderURL: URL? { SafeURL.sanitize(card.placeholderUrl) }

    @ViewBuilder private var content: some View {
        switch card.type {
        case .link:
            VStack(alignment: .leading, spacing: 0) {
                if let imageURL {
                    RemoteImage(imageURL, placeholder: placeholderURL)
                        .frame(width: width, height: mediaHeight)
                    TileFooter(title: card.title)
                } else {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(card.title).font(.subheadline.weight(.medium)).lineLimit(2)
                        if let host = SafeURL.hostname(card.url) {
                            Text(host).font(.footnote).foregroundStyle(.secondary).lineLimit(1)
                        }
                    }
                    .padding(14)
                }
            }
        case .image:
            RemoteImage(imageURL, placeholder: placeholderURL)
                .frame(width: width, height: mediaHeight)
        case .video:
            VideoTileMedia(card: card, url: imageURL, placeholder: placeholderURL)
                .frame(width: width, height: mediaHeight)
        case .document:
            VStack(alignment: .leading, spacing: 0) {
                if let imageURL {
                    RemoteImage(imageURL, placeholder: placeholderURL)
                        .frame(width: width, height: mediaHeight)
                }
                TileFooter(title: card.title.isEmpty ? (card.fileName ?? "Attachment") : card.title, symbol: "doc")
            }
        case .audio:
            WaveformView(seed: card.id)
                .frame(height: 56)
                .padding(.horizontal, 14)
        case .palette:
            if let colors = card.colors, !colors.isEmpty {
                HStack(spacing: 0) {
                    ForEach(Array(colors.prefix(12).enumerated()), id: \.offset) { _, hex in
                        Rectangle().fill(Color(hex: hex) ?? .gray)
                    }
                }
                .frame(height: 56)
            } else {
                TileText(text: card.title)
            }
        case .quote:
            VStack(spacing: 0) {
                Image(systemName: "quote.opening").font(.footnote).foregroundStyle(.tertiary).padding(.vertical, 8)
                Text(card.previewText ?? "Quote")
                    .font(.subheadline.weight(.medium))
                    .multilineTextAlignment(.center)
                    .lineLimit(4)
                    .padding(.horizontal, 14)
                Image(systemName: "quote.closing").font(.footnote).foregroundStyle(.tertiary).padding(.vertical, 8)
            }
            .frame(maxWidth: .infinity)
        case .text:
            TileText(text: card.previewText.map(MarkdownBlocks.plainText) ?? card.title)
        }
    }

    private var accessibilityText: String {
        var parts = [card.type.label, card.title]
        if card.favorited { parts.append("Favorite") }
        return parts.joined(separator: ", ")
    }
}

private struct TileText: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.subheadline.weight(.medium))
            .lineLimit(3)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(14)
    }
}

private struct TileFooter: View {
    let title: String
    var symbol: String?

    var body: some View {
        HStack(spacing: 8) {
            if let symbol { Image(systemName: symbol).font(.footnote).foregroundStyle(.secondary) }
            Text(title).font(.footnote.weight(.medium)).lineLimit(1)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
    }
}

/// The poster with a play badge; with a pointer, hovering plays a muted preview.
private struct VideoTileMedia: View {
    let card: CardSummary
    let url: URL?
    let placeholder: URL?
    @Environment(AppModel.self) private var app
    @State private var isHovering = false
    @State private var videoURL: URL?

    var body: some View {
        ZStack {
            RemoteImage(url, placeholder: placeholder)
            if isHovering, let videoURL {
                LoopingVideo(url: videoURL).transition(.opacity)
            }
            Image(systemName: "play.fill")
                .font(.footnote)
                .foregroundStyle(.white)
                .padding(10)
                .background(.black.opacity(0.45), in: .circle)
                .opacity(isHovering ? 0 : 1)
        }
        .onHover { isHovering = $0 }
        .task(id: isHovering) {
            guard isHovering, videoURL == nil else { return }
            try? await Task.sleep(for: .milliseconds(400))
            guard !Task.isCancelled, isHovering else { return }
            let full: Card? = try? await app.backend.query("cards:getCard", ["id": .string(card.id)])
            withAnimation(.easeOut(duration: 0.2)) { videoURL = SafeURL.sanitize(full?.fileUrl) }
        }
    }
}

/// A muted, looping video with no controls.
struct LoopingVideo: View {
    let url: URL
    @State private var player = AVQueuePlayer()
    @State private var looper: AVPlayerLooper?

    var body: some View {
        PlayerLayer(player: player)
            .onAppear {
                player.isMuted = true
                looper = AVPlayerLooper(player: player, templateItem: AVPlayerItem(url: url))
                player.play()
            }
            .onDisappear {
                player.pause()
                looper = nil
            }
            .accessibilityHidden(true)
    }
}

#if os(macOS)
private struct PlayerLayer: NSViewRepresentable {
    let player: AVPlayer
    func makeNSView(context: Context) -> NSView {
        let view = NSView()
        let layer = AVPlayerLayer(player: player)
        layer.videoGravity = .resizeAspectFill
        view.layer = layer
        view.wantsLayer = true
        return view
    }
    func updateNSView(_ view: NSView, context: Context) {}
}
#else
private struct PlayerLayer: UIViewRepresentable {
    let player: AVPlayer
    final class View: UIView {
        override class var layerClass: AnyClass { AVPlayerLayer.self }
    }
    func makeUIView(context: Context) -> View {
        let view = View()
        (view.layer as? AVPlayerLayer)?.player = player
        (view.layer as? AVPlayerLayer)?.videoGravity = .resizeAspectFill
        return view
    }
    func updateUIView(_ view: View, context: Context) {}
}
#endif

/// The web card's deterministic waveform, so a recording looks the same everywhere.
struct WaveformView: View {
    let seed: String
    var progress: Double?

    var body: some View {
        let heights = CardGrid.waveformHeights(seed: seed)
        GeometryReader { proxy in
            let count = Double(heights.count)
            let spacing = max(1, (proxy.size.width - count * 2) / (count - 1))
            HStack(alignment: .center, spacing: spacing) {
                ForEach(Array(heights.enumerated()), id: \.offset) { index, height in
                    Capsule()
                        .fill(progress.map { Double(index) / count < $0 } == true ? AnyShapeStyle(.tint) : AnyShapeStyle(.secondary))
                        .frame(width: 2, height: (height * proxy.size.height * 0.72).rounded())
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .accessibilityHidden(true)
    }
}

/// Grid placeholder tiles while the first page loads.
struct SkeletonGrid: View {
    let columns: Int
    let columnWidth: Double
    private let heights: [Double] = [180, 90, 140, 220, 72, 160, 110, 200]

    var body: some View {
        HStack(alignment: .top, spacing: CardGrid.gap) {
            ForEach(0..<columns, id: \.self) { column in
                VStack(spacing: CardGrid.gap) {
                    ForEach(0..<4, id: \.self) { row in
                        RoundedRectangle(cornerRadius: CardGrid.tileRadius, style: .continuous)
                            .fill(.fill.tertiary)
                            .frame(width: columnWidth, height: heights[(column * 3 + row) % heights.count])
                    }
                }
            }
        }
        .padding(.horizontal, CardGrid.edge)
        .padding(.top, 8)
        .accessibilityLabel("Loading cards")
    }
}

extension Color {
    /// `#RRGGBB` or `#RGB`.
    init?(hex: String) {
        var value = hex.trimmingCharacters(in: .whitespaces)
        if value.hasPrefix("#") { value.removeFirst() }
        if value.count == 3 { value = value.map { "\($0)\($0)" }.joined() }
        guard value.count == 6, let number = UInt32(value, radix: 16) else { return nil }
        self.init(red: Double((number >> 16) & 0xFF) / 255, green: Double((number >> 8) & 0xFF) / 255,
                  blue: Double(number & 0xFF) / 255)
    }
}
