import CoreText
import SwiftUI
import TeakCore
#if canImport(UIKit)
import UIKit
#else
import AppKit
#endif

/// Allo by Josh Puckett (SIL OFL 1.1), the font of every Teak surface. `apps/apple/scripts/allo-fonts.py`
/// builds the bundled faces from the web app's and Android's copies, with ss01 (the single-story "a")
/// always on: the variable roman and four drawn obliques, which `.italic()` and Markdown emphasis pick.
public enum Allo {
    private static let registered: Void = {
        for ext in ["ttf", "otf"] {
            for url in Bundle.module.urls(forResourcesWithExtension: ext, subdirectory: "Fonts") ?? [] {
                CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil)
            }
        }
    }()

    /// Allo at `size` points, regular unless `weight` (100 to 900) says otherwise. Apple's text doesn't
    /// pick a variable font's optical size, so it's set here as browsers and Android set it: from
    /// `opticalSize` (the size Dynamic Type scales from), else the size itself, within Allo's 9 to 32.
    /// SwiftUI weights the result with `.weight`, which a `weight` set here would override.
    public static func font(size: CGFloat, opticalSize: CGFloat? = nil, weight: CGFloat? = nil) -> CTFont {
        _ = registered
        var axes: [NSNumber: CGFloat] = [0x6F70_737A: min(max(opticalSize ?? size, 9), 32)] // opsz
        if let weight { axes[0x7767_6874] = weight } // wght
        let descriptor = CTFontDescriptorCreateWithAttributes([
            kCTFontNameAttribute: "AlloTeak-Regular",
            kCTFontVariationAttribute: axes,
        ] as CFDictionary)
        return CTFontCreateWithFontDescriptor(descriptor, size, nil)
    }
}

public extension Font {
    /// Allo at a fixed size, for text sized to its layout rather than to Dynamic Type.
    static func allo(size: CGFloat, weight: Font.Weight = .regular) -> Font {
        Font(Allo.font(size: size)).weight(weight)
    }
}

public extension View {
    /// Sets text in Allo at a text style, as `.font(style)` sets the system font: it follows
    /// Dynamic Type and Bold Text, and `.fontWeight`, `.italic` and `.monospacedDigit` still apply.
    func allo(_ style: Font.TextStyle, weight: Font.Weight? = nil) -> some View {
        modifier(AlloTextStyle(style: style, weight: weight))
    }

    /// Sets a List or Form section header in Allo at the system's header style. The app's Allo
    /// environment font replaces the style the system gives headers, so each sets it back.
    func alloSectionHeader() -> some View {
        allo(.headline)
    }

    /// Sets a List or Form section footer in Allo at the system's footer style, as `alloSectionHeader`.
    func alloSectionFooter() -> some View {
        #if os(macOS)
        allo(.subheadline)
        #else
        allo(.footnote)
        #endif
    }
}

/// `ContentUnavailableView` in Allo, with the same initializers. The system view drops its title's
/// size and weight under the app's Allo environment font, so this sets each part's style itself.
public struct AlloUnavailableView<Label: View, Description: View, Actions: View>: View {
    let label: Label
    let description: Description
    let actions: Actions

    public init(@ViewBuilder label: () -> Label, @ViewBuilder description: () -> Description = { EmptyView() },
                @ViewBuilder actions: () -> Actions = { EmptyView() }) {
        self.label = label()
        self.description = description()
        self.actions = actions()
    }

    public var body: some View {
        ContentUnavailableView {
            #if os(macOS)
            label.allo(.title3, weight: .bold)
            #else
            label.allo(.title2, weight: .bold)
            #endif
        } description: {
            description.allo(.body)
        } actions: {
            actions.allo(.body)
        }
    }
}

public extension AlloUnavailableView where Label == SwiftUI.Label<Text, Image>, Description == Text?, Actions == EmptyView {
    init(_ title: String, systemImage: String, description: Text? = nil) {
        self.init { SwiftUI.Label(title, systemImage: systemImage) } description: { description }
    }

    /// `ContentUnavailableView.search(text:)`, in Teak's own words.
    static func search(text: String) -> Self {
        Self(tr("native.filters.empty.noResults", text), systemImage: "magnifyingglass",
             description: Text(tr("native.filters.empty.checkSpelling")))
    }
}

private struct AlloTextStyle: ViewModifier {
    let style: Font.TextStyle
    let weight: Font.Weight?
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.legibilityWeight) private var legibilityWeight

    func body(content: Content) -> some View {
        let font = Allo.font(size: style.pointSize(at: dynamicTypeSize), opticalSize: style.pointSize(at: .large))
        var weight = weight ?? style.weight
        if legibilityWeight == .bold, let index = Self.weights.firstIndex(of: weight) {
            weight = Self.weights[min(index + 2, Self.weights.count - 1)]
        }
        return content.font(Font(font).weight(weight))
    }

    /// Bold Text moves regular text to semibold, as it does the system font.
    private static let weights: [Font.Weight] = [.ultraLight, .thin, .light, .regular, .medium, .semibold, .bold, .heavy, .black]
}

private extension Font.TextStyle {
    /// The system font's size for this style, so Allo lines up with system text.
    func pointSize(at dynamicTypeSize: DynamicTypeSize) -> CGFloat {
        #if canImport(UIKit)
        let traits = UITraitCollection(preferredContentSizeCategory: UIContentSizeCategory(dynamicTypeSize))
        return UIFont.preferredFont(forTextStyle: platformStyle, compatibleWith: traits).pointSize
        #else
        return NSFont.preferredFont(forTextStyle: platformStyle).pointSize
        #endif
    }

    var weight: Font.Weight {
        guard self == .headline else { return .regular }
        #if os(macOS)
        return .bold
        #else
        return .semibold
        #endif
    }

    #if canImport(UIKit)
    typealias PlatformStyle = UIFont.TextStyle
    #else
    typealias PlatformStyle = NSFont.TextStyle
    #endif

    var platformStyle: PlatformStyle {
        switch self {
        case .largeTitle: .largeTitle
        case .title: .title1
        case .title2: .title2
        case .title3: .title3
        case .headline: .headline
        case .subheadline: .subheadline
        case .callout: .callout
        case .footnote: .footnote
        case .caption: .caption1
        case .caption2: .caption2
        default: .body
        }
    }
}
