import SwiftUI
import TeakCore

/// What the image viewer shows: the image's addresses, sharpest first, and its name.
struct ImageViewerItem: Codable, Hashable, Identifiable {
    var urls: [URL]
    var title: String
    var id: [URL] { urls }

    /// The original file first, for detail when zoomed in, then the renditions the card view uses.
    init(card: Card) {
        let name = card.fileMetadata?.fileName?.lowercased() ?? ""
        let original = name.hasSuffix(".svg") ? nil : SafeURL.sanitize(card.fileUrl)
        var seen = Set<URL>()
        urls = ([original].compactMap { $0 } + CardSheet.imageURLs(card)).filter { seen.insert($0).inserted }
        title = card.metadataTitle ?? card.fileMetadata?.fileName ?? tr("native.card.preview.image")
    }
}

/// The image at full size, loaded once for the viewer: large enough to stay sharp when zoomed in.
private struct FullImage: View {
    let item: ImageViewerItem
    @Binding var image: CGImage?
    @State private var failed = false

    var body: some View {
        ZStack {
            Color.clear
            if failed {
                Label(tr("native.card.preview.imageUnavailable"), systemImage: "photo")
                    .foregroundStyle(.secondary)
            } else if image == nil {
                ProgressView()
            }
        }
        .allowsHitTesting(false)
        .task(id: item) {
            for url in item.urls {
                if let loaded = await ImagePipeline.shared.image(for: url, maxPixelSize: 4096) { return image = loaded }
                if Task.isCancelled { return }
            }
            failed = true
        }
    }
}

#if os(iOS)
import UIKit

/// Full screen, with pinch and double-tap zoom. Swiping down, or Close, puts it away.
struct ImageViewer: View {
    let item: ImageViewerItem
    @Environment(\.dismiss) private var dismiss
    @State private var image: CGImage?
    @State private var pull = 0.0

    var body: some View {
        ZStack(alignment: .topTrailing) {
            Color.black.opacity(1 - min(pull / 300, 0.6)).ignoresSafeArea()
            if let image {
                ZoomableImage(image: image, label: item.title, onPull: { pull = $0 }, onDismiss: { dismiss() })
                    .ignoresSafeArea()
            }
            FullImage(item: item, image: $image)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .environment(\.colorScheme, .dark)
            Button(tr("common.close"), systemImage: "xmark") { dismiss() }
                .labelStyle(.iconOnly)
                .font(.title3)
                .frame(width: 44, height: 44)
                .buttonStyle(.glass)
                .buttonBorderShape(.circle)
                .keyboardShortcut(.cancelAction)
                .padding()
                .opacity(pull > 0 ? 0 : 1)
        }
        .presentationBackground(.clear)
        .statusBarHidden()
        .accessibilityAction(.escape) { dismiss() }
    }
}

private struct ZoomableImage: UIViewRepresentable {
    let image: CGImage
    let label: String
    let onPull: (Double) -> Void
    let onDismiss: () -> Void

    func makeUIView(context: Context) -> ZoomingScrollView { ZoomingScrollView() }

    func updateUIView(_ view: ZoomingScrollView, context: Context) {
        view.onPull = onPull
        view.onDismiss = onDismiss
        view.show(image, label: label)
    }
}

/// A scroll view that zooms its image, keeps it centered, and reports a pull down past the top so the
/// viewer can fade and close, as Photos does.
private final class ZoomingScrollView: UIScrollView, UIScrollViewDelegate {
    var onPull: ((Double) -> Void)?
    var onDismiss: (() -> Void)?
    private let imageView = UIImageView()
    private var shown: CGImage?
    private var fittedSize = CGSize.zero

    init() {
        super.init(frame: .zero)
        delegate = self
        minimumZoomScale = 1
        maximumZoomScale = 5
        alwaysBounceVertical = true
        showsVerticalScrollIndicator = false
        showsHorizontalScrollIndicator = false
        contentInsetAdjustmentBehavior = .never
        decelerationRate = .fast
        backgroundColor = .clear
        imageView.contentMode = .scaleAspectFit
        imageView.isAccessibilityElement = true
        imageView.accessibilityTraits = .image
        addSubview(imageView)
        let doubleTap = UITapGestureRecognizer(target: self, action: #selector(doubleTapped(_:)))
        doubleTap.numberOfTapsRequired = 2
        addGestureRecognizer(doubleTap)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    func show(_ image: CGImage, label: String) {
        imageView.accessibilityLabel = label
        guard image !== shown else { return }
        shown = image
        imageView.image = UIImage(cgImage: image)
        fittedSize = .zero
        setNeedsLayout()
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        guard let image = imageView.image, bounds.width > 0, bounds.height > 0,
              image.size.width > 0, image.size.height > 0 else { return }
        let scale = min(bounds.width / image.size.width, bounds.height / image.size.height)
        let fitted = CGSize(width: image.size.width * scale, height: image.size.height * scale)
        // A new image or a rotation fits the image to the screen again.
        if fitted != fittedSize {
            fittedSize = fitted
            zoomScale = minimumZoomScale
            imageView.frame = CGRect(origin: .zero, size: fitted)
            contentSize = fitted
        }
        centerImage()
    }

    private func centerImage() {
        let horizontal = max(0, (bounds.width - contentSize.width) / 2)
        let vertical = max(0, (bounds.height - contentSize.height) / 2)
        contentInset = UIEdgeInsets(top: vertical, left: horizontal, bottom: vertical, right: horizontal)
    }

    func viewForZooming(in scrollView: UIScrollView) -> UIView? { imageView }

    func scrollViewDidZoom(_ scrollView: UIScrollView) { centerImage() }

    /// How far the image is pulled down past its resting place, while it isn't zoomed in.
    private var pullDistance: Double {
        guard zoomScale <= minimumZoomScale + 0.01 else { return 0 }
        return max(0, -(contentOffset.y + contentInset.top))
    }

    func scrollViewDidScroll(_ scrollView: UIScrollView) { onPull?(pullDistance) }

    func scrollViewWillEndDragging(_ scrollView: UIScrollView, withVelocity velocity: CGPoint,
                                   targetContentOffset: UnsafeMutablePointer<CGPoint>) {
        guard zoomScale <= minimumZoomScale + 0.01 else { return }
        if pullDistance > 110 || (pullDistance > 20 && velocity.y < -1.2) { onDismiss?() }
    }

    @objc private func doubleTapped(_ tap: UITapGestureRecognizer) {
        if zoomScale > minimumZoomScale + 0.01 {
            setZoomScale(minimumZoomScale, animated: true)
            return
        }
        let point = tap.location(in: imageView)
        let scale = min(maximumZoomScale, 2.5)
        let size = CGSize(width: bounds.width / scale, height: bounds.height / scale)
        zoom(to: CGRect(x: point.x - size.width / 2, y: point.y - size.height / 2, width: size.width, height: size.height),
             animated: true)
    }
}
#endif

#if os(macOS)
/// The Mac's image window: fits the image, zooms with a pinch, a double-click or the toolbar, and scrolls
/// around when zoomed in.
struct ImageWindow: View {
    static let id = "image"
    let item: ImageViewerItem
    @State private var image: CGImage?
    @State private var zoom = 1.0
    @GestureState private var pinch = 1.0
    private static let zoomRange = 1.0...8.0

    var body: some View {
        GeometryReader { proxy in
            if let image {
                let fitted = Self.fitted(image, in: proxy.size)
                let scale = (zoom * pinch).clamped(to: Self.zoomRange)
                ScrollView([.horizontal, .vertical]) {
                    Image(decorative: image, scale: 1)
                        .resizable()
                        .interpolation(.high)
                        .frame(width: fitted.width * scale, height: fitted.height * scale)
                        .frame(minWidth: proxy.size.width, minHeight: proxy.size.height)
                        .accessibilityLabel(item.title)
                        .accessibilityAddTraits(.isImage)
                }
                .gesture(
                    MagnifyGesture()
                        .updating($pinch) { value, state, _ in state = value.magnification }
                        .onEnded { value in zoom = (zoom * value.magnification).clamped(to: Self.zoomRange) }
                )
                .onTapGesture(count: 2) { withAnimation(.snappy) { zoom = zoom > 1 ? 1 : 2.5 } }
            }
            FullImage(item: item, image: $image)
                .frame(width: proxy.size.width, height: proxy.size.height)
        }
        .frame(minWidth: 360, idealWidth: 900, minHeight: 280, idealHeight: 700)
        .background(.black)
        .navigationTitle(item.title)
        .toolbar {
            ToolbarItemGroup {
                Button(tr("apple.media.zoomOut"), systemImage: "minus.magnifyingglass") { step(by: 1 / 1.5) }
                    .keyboardShortcut("-")
                    .disabled(zoom <= Self.zoomRange.lowerBound)
                Button(tr("apple.media.zoomToFit"), systemImage: "arrow.down.right.and.arrow.up.left") {
                    withAnimation(.snappy) { zoom = 1 }
                }
                .keyboardShortcut("0")
                .disabled(zoom == 1)
                Button(tr("apple.media.zoomIn"), systemImage: "plus.magnifyingglass") { step(by: 1.5) }
                    .keyboardShortcut("=")
                    .disabled(zoom >= Self.zoomRange.upperBound)
            }
        }
    }

    private func step(by factor: Double) {
        withAnimation(.snappy) { zoom = (zoom * factor).clamped(to: Self.zoomRange) }
    }

    private static func fitted(_ image: CGImage, in size: CGSize) -> CGSize {
        let width = Double(image.width), height = Double(image.height)
        guard width > 0, height > 0, size.width > 0, size.height > 0 else { return .zero }
        // Never blown up past the image's own size when it fits.
        let scale = min(size.width / width, size.height / height, 1)
        return CGSize(width: width * scale, height: height * scale)
    }
}

private extension Double {
    func clamped(to range: ClosedRange<Double>) -> Double { Swift.min(Swift.max(self, range.lowerBound), range.upperBound) }
}
#endif
