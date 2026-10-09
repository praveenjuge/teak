import AppKit
import AVFoundation
import AVKit
import Combine
import SwiftUI

/// Card detail previews that mirror the web modal (packages/ui card-previews):
/// side-by-side palette swatches, a centered quote, a large link preview,
/// and an audio player that shares the grid card's waveform.

struct PaletteDetailPreview: View {
    let colors: [LibraryColor]
    let availableWidth: CGFloat
    var availableHeight: CGFloat = .infinity
    let onCopy: (String) -> Void

    var body: some View {
        let width = min(availableWidth, 768)
        // Swatches wrap onto new rows once a hex label no longer fits.
        let perRow = max(1, min(colors.count, Int(width / 112)))
        let rows = stride(from: 0, to: colors.count, by: perRow).map { Array(colors[$0..<min($0 + perRow, colors.count)]) }
        // Tall rows like the web, shortened so large palettes still fit the pane.
        let rowHeight = min(224, max(128, availableHeight / CGFloat(rows.count)))
        VStack(spacing: 0) {
            ForEach(rows.indices, id: \.self) { row in
                HStack(spacing: 0) {
                    ForEach(Array(rows[row].enumerated()), id: \.offset) { _, color in swatch(color) }
                }
                .frame(height: rowHeight)
            }
        }
        .frame(width: width)
        .teakCardSurface()
    }

    private func swatch(_ color: LibraryColor) -> some View {
        Button { onCopy(color.hex) } label: {
            Rectangle()
                .fill(Color(teakHex: color.hex) ?? .secondary)
                .overlay(alignment: .bottom) {
                    Text(color.hex.uppercased())
                        .font(.callout.weight(.medium))
                        .monospacedDigit()
                        .padding(.horizontal, 12)
                        .frame(height: 28)
                        .glassEffect(.regular, in: .capsule)
                        .padding(.bottom, 16)
                }
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help("Copy \(color.hex)")
        .accessibilityLabel("Copy \(color.hex)\(color.name.map { ", \($0)" } ?? "")")
    }
}

struct QuoteDetailPreview: View {
    @Binding var text: String
    let isEditable: Bool
    let availableWidth: CGFloat
    @State private var lineWidth: CGFloat = 200
    @State private var textHeight: CGFloat = 40

    private var display: String { text.isEmpty ? "Enter your quote..." : text }

    /// Hug short quotes, wrap long ones at 560pt or the pane width.
    private var editorWidth: CGFloat {
        min(max(lineWidth + 16, 160), 560, max(availableWidth - 64, 160))
    }

    var body: some View {
        TextEditor(text: $text)
            .scrollContentBackground(.hidden)
            .scrollDisabled(true)
            .disabled(!isEditable)
            .overlay {
                if text.isEmpty {
                    Text("Enter your quote...").foregroundStyle(.tertiary).allowsHitTesting(false)
                }
            }
            .frame(width: editorWidth, height: textHeight + 8)
            // Hidden copies measure the text without affecting layout.
            .background {
                Text(display)
                    .fixedSize()
                    .hidden()
                    .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { lineWidth = $0 }
                Text(display)
                    .frame(width: editorWidth - 16)
                    .fixedSize(horizontal: false, vertical: true)
                    .hidden()
                    .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { textHeight = $0 }
            }
            .font(.title2.weight(.medium))
            .italic()
            .multilineTextAlignment(.center)
            .overlay(alignment: .topLeading) { QuoteMark("\u{201C}", size: 64).offset(x: -24, y: -34) }
            .overlay(alignment: .bottomTrailing) { QuoteMark("\u{201D}", size: 64).offset(x: 24, y: 44) }
            .padding(.vertical, 48)
    }
}

struct LinkDetailPreview: View {
    let card: LibraryCard
    @State private var hovering = false

    var body: some View {
        VStack(alignment: .leading, spacing: 24) {
            Button {
                if let url = LibraryCard.safeURL(card.url) { NSWorkspace.shared.open(url) }
            } label: { summary }
            .buttonStyle(.plain)
            .onHover { hovering = $0 }
            .pointerStyle(.link)
            .help(card.url ?? "")

            if let facts = card.linkFacts, !facts.isEmpty {
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 4), spacing: 8) {
                    ForEach(Array(facts.enumerated()), id: \.offset) { _, fact in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(fact.label.uppercased())
                                .font(.caption.weight(.medium))
                                .tracking(0.4)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                            Text(Self.formatFact(fact.value))
                                .font(.callout.weight(.semibold))
                                .textSelection(.enabled)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                        .teakCardSurface(cornerRadius: 12)
                    }
                }
            }

            if let media = card.linkPreviewMedia {
                ForEach(Array(media.enumerated()), id: \.offset) { _, item in
                    if let url = LibraryCard.safeURL(item.url) {
                        if item.type == "video" {
                            NativePlayer(url: url)
                                .frame(height: 320)
                                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                        } else if item.type == "image" {
                            RemoteImage(urls: [url], maxHeight: 520)
                        }
                    }
                }
            }
        }
        .frame(maxWidth: 672)
    }

    private var summary: some View {
        VStack(alignment: .leading, spacing: 16) {
            RemoteImage(urls: [card.displayImageURL, LibraryCard.safeURL(card.screenshotUrl)].compactMap { $0 }, maxHeight: 340)
            VStack(alignment: .leading, spacing: 6) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(card.linkTitle)
                        .font(.title3.weight(.semibold))
                        .underline(hovering)
                        .multilineTextAlignment(.leading)
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 0)
                    Image(systemName: "arrow.up.right").foregroundStyle(.secondary)
                }
                if let host = LibraryCard.safeURL(card.url)?.host() {
                    HStack(spacing: 8) {
                        if let favicon = LibraryCard.safeURL(card.linkFaviconUrl) {
                            AsyncImage(url: favicon) { image in image.resizable().scaledToFit() }
                                placeholder: { EmptyView() }
                                .frame(width: 16, height: 16)
                        }
                        Text(host.hasPrefix("www.") ? String(host.dropFirst(4)) : host)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                    .font(.callout)
                }
                if let description = card.linkPreviewDescription ?? card.metadataDescription, !description.isEmpty {
                    Text(description)
                        .font(.callout)
                        .foregroundStyle(.secondary)
                        .lineLimit(3)
                        .padding(.top, 4)
                }
            }
            .padding(.horizontal, 4)
        }
        .contentShape(Rectangle())
    }

    /// Long whole numbers (review counts) get separators; years stay as they are.
    static func formatFact(_ value: String) -> String {
        let trimmed = value.trimmingCharacters(in: .whitespaces)
        guard trimmed.count >= 5, trimmed.allSatisfy(\.isNumber), let number = Int(trimmed) else { return value }
        return number.formatted(.number)
    }
}

/// Loads an image without upscaling it past its natural size, falling back to
/// the next URL (for example the page screenshot) and then to nothing.
struct RemoteImage: View {
    let urls: [URL]
    var maxHeight: CGFloat
    /// Show the system "Preview unavailable" state when every URL fails.
    var showsUnavailable = false
    @State private var image: NSImage?
    @State private var attempted = false

    var body: some View {
        Group {
            if let image {
                Image(nsImage: image)
                    .resizable()
                    .aspectRatio(image.size, contentMode: .fit)
                    .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                    .overlay { RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(.separator) }
                    .frame(maxWidth: image.size.width, maxHeight: min(image.size.height, maxHeight))
            } else if !attempted && !urls.isEmpty {
                RoundedRectangle(cornerRadius: 16, style: .continuous).fill(.quinary)
                    .frame(height: min(240, maxHeight))
            } else if showsUnavailable {
                ContentUnavailableView("Preview unavailable", systemImage: "eye.slash")
            }
        }
        .task(id: urls) {
            image = nil
            for url in urls {
                if let (data, response) = try? await URLSession.shared.data(from: url),
                   (response as? HTTPURLResponse).map({ (200..<300).contains($0.statusCode) }) ?? true,
                   let loaded = NSImage(data: data) {
                    image = loaded
                    break
                }
            }
            attempted = true
        }
    }
}

@MainActor
final class AudioPlayback: ObservableObject {
    @Published private(set) var isPlaying = false
    @Published private(set) var currentTime: Double = 0
    @Published private(set) var duration: Double
    @Published private(set) var failed = false
    private let player: AVPlayer
    private var timeObserver: Any?
    private var cancellables = Set<AnyCancellable>()

    init(url: URL, storedDuration: Double?) {
        player = AVPlayer(url: url)
        duration = storedDuration ?? 0
        timeObserver = player.addPeriodicTimeObserver(forInterval: CMTime(seconds: 0.1, preferredTimescale: 600), queue: .main) { [weak self] time in
            MainActor.assumeIsolated { self?.currentTime = time.seconds }
        }
        player.publisher(for: \.timeControlStatus)
            .receive(on: RunLoop.main)
            .sink { [weak self] status in self?.isPlaying = status != .paused }
            .store(in: &cancellables)
        player.currentItem?.publisher(for: \.status)
            .receive(on: RunLoop.main)
            .sink { [weak self] status in if status == .failed { self?.failed = true } }
            .store(in: &cancellables)
        NotificationCenter.default.publisher(for: .AVPlayerItemDidPlayToEndTime, object: player.currentItem)
            .receive(on: RunLoop.main)
            .sink { [weak self] _ in self?.finished() }
            .store(in: &cancellables)
        if let asset = player.currentItem?.asset {
            Task { [weak self] in
                // Browser recordings often have no duration header; keep the stored one then.
                if let loaded = try? await asset.load(.duration).seconds, loaded.isFinite, loaded > 0 {
                    self?.duration = loaded
                }
            }
        }
    }

    var progress: Double { duration > 0 ? min(currentTime / duration, 1) : 0 }

    var timeLabel: String {
        let started = currentTime > 0 || isPlaying
        if duration > 0 {
            return started ? "\(Self.format(currentTime)) / \(Self.format(duration))" : Self.format(duration)
        }
        return started ? Self.format(currentTime) : ""
    }

    func toggle() {
        if isPlaying { player.pause() } else { player.play() }
    }

    func seek(toFraction fraction: Double) {
        guard duration > 0 else { return }
        seek(to: duration * min(max(fraction, 0), 1))
    }

    func seek(by seconds: Double) {
        guard duration > 0 else { return }
        seek(to: min(max(currentTime + seconds, 0), duration))
    }

    func stop() {
        player.pause()
        if let timeObserver { player.removeTimeObserver(timeObserver) }
        timeObserver = nil
    }

    private func seek(to seconds: Double) {
        currentTime = seconds
        player.seek(to: CMTime(seconds: seconds, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero)
    }

    private func finished() {
        // Recordings without a stored duration learn it on first play.
        if duration <= 0 { duration = currentTime }
        player.seek(to: .zero)
        currentTime = 0
    }

    static func format(_ seconds: Double) -> String {
        guard seconds.isFinite, seconds >= 0 else { return "0:00" }
        let whole = Int(seconds)
        return "\(whole / 60):" + String(format: "%02d", whole % 60)
    }
}

struct AudioDetailPreview: View {
    let card: LibraryCard
    @StateObject private var playback: AudioPlayback

    init(card: LibraryCard, url: URL) {
        self.card = card
        _playback = StateObject(wrappedValue: AudioPlayback(url: url, storedDuration: nil))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 12) {
                    Button(playback.isPlaying ? "Pause" : "Play", systemImage: playback.isPlaying ? "pause.fill" : "play.fill",
                           action: playback.toggle)
                        .labelStyle(.iconOnly)
                        .font(.system(size: 15, weight: .semibold))
                        .buttonStyle(.borderedProminent)
                        .buttonBorderShape(.circle)
                        .controlSize(.extraLarge)
                        .disabled(playback.failed)
                    WaveformBars(seed: card.id, progress: playback.progress)
                        .frame(height: 32)
                        .overlay { seekArea }
                        .accessibilityElement()
                        .accessibilityLabel("Playback position")
                        .accessibilityValue(playback.timeLabel)
                        .accessibilityAdjustableAction { direction in
                            playback.seek(by: direction == .increment ? 5 : -5)
                        }
                    Text(playback.timeLabel)
                        .font(.caption)
                        .monospacedDigit()
                        .foregroundStyle(.secondary)
                }
                .padding(.leading, 10)
                .padding(.trailing, 20)
                .frame(height: 64)
                .teakCardSurface(cornerRadius: 32)

                if playback.failed {
                    Text("This recording couldn’t be loaded. Try downloading it instead.")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                        .padding(.horizontal, 12)
                } else if let name = card.fileName {
                    Text(name)
                        .font(.callout)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                        .padding(.horizontal, 12)
                }
            }

            if let transcript = card.aiTranscript, !transcript.isEmpty {
                TranscriptBox(transcript: transcript)
            }
        }
        .frame(maxWidth: 576)
        .onDisappear(perform: playback.stop)
    }

    private var seekArea: some View {
        GeometryReader { geometry in
            Color.clear
                .contentShape(Rectangle())
                .gesture(DragGesture(minimumDistance: 0).onChanged { value in
                    playback.seek(toFraction: value.location.x / max(geometry.size.width, 1))
                })
        }
    }
}

struct TranscriptBox: View {
    let transcript: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("Transcript", systemImage: "sparkles")
                .font(.body.weight(.medium))
                .symbolRenderingMode(.multicolor)
            ScrollView {
                Text(transcript)
                    .textSelection(.enabled)
                    .lineSpacing(3)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(maxHeight: 256)
            .fixedSize(horizontal: false, vertical: true)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .teakCardSurface(cornerRadius: 12)
    }
}

struct NativePlayer: NSViewRepresentable {
    let url: URL

    func makeNSView(context: Context) -> AVPlayerView {
        let view = AVPlayerView()
        view.player = AVPlayer(url: url)
        view.controlsStyle = .inline
        return view
    }

    func updateNSView(_ view: AVPlayerView, context: Context) {
        if (view.player?.currentItem?.asset as? AVURLAsset)?.url != url {
            view.player?.pause()
            view.player = AVPlayer(url: url)
        }
    }

    static func dismantleNSView(_ view: AVPlayerView, coordinator: ()) {
        view.player?.pause()
        view.player = nil
    }
}
