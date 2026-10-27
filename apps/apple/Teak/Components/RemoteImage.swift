import ImageIO
import SwiftUI

#if os(macOS)
import AppKit
typealias PlatformImage = NSImage
extension Image {
    init(platformImage: NSImage) { self.init(nsImage: platformImage) }
}
#else
import UIKit
typealias PlatformImage = UIImage
extension Image {
    init(platformImage: UIImage) { self.init(uiImage: platformImage) }
}
#endif

actor ImagePipeline {
    static let shared = ImagePipeline()

    private let session: URLSession
    private let memory = NSCache<NSString, CGImageBox>()
    private var inFlight: [String: Task<CGImage?, Never>] = [:]

    init() {
        let configuration = URLSessionConfiguration.default
        configuration.urlCache = URLCache(memoryCapacity: 16 * 1024 * 1024, diskCapacity: 512 * 1024 * 1024,
                                          directory: FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)
                                              .first?.appending(path: "Images"))
        configuration.requestCachePolicy = .returnCacheDataElseLoad
        configuration.httpMaximumConnectionsPerHost = 6
        session = URLSession(configuration: configuration)
        memory.totalCostLimit = 128 * 1024 * 1024
    }

    func image(for url: URL, maxPixelSize: Int) async -> CGImage? {
        let key = "\(cacheKeyIgnoringSignature(url))#\(maxPixelSize)"
        if let cached = memory.object(forKey: key as NSString) { return cached.image }
        if let task = inFlight[key] { return await task.value }
        // Detached, so images download and decode side by side instead of one at a time on the actor.
        let task = Task<CGImage?, Never>.detached(priority: Task.currentPriority) { [session] in
            guard let (data, response) = try? await session.data(from: url),
                  (response as? HTTPURLResponse).map({ (200..<300).contains($0.statusCode) }) ?? true
            else { return nil }
            return Self.decode(data, maxPixelSize: maxPixelSize)
        }
        inFlight[key] = task
        let image = await task.value
        inFlight[key] = nil
        if let image { memory.setObject(CGImageBox(image), forKey: key as NSString, cost: image.bytesPerRow * image.height) }
        return image
    }

    func data(for url: URL) async throws -> Data {
        let (data, _) = try await session.data(from: url)
        return data
    }

    private func cacheKeyIgnoringSignature(_ url: URL) -> String {
        var components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        components?.query = nil
        return components?.string ?? url.absoluteString
    }

    nonisolated static func decode(_ data: Data, maxPixelSize: Int) -> CGImage? {
        guard let source = CGImageSourceCreateWithData(data as CFData, [kCGImageSourceShouldCache: false] as CFDictionary)
        else { return nil }
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceShouldCacheImmediately: true,
            kCGImageSourceThumbnailMaxPixelSize: max(1, maxPixelSize),
        ]
        return CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary)
    }
}

final class CGImageBox: @unchecked Sendable {
    let image: CGImage
    init(_ image: CGImage) { self.image = image }
}

struct RemoteImage: View {
    let urls: [URL]
    var placeholder: URL?
    var contentMode: ContentMode = .fill
    var maxPixelSize: Int?

    @Environment(\.displayScale) private var displayScale
    @State private var image: CGImage?
    @State private var placeholderImage: CGImage?
    @State private var failed = false
    /// What `image` was loaded for, so a tile that only shrinks keeps it.
    @State private var loaded: Request?

    private struct Request: Equatable {
        let urls: [URL]
        let pixels: Int
    }

    init(_ url: URL?, placeholder: URL? = nil, contentMode: ContentMode = .fill, maxPixelSize: Int? = nil) {
        urls = url.map { [$0] } ?? []
        self.placeholder = placeholder
        self.contentMode = contentMode
        self.maxPixelSize = maxPixelSize
    }

    init(urls: [URL], contentMode: ContentMode = .fill, maxPixelSize: Int? = nil) {
        self.urls = urls
        self.contentMode = contentMode
        self.maxPixelSize = maxPixelSize
    }

    var body: some View {
        GeometryReader { proxy in
            ZStack {
                Rectangle().fill(.fill.tertiary)
                if let image {
                    Image(decorative: image, scale: 1)
                        .resizable()
                        .aspectRatio(contentMode: contentMode)
                        .frame(width: proxy.size.width, height: proxy.size.height)
                        .transition(.opacity)
                } else if let placeholderImage {
                    Image(decorative: placeholderImage, scale: 1)
                        .resizable()
                        .aspectRatio(contentMode: contentMode)
                        .frame(width: proxy.size.width, height: proxy.size.height)
                        .blur(radius: 8)
                } else if failed || urls.isEmpty {
                    Image(systemName: "photo")
                        .font(.title3)
                        .foregroundStyle(.secondary)
                }
            }
            .clipped()
            .task(id: Request(urls: urls, pixels: pixels(for: proxy.size))) {
                await load(pixels: pixels(for: proxy.size))
            }
        }
    }

    /// The decode size in steps of 256 pixels, so a window resize reloads a few times, not every frame.
    private func pixels(for size: CGSize) -> Int {
        if let maxPixelSize { return max(maxPixelSize, 64) }
        let exact = max(size.width, size.height) * displayScale
        return max(Int((exact / 256).rounded(.up)) * 256, 64)
    }

    private func load(pixels: Int) async {
        if let loaded, image != nil, loaded.urls == urls {
            guard pixels > loaded.pixels else { return }
            // Wait for a live resize to settle before decoding a sharper copy.
            try? await Task.sleep(for: .milliseconds(250))
            if Task.isCancelled { return }
        }
        failed = false
        if let placeholder, image == nil {
            placeholderImage = await ImagePipeline.shared.image(for: placeholder, maxPixelSize: 64)
        }
        for url in urls {
            if let decoded = await ImagePipeline.shared.image(for: url, maxPixelSize: pixels) {
                // A request a resize replaced can finish last; it mustn't swap a sharper image for its smaller one.
                guard !Task.isCancelled else { return }
                withAnimation(.easeOut(duration: 0.15)) { image = decoded }
                loaded = Request(urls: urls, pixels: pixels)
                return
            }
            if Task.isCancelled { return }
        }
        failed = true
    }
}
