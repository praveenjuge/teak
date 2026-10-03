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

struct LibraryCardTile: View {
    let card: LibraryCard
    let isSaving: Bool
    let onOpen: () -> Void

    var body: some View {
        tileContent
            .overlay(alignment: .topTrailing) {
                if card.isFavorited { Image(systemName: "heart.fill").foregroundStyle(.red) }
            }
            .overlay { if isSaving { ProgressView() } }
            .opacity(isSaving ? 0.7 : card.isDeleted == true ? 0.6 : 1)
            .allowsHitTesting(!isSaving)
            .contentShape(Rectangle())
            .onTapGesture(perform: onOpen)
            .accessibilityAction(named: "Open card", onOpen)
    }

    @ViewBuilder private var tileContent: some View {
        if card.cardType == .image || card.cardType == .video {
            preview.frame(maxWidth: .infinity)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        } else {
            GroupBox { preview.frame(maxWidth: .infinity).padding(12) }
        }
    }

    @ViewBuilder private var preview: some View {
        switch card.cardType {
        case .text:
            Text(card.previewText).font(.body.weight(.medium)).lineLimit(2)
                .frame(maxWidth: .infinity, alignment: .leading)
        case .quote:
            QuoteTile(text: card.previewText)
        case .link:
            if let url = card.displayImageURL {
                VStack {
                    CardImage(url: url, ratio: imageRatio)
                    Divider()
                    Text(card.linkTitle).lineLimit(1).frame(maxWidth: .infinity, alignment: .leading)
                }
            } else { Text(card.previewText.isEmpty ? card.linkTitle : card.previewText).lineLimit(1) }
        case .image:
            CardImage(url: LibraryCard.safeURL(card.compactUrl ?? card.fileUrl ?? card.thumbnailUrl), ratio: imageRatio)
        case .video:
            VideoTile(card: card, ratio: imageRatio)
        case .audio:
            WaveformTile(id: card.id)
        case .document:
            VStack {
                if let url = card.displayImageURL { CardImage(url: url, ratio: imageRatio); Divider() }
                Label(card.fileName ?? "Document", systemImage: "doc").lineLimit(1)
            }
        case .palette:
            if let colors = card.colors, !colors.isEmpty {
                HStack(spacing: 0) {
                    ForEach(Array(colors.prefix(12).enumerated()), id: \.offset) { _, color in
                        Rectangle().fill(Color(teakHex: color.hex) ?? .secondary).help(color.hex)
                    }
                }.frame(height: 120)
            } else { Text(card.content ?? "") }
        case nil: Text(card.content ?? "")
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
    var body: some View {
        GeometryReader { geometry in
            AsyncImage(url: url) { phase in
                if let image = phase.image {
                    image.resizable().aspectRatio(contentMode: .fill)
                        .frame(width: geometry.size.width, height: geometry.size.height)
                } else { Rectangle().fill(.quaternary) }
            }.clipped()
        }.aspectRatio(ratio, contentMode: .fit)
    }
}

private struct QuoteTile: View {
    let text: String
    var body: some View {
        VStack {
            Text("“").foregroundStyle(.quaternary).frame(maxWidth: .infinity, alignment: .leading)
            Text(text).italic().multilineTextAlignment(.center).lineLimit(2)
            Text("”").foregroundStyle(.quaternary).frame(maxWidth: .infinity, alignment: .trailing)
        }
    }
}

struct WaveformTile: View {
    let id: String
    private var heights: [CGFloat] {
        var seed = id.utf8.reduce(UInt64(5381)) { ($0 &* 33) &+ UInt64($1) }
        return (0..<45).map { _ in
            seed = seed &* 1664525 &+ 1013904223
            return CGFloat(10 + seed % 60)
        }
    }
    var body: some View {
        HStack(spacing: 2) {
            ForEach(Array(heights.enumerated()), id: \.offset) { _, height in
                Capsule().fill(.secondary).frame(height: height)
            }
        }.frame(height: 80)
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
            } else if let url = card.displayImageURL { CardImage(url: url, ratio: ratio) }
            else { Rectangle().fill(.black) }
            if !hovering { Image(systemName: "play.circle.fill").foregroundStyle(.white) }
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
