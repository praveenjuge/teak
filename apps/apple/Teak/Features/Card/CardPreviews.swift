import AVKit
import ImageIO
import PDFKit
import SwiftUI
import TeakCore

struct CardPreview: View {
    let card: Card
    var linkTargets: [String: CardLinkTarget] = [:]
    /// Ticks or unticks a task in a note; nil keeps its checkboxes read-only.
    var toggleTask: ((MarkdownListItem) -> Void)?
    /// Adds and removes a palette's colors; nil keeps them read-only.
    var palette: PaletteActions?

    var body: some View {
        switch card.type {
        case .image: ImagePreview(card: card)
        case .video: VideoPreview(card: card)
        case .audio: AudioPreview(card: card)
        case .document: DocumentPreview(card: card)
        case .palette: PalettePreview(card: card, actions: palette)
        case .link: LinkPreviewView(card: card)
        case .quote: QuotePreview(card: card)
        case .text:
            MarkdownView(markdown: card.content.isEmpty ? tr("native.card.noContent") : card.content, cardLinks: linkTargets,
                         toggleTask: toggleTask)
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

struct ImagePreview: View {
    let card: Card
    static let maxHeight = 440.0
    #if os(macOS)
    @Environment(\.openWindow) private var openWindow
    #else
    @State private var viewing: ImageViewerItem?
    #endif

    var body: some View {
        let urls = CardSheet.imageURLs(card)
        if urls.isEmpty {
            Unavailable(label: tr("native.card.preview.imageUnavailable"))
        } else if CardSheet.isAnimatedGIF(card), let url = SafeURL.sanitize(card.fileUrl) {
            AnimatedImage(url: url, fallback: urls)
                .aspectRatio(ratio, contentMode: .fit)
                .frame(maxHeight: Self.maxHeight)
                .clipShape(.rect(cornerRadius: 16))
        } else {
            let item = ImageViewerItem(card: card)
            Button { open(item) } label: {
                RemoteImage(urls: urls, contentMode: .fit, maxPixelSize: 2400)
                    .aspectRatio(ratio, contentMode: .fit)
                    .frame(maxHeight: Self.maxHeight)
                    .clipShape(.rect(cornerRadius: 16))
            }
            .buttonStyle(.plain)
            .accessibilityLabel(item.title)
            .accessibilityHint(tr("native.card.preview.viewFullScreen"))
            .accessibilityAddTraits(.isImage)
            #if os(iOS)
            .fullScreenCover(item: $viewing) { ImageViewer(item: $0) }
            #endif
        }
    }

    /// Full screen on iPhone and iPad; its own zoomable window on Mac.
    private func open(_ item: ImageViewerItem) {
        #if os(macOS)
        openWindow(id: ImageWindow.id, value: item)
        #else
        viewing = item
        #endif
    }

    private var ratio: Double {
        guard let width = card.fileMetadata?.width, let height = card.fileMetadata?.height, width > 0, height > 0 else {
            return 4.0 / 3.0
        }
        return width / height
    }
}

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
        guard let data = try? await ImagePipeline.shared.data(for: url) else { return failed = true }
        let frames = await Task.detached(priority: .userInitiated) { Self.frames(data) }.value
        guard !frames.isEmpty else { return failed = true }
        if reduceMotion || frames.count == 1 { return frame = frames[0].0 }
        var index = 0
        while !Task.isCancelled {
            frame = frames[index].0
            try? await Task.sleep(for: .seconds(frames[index].1))
            index = (index + 1) % frames.count
        }
    }

    /// Every frame decoded once at up to 1,200 pixels, off the main thread: a full-size animation can be
    /// hundreds of megabytes otherwise.
    nonisolated private static func frames(_ data: Data) -> [(CGImage, Double)] {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil) else { return [] }
        let options = [kCGImageSourceCreateThumbnailFromImageAlways: true,
                       kCGImageSourceCreateThumbnailWithTransform: true,
                       kCGImageSourceShouldCacheImmediately: true,
                       kCGImageSourceThumbnailMaxPixelSize: 1200] as CFDictionary
        return (0..<CGImageSourceGetCount(source)).compactMap { index in
            guard let image = CGImageSourceCreateThumbnailAtIndex(source, index, options) else { return nil }
            let properties = CGImageSourceCopyPropertiesAtIndex(source, index, nil) as? [CFString: Any]
            let gif = properties?[kCGImagePropertyGIFDictionary] as? [CFString: Any]
            let delay = (gif?[kCGImagePropertyGIFUnclampedDelayTime] as? Double)
                ?? (gif?[kCGImagePropertyGIFDelayTime] as? Double) ?? 0.1
            return (image, max(delay, 0.02))
        }
    }
}

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
                    // One player for the card, started from its controls: opening or returning to a card
                    // doesn't cut off other audio or restart the video.
                    .onAppear {
                        guard player == nil else { return }
                        #if os(iOS)
                        try? AVAudioSession.sharedInstance().setCategory(.playback)
                        #endif
                        player = AVPlayer(url: url)
                    }
                    .onDisappear { player?.pause() }
            } else if let poster = SafeURL.sanitize(card.thumbnailUrl) {
                RemoteImage(poster, contentMode: .fit)
                    .aspectRatio(ratio, contentMode: .fit)
                    .clipShape(.rect(cornerRadius: 16))
            } else {
                Unavailable(label: tr("native.card.preview.videoUnavailable"), symbol: "play.rectangle")
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

    /// Pauses and lets other apps' audio carry on. Playing again starts a fresh player from where it was.
    func stop() {
        player?.pause()
        isPlaying = false
        release()
        #if os(iOS)
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        #endif
    }

    isolated deinit { release() }

    private func release() {
        if let observer { player?.removeTimeObserver(observer) }
        if let endObserver { NotificationCenter.default.removeObserver(endObserver) }
        observer = nil
        endObserver = nil
        player = nil
    }

    /// Moves to `fraction` of the recording, playing or not, as the web's seek bar does.
    func seek(to fraction: Double, url: URL) {
        guard duration > 0 else { return }
        if player == nil { prepare(url) }
        let seconds = min(max(fraction, 0), 1) * duration
        elapsed = seconds
        progress = seconds / duration
        player?.seek(to: CMTime(seconds: seconds, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero)
    }

    private func prepare(_ url: URL) {
        let item = AVPlayerItem(url: url)
        let player = AVPlayer(playerItem: item)
        self.player = player
        if elapsed > 0, progress < 1 { player.seek(to: CMTime(seconds: elapsed, preferredTimescale: 600)) }
        observer = player.addPeriodicTimeObserver(forInterval: CMTime(seconds: 0.1, preferredTimescale: 600),
                                                  queue: .main) { [weak self, weak player] time in
            MainActor.assumeIsolated {
                guard let self, let player else { return }
                if let total = player.currentItem?.duration.seconds, total.isFinite, total > 0 { self.duration = total }
                self.elapsed = time.seconds
                self.progress = self.duration > 0 ? min(1, time.seconds / self.duration) : 0
                if player.currentItem?.status == .failed { self.failed = true; self.isPlaying = false }
            }
        }
        endObserver = NotificationCenter.default.addObserver(forName: AVPlayerItem.didPlayToEndTimeNotification,
                                                             object: item, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self else { return }
                self.isPlaying = false
                self.progress = 1
                self.elapsed = self.duration
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
                .accessibilityLabel(playback.isPlaying ? tr("native.card.preview.pause") : tr("native.card.preview.play"))
                SeekBar(seed: card.id, playback: playback, url: url)
                    .frame(height: 56)
                Text(timeLabel)
                    .font(.footnote.monospacedDigit())
                    .foregroundStyle(.secondary)
            }
            .padding(16)
            .background(.fill.quaternary, in: .rect(cornerRadius: 20))
            .onDisappear { playback.stop() }
        } else {
            Unavailable(label: tr("native.card.preview.audioUnavailable"), symbol: "waveform")
        }
    }

    private var unplayableLabel: String {
        #if os(macOS)
        tr("apple.card.audioUnplayableMac")
        #else
        tr("apple.card.audioUnplayableIPhone")
        #endif
    }

    /// The length before playing, then where it is out of the length, like the web.
    private var timeLabel: String {
        let started = playback.isPlaying || playback.elapsed > 0
        guard playback.duration > 0 else { return started ? CardSheet.formatDuration(playback.elapsed) : "" }
        return started
            ? "\(CardSheet.formatDuration(playback.elapsed)) / \(CardSheet.formatDuration(playback.duration))"
            : CardSheet.formatDuration(playback.duration)
    }
}

/// The waveform as a seek bar: tap or drag to move through the recording. VoiceOver adjusts it in steps.
private struct SeekBar: View {
    let seed: String
    let playback: AudioPlayback
    let url: URL
    /// Where a drag is, shown until it lets go and seeks there.
    @State private var scrub: Double?

    var body: some View {
        GeometryReader { proxy in
            WaveformView(seed: seed, progress: scrub ?? playback.progress)
                .contentShape(.rect)
                .gesture(
                    DragGesture(minimumDistance: 0)
                        .onChanged { scrub = fraction($0.location.x, width: proxy.size.width) }
                        .onEnded {
                            playback.seek(to: fraction($0.location.x, width: proxy.size.width), url: url)
                            scrub = nil
                        },
                    isEnabled: playback.duration > 0
                )
        }
        .accessibilityElement()
        .accessibilityLabel(tr("native.media.seek"))
        .accessibilityValue(tr("native.media.seekPosition", CardSheet.formatDuration(playback.elapsed),
                               CardSheet.formatDuration(playback.duration)))
        .accessibilityAdjustableAction { direction in
            // Five seconds, or a tenth of a recording shorter than 50 seconds.
            let step = playback.duration > 0 ? min(5, playback.duration / 10) / playback.duration : 0
            switch direction {
            case .increment: playback.seek(to: playback.progress + step, url: url)
            case .decrement: playback.seek(to: playback.progress - step, url: url)
            @unknown default: break
            }
        }
    }

    private func fraction(_ x: Double, width: Double) -> Double { width > 0 ? min(max(x / width, 0), 1) : 0 }
}

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
                    Text(card.fileMetadata?.fileName ?? card.metadataTitle ?? tr("native.card.preview.attachment")).font(.headline)
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
                Button(tr("native.card.preview.viewDocument"), systemImage: "doc.viewfinder") { openURL(url) }
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

/// Saves a palette's color edits. Each returns whether the save went through.
struct PaletteActions {
    let add: @MainActor (String) async -> Bool
    let remove: @MainActor (String) async -> Bool
}

struct PalettePreview: View {
    let card: Card
    var actions: PaletteActions?
    #if os(iOS)
    @Environment(\.horizontalSizeClass) private var sizeClass
    #endif
    @State private var feedback = 0
    @State private var adding = false

    var body: some View {
        let colors = card.colors ?? []
        let canAdd = actions != nil && PaletteEdit.canAdd(card)
        if colors.isEmpty && !canAdd {
            Unavailable(label: tr("native.card.preview.noColors"), symbol: "paintpalette")
        } else {
            let canRemove = actions != nil && PaletteEdit.canRemove(card)
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 110), spacing: 12)], spacing: 16) {
                ForEach(Array(colors.enumerated()), id: \.offset) { _, color in
                    swatch(color, canRemove: canRemove)
                }
                if canAdd { addTile }
            }
            .sensoryFeedback(.success, trigger: feedback)
        }
    }

    private func swatch(_ color: CardColor, canRemove: Bool) -> some View {
        // The server takes `#RRGGBB`; a color saved with alpha is removed by its RGB.
        let hex = PaletteEdit.storedHex(color.hex)
        return Button {
            Pasteboard.copy(color.hex)
            feedback += 1
        } label: {
            VStack(spacing: 6) {
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .fill(Color(hex: color.hex) ?? .gray)
                    .aspectRatio(1, contentMode: .fit)
                    .overlay { RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(.separator) }
                Text(color.hex.uppercased()).font(.caption.monospaced()).foregroundStyle(.secondary)
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel(tr("native.card.copyColor", color.name ?? color.hex))
        .contextMenu {
            if canRemove, let hex {
                Button(tr("native.card.palette.removeColor"), systemImage: "trash", role: .destructive) { remove(hex) }
            }
        }
        .accessibilityActions {
            if canRemove, let hex {
                Button(tr("native.card.palette.remove", hex)) { remove(hex) }
            }
        }
    }

    private var addTile: some View {
        Button { adding = true } label: {
            VStack(spacing: 6) {
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .strokeBorder(.secondary, style: StrokeStyle(lineWidth: 1.5, dash: [6, 4]))
                    .aspectRatio(1, contentMode: .fit)
                    .overlay { Image(systemName: "plus").font(.title2.weight(.medium)).foregroundStyle(.secondary) }
                    .contentShape(.rect(cornerRadius: 16))
                Text(tr("native.card.palette.addColor")).font(.caption).foregroundStyle(.secondary).lineLimit(1)
            }
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(tr("native.card.palette.addColor"))
        .accessibilityAddTraits(.isButton)
        .accessibilityIdentifier("palette.addColor")
        .popover(isPresented: $adding) {
            AddColorSheet(card: card, fillsSheet: isCompact) { hex in
                guard let actions, await actions.add(hex) else { return false }
                feedback += 1
                return true
            }
            .presentationDetents([.medium, .large])
            .presentationCompactAdaptation(.sheet)
        }
    }

    /// A compact width shows the popover as a sheet.
    private var isCompact: Bool {
        #if os(iOS)
        sizeClass == .compact
        #else
        false
        #endif
    }

    private func remove(_ hex: String) {
        guard let actions else { return }
        Task { if await actions.remove(hex) { feedback += 1 } }
    }
}

/// Add color: a color picker and a hex field that follow each other, with a preview of the color to add.
private struct AddColorSheet: View {
    let card: Card
    /// As a sheet, the form starts at the top rather than floating in the middle.
    let fillsSheet: Bool
    let add: (String) async -> Bool
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @State private var picked = CGColor(srgbRed: 0.5, green: 0.5, blue: 0.5, alpha: 1)
    @State private var isSaving = false
    @State private var failed = false

    var body: some View {
        let hex = PaletteEdit.normalizedHex(text)
        VStack(alignment: .leading, spacing: 16) {
            Text(tr("native.card.palette.addColor")).font(.headline)
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(hex.flatMap { Color(hex: $0) } ?? Color.clear)
                .background(.fill.tertiary, in: .rect(cornerRadius: 16, style: .continuous))
                .overlay { RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(.separator) }
                .frame(height: 64)
                .accessibilityHidden(true)
            ColorPicker(tr("native.card.palette.pickColor"), selection: $picked, supportsOpacity: false)
            VStack(alignment: .leading, spacing: 6) {
                Text(tr("native.card.palette.hexCode")).font(.subheadline).foregroundStyle(.secondary)
                    .accessibilityHidden(true)
                TextField(tr("native.card.palette.hexCode"), text: $text, prompt: Text(verbatim: "#FF5500"))
                    .font(.body.monospaced())
                    .textFieldStyle(.roundedBorder)
                    .autocorrectionDisabled()
                    #if os(iOS)
                    .textInputAutocapitalization(.characters)
                    #endif
                    .onSubmit(submit)
                    .accessibilityLabel(tr("native.card.palette.hexCode"))
                    .accessibilityIdentifier("palette.hex")
                if let problem = problem(hex) {
                    Text(problem).font(.footnote).foregroundStyle(.red)
                }
            }
            HStack {
                #if os(iOS)
                Button(tr("common.cancel")) { dismiss() }
                    .buttonStyle(.glass)
                #endif
                Spacer()
                Button(tr("native.card.palette.add"), action: submit)
                    .buttonStyle(.glassProminent)
                    .disabled(!canAdd(hex))
                    .keyboardShortcut(.defaultAction)
                    .accessibilityIdentifier("palette.add")
            }
        }
        .padding(20)
        .frame(minWidth: 300, idealWidth: 340)
        .frame(maxHeight: fillsSheet ? .infinity : nil, alignment: .top)
        .onChange(of: text) { _, typed in
            // A complete hex code moves the picker; anything else leaves it where it is.
            guard let typedHex = PaletteEdit.normalizedHex(typed), typedHex != Self.hex(picked),
                  let color = Self.color(typedHex) else { return }
            picked = color
            failed = false
        }
        .onChange(of: picked) { _, color in
            guard let pickedHex = Self.hex(color), pickedHex != PaletteEdit.normalizedHex(text) else { return }
            text = pickedHex
            failed = false
        }
    }

    private func canAdd(_ hex: String?) -> Bool {
        guard let hex else { return false }
        return !isSaving && !PaletteEdit.contains(card, hex)
    }

    /// Why Add is off: not a hex code, or already in the palette. Nothing while the field is empty.
    private func problem(_ hex: String?) -> String? {
        if text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return nil }
        guard let hex else { return tr("native.card.palette.invalidHex") }
        if PaletteEdit.contains(card, hex) { return tr("native.card.palette.alreadyAdded", hex) }
        return failed ? tr("native.card.palette.saveFailed") : nil
    }

    private func submit() {
        guard let hex = PaletteEdit.normalizedHex(text), canAdd(hex) else { return }
        isSaving = true
        failed = false
        Task {
            defer { isSaving = false }
            if await add(hex) { dismiss() } else { failed = true }
        }
    }

    /// The picked color as `#RRGGBB` in sRGB, clamping wide-gamut picks to the nearest sRGB color.
    private static func hex(_ color: CGColor) -> String? {
        guard let srgb = CGColorSpace(name: CGColorSpace.sRGB),
              let components = color.converted(to: srgb, intent: .defaultIntent, options: nil)?.components,
              components.count >= 3 else { return nil }
        let channels = components.prefix(3).map { Int((min(max($0, 0), 1) * 255).rounded()) }
        return String(format: "#%02X%02X%02X", channels[0], channels[1], channels[2])
    }

    private static func color(_ hex: String) -> CGColor? {
        guard let number = UInt32(hex.dropFirst(), radix: 16) else { return nil }
        return CGColor(srgbRed: Double((number >> 16) & 0xFF) / 255, green: Double((number >> 8) & 0xFF) / 255,
                       blue: Double(number & 0xFF) / 255, alpha: 1)
    }
}

struct LinkPreviewView: View {
    let card: Card
    @Environment(\.openURL) private var openURL

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let image = CardSheet.linkImageURL(card) {
                let hero = RemoteImage(image, contentMode: .fill)
                    .aspectRatio(1.91, contentMode: .fit)
                    .clipShape(.rect(cornerRadius: 16))
                if let url = SafeURL.sanitize(card.url) {
                    Button { openURL(url) } label: { hero }
                        .buttonStyle(.plain)
                        .accessibilityLabel(tr("native.actions.openLink"))
                } else {
                    hero.accessibilityHidden(true)
                }
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

struct QuotePreview: View {
    let card: Card

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: "quote.opening").font(.title3).foregroundStyle(.tertiary).accessibilityHidden(true)
            Text(card.content.isEmpty ? tr("native.card.noContent") : card.content)
                .font(.title2.weight(.medium))
                .multilineTextAlignment(.center)
                .textSelection(.enabled)
            Image(systemName: "quote.closing").font(.title3).foregroundStyle(.tertiary).accessibilityHidden(true)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 24)
    }
}
