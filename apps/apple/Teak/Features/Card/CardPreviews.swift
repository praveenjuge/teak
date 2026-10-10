import AVKit
import ImageIO
import PDFKit
import SwiftUI
import TeakCore

/// The hero for a card: its media or content, per type.
struct CardPreview: View {
    let card: Card

    var body: some View {
        switch card.type {
        case .image: ImagePreview(card: card)
        case .video: VideoPreview(card: card)
        case .audio: AudioPreview(card: card)
        case .document: DocumentPreview(card: card)
        case .palette: PalettePreview(card: card)
        case .link: LinkPreviewView(card: card)
        case .quote: QuotePreview(card: card)
        case .text: MarkdownView(markdown: card.content.isEmpty ? "No content" : card.content)
        }
    }
}

private struct Unavailable: View {
    let label: String
    var symbol = "photo"

    var body: some View {
        Label(label, systemImage: symbol)
            .font(.subheadline)
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, minHeight: 160)
            .background(.fill.tertiary, in: .rect(cornerRadius: 16))
    }
}

// MARK: Image

struct ImagePreview: View {
    let card: Card
    static let maxHeight = 440.0

    var body: some View {
        let urls = CardSheet.imageURLs(card)
        if urls.isEmpty {
            Unavailable(label: "Image unavailable")
        } else if CardSheet.isAnimatedGIF(card), let url = SafeURL.sanitize(card.fileUrl) {
            AnimatedImage(url: url, fallback: urls)
                .aspectRatio(ratio, contentMode: .fit)
                .frame(maxHeight: Self.maxHeight)
                .clipShape(.rect(cornerRadius: 16))
        } else {
            RemoteImage(urls: urls, contentMode: .fit, maxPixelSize: 2400)
                .aspectRatio(ratio, contentMode: .fit)
                .frame(maxHeight: Self.maxHeight)
                .clipShape(.rect(cornerRadius: 16))
                .accessibilityLabel(card.metadataTitle ?? card.fileMetadata?.fileName ?? "Image")
        }
    }

    private var ratio: Double {
        guard let width = card.fileMetadata?.width, let height = card.fileMetadata?.height, width > 0, height > 0 else {
            return 4.0 / 3.0
        }
        return width / height
    }
}

/// Plays a GIF's frames with ImageIO.
struct AnimatedImage: View {
    let url: URL
    let fallback: [URL]
    @State private var frame: CGImage?
    @State private var failed = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Group {
            if let frame {
                Image(decorative: frame, scale: 1).resizable()
            } else if failed {
                RemoteImage(urls: fallback, contentMode: .fit)
            } else {
                Rectangle().fill(.fill.tertiary)
            }
        }
        .task(id: url) { await animate() }
    }

    private func animate() async {
        guard let data = try? await ImagePipeline.shared.data(for: url),
              let source = CGImageSourceCreateWithData(data as CFData, nil)
        else { return failed = true }
        let count = CGImageSourceGetCount(source)
        guard count > 0 else { return failed = true }
        let frames: [(CGImage, Double)] = (0..<count).compactMap { index in
            guard let image = CGImageSourceCreateImageAtIndex(source, index, nil) else { return nil }
            let properties = CGImageSourceCopyPropertiesAtIndex(source, index, nil) as? [CFString: Any]
            let gif = properties?[kCGImagePropertyGIFDictionary] as? [CFString: Any]
            let delay = (gif?[kCGImagePropertyGIFUnclampedDelayTime] as? Double)
                ?? (gif?[kCGImagePropertyGIFDelayTime] as? Double) ?? 0.1
            return (image, max(delay, 0.02))
        }
        guard !frames.isEmpty else { return failed = true }
        if reduceMotion || frames.count == 1 { return frame = frames[0].0 }
        var index = 0
        while !Task.isCancelled {
            frame = frames[index].0
            try? await Task.sleep(for: .seconds(frames[index].1))
            index = (index + 1) % frames.count
        }
    }
}

// MARK: Video

struct VideoPreview: View {
    let card: Card
    @State private var player: AVPlayer?

    var body: some View {
        Group {
            if let url = SafeURL.sanitize(card.fileUrl) {
                VideoPlayer(player: player)
                    .aspectRatio(ratio, contentMode: .fit)
                    .frame(maxHeight: 520)
                    .clipShape(.rect(cornerRadius: 16))
                    .onAppear {
                        #if os(iOS)
                        try? AVAudioSession.sharedInstance().setCategory(.playback)
                        #endif
                        let player = AVPlayer(url: url)
                        self.player = player
                        player.play()
                    }
                    .onDisappear { player?.pause() }
            } else if let poster = SafeURL.sanitize(card.thumbnailUrl) {
                RemoteImage(poster, contentMode: .fit)
                    .aspectRatio(ratio, contentMode: .fit)
                    .clipShape(.rect(cornerRadius: 16))
            } else {
                Unavailable(label: "Video preview unavailable", symbol: "play.rectangle")
            }
        }
    }

    private var ratio: Double {
        guard let width = card.fileMetadata?.width, let height = card.fileMetadata?.height, width > 0, height > 0 else {
            return 16.0 / 9.0
        }
        return width / height
    }
}

// MARK: Audio

@MainActor @Observable
final class AudioPlayback {
    private(set) var isPlaying = false
    private(set) var progress = 0.0
    private(set) var elapsed = 0.0
    private(set) var duration: Double
    private(set) var failed = false
    @ObservationIgnored private var player: AVPlayer?
    @ObservationIgnored private var observer: Any?
    @ObservationIgnored private var endObserver: (any NSObjectProtocol)?

    init(duration: Double?) { self.duration = duration ?? 0 }

    func toggle(url: URL) {
        if player == nil { prepare(url) }
        guard let player else { return }
        if isPlaying {
            player.pause()
        } else {
            #if os(iOS)
            // Plays even when the ring switch is on silent.
            try? AVAudioSession.sharedInstance().setCategory(.playback)
            try? AVAudioSession.sharedInstance().setActive(true)
            #endif
            if progress >= 1 { player.seek(to: .zero) }
            player.play()
        }
        isPlaying.toggle()
    }

    func stop() {
        player?.pause()
        isPlaying = false
    }

    private func prepare(_ url: URL) {
        let item = AVPlayerItem(url: url)
        let player = AVPlayer(playerItem: item)
        self.player = player
        observer = player.addPeriodicTimeObserver(forInterval: CMTime(seconds: 0.1, preferredTimescale: 600),
                                                  queue: .main) { [weak self] time in
            MainActor.assumeIsolated {
                guard let self else { return }
                if let total = player.currentItem?.duration.seconds, total.isFinite, total > 0 { self.duration = total }
                self.elapsed = time.seconds
                self.progress = self.duration > 0 ? min(1, time.seconds / self.duration) : 0
                if player.currentItem?.status == .failed { self.failed = true; self.isPlaying = false }
            }
        }
        endObserver = NotificationCenter.default.addObserver(forName: AVPlayerItem.didPlayToEndTimeNotification,
                                                             object: item, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated {
                self?.isPlaying = false
                self?.progress = 1
            }
        }
    }
}

struct AudioPreview: View {
    let card: Card
    @State private var playback: AudioPlayback

    init(card: Card) {
        self.card = card
        _playback = State(initialValue: AudioPlayback(duration: card.fileMetadata?.duration))
    }

    var body: some View {
        if CardSheet.isUnplayableAudio(card) {
            Unavailable(label: unplayableLabel, symbol: "waveform")
        } else if let url = SafeURL.sanitize(card.fileUrl), !playback.failed {
            HStack(spacing: 14) {
                Button {
                    playback.toggle(url: url)
                } label: {
                    Image(systemName: playback.isPlaying ? "pause.fill" : "play.fill")
                        .font(.title2)
                        .frame(width: 52, height: 52)
                        .contentTransition(.symbolEffect(.replace))
                }
                .buttonStyle(.glassProminent)
                .buttonBorderShape(.circle)
                .accessibilityLabel(playback.isPlaying ? "Pause" : "Play")
                WaveformView(seed: card.id, progress: playback.progress)
                    .frame(height: 56)
                Text(timeLabel)
                    .font(.footnote.monospacedDigit())
                    .foregroundStyle(.secondary)
            }
            .padding(16)
            .background(.fill.quaternary, in: .rect(cornerRadius: 20))
            .onDisappear { playback.stop() }
        } else {
            Unavailable(label: "Audio unavailable", symbol: "waveform")
        }
    }

    private var unplayableLabel: String {
        #if os(macOS)
        "This recording format can't play on Mac"
        #else
        "This recording format can't play on iPhone"
        #endif
    }

    private var timeLabel: String {
        let shown = playback.isPlaying || playback.elapsed > 0 ? playback.elapsed : playback.duration
        return CardSheet.formatDuration(shown)
    }
}

// MARK: Document

struct DocumentPreview: View {
    let card: Card
    @Environment(\.openURL) private var openURL
    @State private var text: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            if CardSheet.isPDF(card), let url = SafeURL.sanitize(card.fileUrl) {
                PDFPreview(url: url)
                    .frame(height: 520)
                    .clipShape(.rect(cornerRadius: 16))
            } else if let thumbnail = SafeURL.sanitize(card.thumbnailUrl ?? card.compactUrl) {
                RemoteImage(thumbnail, contentMode: .fit)
                    .aspectRatio(3.0 / 4.0, contentMode: .fit)
                    .frame(maxHeight: 440)
                    .clipShape(.rect(cornerRadius: 16))
            }
            HStack(spacing: 10) {
                Image(systemName: "doc.text").font(.title2).foregroundStyle(.secondary)
                VStack(alignment: .leading, spacing: 2) {
                    Text(card.fileMetadata?.fileName ?? card.metadataTitle ?? "Attachment").font(.headline)
                    if let summary = CardSheet.documentSummary(card) {
                        Text(summary).font(.subheadline).foregroundStyle(.secondary)
                    }
                }
            }
            if let text {
                switch CardSheet.textPreviewKind(card) {
                case .markdown: MarkdownView(markdown: text, baseFont: .callout)
                case .code:
                    ScrollView(.horizontal) {
                        Text(text).font(.system(.footnote, design: .monospaced)).textSelection(.enabled).padding(12)
                    }
                    .background(.fill.tertiary, in: .rect(cornerRadius: 12))
                case nil: EmptyView()
                }
            }
            if let url = SafeURL.sanitize(card.fileUrl) {
                Button("View Document", systemImage: "doc.viewfinder") { openURL(url) }
                    .buttonStyle(.glass)
            }
        }
        .task(id: card.fileUrl) { await loadText() }
    }

    private func loadText() async {
        guard CardSheet.textPreviewKind(card) != nil, let url = SafeURL.sanitize(card.fileUrl),
              let data = try? await ImagePipeline.shared.data(for: url), data.count <= CardSheet.textPreviewLimit
        else { return }
        text = String(data: data, encoding: .utf8)
    }
}

#if os(macOS)
struct PDFPreview: NSViewRepresentable {
    let url: URL
    func makeNSView(context: Context) -> PDFView { configured(PDFView()) }
    func updateNSView(_ view: PDFView, context: Context) {}
}
#else
struct PDFPreview: UIViewRepresentable {
    let url: URL
    func makeUIView(context: Context) -> PDFView { configured(PDFView()) }
    func updateUIView(_ view: PDFView, context: Context) {}
}
#endif

extension PDFPreview {
    func configured(_ view: PDFView) -> PDFView {
        view.autoScales = true
        view.displayMode = .singlePageContinuous
        Task {
            if let data = try? await ImagePipeline.shared.data(for: url) { view.document = PDFDocument(data: data) }
        }
        return view
    }
}

// MARK: Palette

struct PalettePreview: View {
    let card: Card
    @State private var copied = 0

    var body: some View {
        let colors = card.colors ?? []
        if colors.isEmpty {
            Unavailable(label: "No colors saved", symbol: "paintpalette")
        } else {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 96), spacing: 12)], spacing: 12) {
                ForEach(Array(colors.enumerated()), id: \.offset) { _, color in
                    Button {
                        Pasteboard.copy(color.hex)
                        copied += 1
                    } label: {
                        VStack(spacing: 6) {
                            RoundedRectangle(cornerRadius: 14, style: .continuous)
                                .fill(Color(hex: color.hex) ?? .gray)
                                .frame(height: 72)
                                .overlay { RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(.separator) }
                            Text(color.hex.uppercased()).font(.caption.monospaced()).foregroundStyle(.secondary)
                        }
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Copy \(color.name ?? color.hex)")
                }
            }
            .sensoryFeedback(.success, trigger: copied)
        }
    }
}

// MARK: Link

struct LinkPreviewView: View {
    let card: Card
    @Environment(\.openURL) private var openURL

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let image = CardSheet.linkImageURL(card) {
                RemoteImage(image, contentMode: .fill)
                    .aspectRatio(1.91, contentMode: .fit)
                    .clipShape(.rect(cornerRadius: 16))
                    .onTapGesture { if let url = SafeURL.sanitize(card.url) { openURL(url) } }
            }
            HStack(spacing: 8) {
                if let favicon = SafeURL.sanitize(card.metadata?.linkPreview?.faviconUrl) {
                    RemoteImage(favicon, contentMode: .fit).frame(width: 16, height: 16).clipShape(.rect(cornerRadius: 3))
                }
                if let host = SafeURL.hostname(card.url) {
                    Text(host).font(.subheadline).foregroundStyle(.secondary)
                }
            }
            Text(CardSheet.linkTitle(card)).font(.title3.weight(.semibold)).textSelection(.enabled)
            if let description = CardSheet.linkDescription(card) {
                Text(description).font(.body).foregroundStyle(.secondary).textSelection(.enabled)
            }
        }
    }
}

// MARK: Quote

struct QuotePreview: View {
    let card: Card

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: "quote.opening").font(.title3).foregroundStyle(.tertiary)
            Text(card.content.isEmpty ? "No content" : card.content)
                .font(.title2.weight(.medium))
                .multilineTextAlignment(.center)
                .textSelection(.enabled)
            Image(systemName: "quote.closing").font(.title3).foregroundStyle(.tertiary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 24)
    }
}
