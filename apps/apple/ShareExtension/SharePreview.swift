import ImageIO
import QuickLookThumbnailing
import SwiftUI
import TeakCore
import UniformTypeIdentifiers

struct SharePreview: Equatable {
    let title: String
    let symbol: String
    let files: [URL]
    let count: Int

    init(items: [SharedItem]) {
        count = items.count
        files = items.prefix(3).compactMap { item in
            if case let .file(file) = item { file.fileURL } else { nil }
        }
        let name: String
        switch items.first {
        case let .text(text):
            if let url = LinkDetection.resolve(text).url {
                name = SafeURL.hostname(url) ?? url
                symbol = "link"
            } else {
                name = text.split(whereSeparator: \.isNewline).first.map(String.init) ?? text
                symbol = "text.quote"
            }
        case let .file(file):
            name = file.fileName
            symbol = Self.symbol(for: file)
        case nil:
            name = ""
            symbol = "tray"
        }
        title = items.count > 1 ? tr("native.common.cardCount", count: items.count) : name
    }

    private static func symbol(for file: UploadItem) -> String {
        let type = file.mimeType.flatMap { UTType(mimeType: $0) } ?? UTType(filenameExtension: file.fileURL.pathExtension)
        guard let type else { return "doc" }
        if type.conforms(to: .image) { return "photo" }
        if type.conforms(to: .audio) { return "waveform" }
        if type.conforms(to: .audiovisualContent) { return "play.rectangle" }
        if type.conforms(to: .pdf) { return "doc.richtext" }
        return "doc"
    }

    nonisolated static func thumbnail(of file: URL, size: CGFloat, scale: CGFloat) async -> CGImage? {
        if let image = imageThumbnail(file, pixels: size * scale) { return image }
        let request = QLThumbnailGenerator.Request(fileAt: file, size: CGSize(width: size, height: size),
                                                   scale: scale, representationTypes: .thumbnail)
        return try? await QLThumbnailGenerator.shared.generateBestRepresentation(for: request).cgImage
    }

    private nonisolated static func imageThumbnail(_ file: URL, pixels: CGFloat) -> CGImage? {
        guard let source = CGImageSourceCreateWithURL(file as CFURL, nil) else { return nil }
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: pixels * 1.5,
        ]
        return CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary)
    }
}

struct SharePreviewTile: View {
    let preview: SharePreview?
    let thumbnails: [URL: CGImage]
    let size: CGFloat
    @Environment(\.displayScale) private var displayScale

    var body: some View {
        let count = min(preview?.count ?? 1, 3)
        ZStack {
            ForEach((1..<max(count, 1)).reversed(), id: \.self) { index in
                tile(at: index)
                    .scaleEffect(0.86)
                    .rotationEffect(.degrees(index == 1 ? -11 : 10))
                    .offset(x: size * (index == 1 ? -0.16 : 0.16), y: -size * 0.04)
            }
            tile(at: 0)
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }

    private func tile(at index: Int) -> some View {
        let shape = RoundedRectangle(cornerRadius: size * 0.24, style: .continuous)
        let file = preview?.files.indices.contains(index) == true ? preview?.files[index] : nil
        return shape
            .fill(.fill.tertiary)
            .overlay {
                if let file, let image = thumbnails[file] {
                    Image(decorative: image, scale: displayScale)
                        .resizable()
                        .scaledToFill()
                        .transition(.opacity)
                } else if let preview {
                    Image(systemName: preview.symbol)
                        .font(.system(size: size * 0.36, weight: .medium))
                        .foregroundStyle(.secondary)
                        .transition(.opacity)
                }
            }
            .clipShape(shape)
            .overlay(shape.strokeBorder(.primary.opacity(0.08), lineWidth: 0.5))
            .background(shape.fill(.background).shadow(color: .black.opacity(0.16), radius: size * 0.14, y: size * 0.06))
            .frame(width: size, height: size)
    }
}

struct ShareStatusBadge: View {
    enum Status: Equatable { case saving, saved, partial, failed, attention }

    let status: Status
    let size: CGFloat
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ZStack {
            Circle().fill(fill)
            if status == .saving {
                Spinner(lineWidth: size * 0.08).padding(size * 0.24)
            } else {
                Image(systemName: symbol)
                    .font(.system(size: size * 0.46, weight: .black))
                    .foregroundStyle(.white)
                    .id(status)
                    .transition(.symbolEffect(.drawOn))
            }
        }
        .frame(width: size, height: size)
        .overlay(Circle().strokeBorder(.background, lineWidth: size * 0.1).padding(-size * 0.1))
        .shadow(color: .black.opacity(0.15), radius: 3, y: 1)
        .animation(reduceMotion ? .easeInOut(duration: 0.2) : .spring(duration: 0.45, bounce: 0.4), value: status)
        .accessibilityHidden(true)
    }

    private var fill: AnyShapeStyle {
        switch status {
        case .saving: AnyShapeStyle(.background)
        case .saved: AnyShapeStyle(.green.gradient)
        case .partial, .attention: AnyShapeStyle(.orange.gradient)
        case .failed: AnyShapeStyle(.red.gradient)
        }
    }

    private var symbol: String {
        switch status {
        case .saving, .saved: "checkmark"
        case .partial, .attention: "exclamationmark"
        case .failed: "xmark"
        }
    }
}

/// An arc that turns at a steady pace, drawn from the clock so it never stutters on a state change.
private struct Spinner: View {
    let lineWidth: CGFloat

    var body: some View {
        TimelineView(.animation) { context in
            let turn = context.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 0.9) / 0.9
            Circle()
                .trim(from: 0, to: 0.7)
                .stroke(.secondary, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
                .rotationEffect(.degrees(turn * 360))
        }
    }
}
