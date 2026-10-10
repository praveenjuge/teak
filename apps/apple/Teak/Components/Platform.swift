import SwiftUI
import UniformTypeIdentifiers

#if os(macOS)
import AppKit
#else
import UIKit
#endif

/// The system clipboard on each platform.
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

extension UTType {
    /// The type for a file name, falling back to plain data.
    static func forFileName(_ name: String) -> UTType {
        UTType(filenameExtension: (name as NSString).pathExtension) ?? .data
    }
}
