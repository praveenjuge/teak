import SwiftUI
import TeakCore
import UniformTypeIdentifiers

#if os(macOS)
import AppKit
#else
import UIKit
#endif

enum Pasteboard {
    @MainActor static func copy(_ text: String) {
        #if os(macOS)
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
        #else
        UIPasteboard.general.string = text
        #endif
    }

    @MainActor static func copyImage(_ data: Data) -> Bool {
        #if os(macOS)
        guard let image = NSImage(data: data) else { return false }
        NSPasteboard.general.clearContents()
        return NSPasteboard.general.writeObjects([image])
        #else
        guard let image = UIImage(data: data) else { return false }
        UIPasteboard.general.image = image
        return true
        #endif
    }
}

func localizedNumber(_ value: Int) -> String {
    value.formatted(.number.locale(AppLanguage.locale))
}

extension UTType {
    static func forFileName(_ name: String) -> UTType {
        UTType(filenameExtension: (name as NSString).pathExtension) ?? .data
    }
}

extension Binding where Value == Bool {
    /// True while `item` is set. Dismissing clears it, so a dialog or alert
    /// doesn't come back after its button runs (the Mac re-presents one whose
    /// binding stays true).
    init<Item>(presenting item: Binding<Item?>) {
        self.init(get: { item.wrappedValue != nil }, set: { if !$0 { item.wrappedValue = nil } })
    }
}
