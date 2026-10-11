import SwiftUI
import TeakCore

#if os(macOS)
import AppKit

final class ShareViewController: NSViewController {
    override func loadView() {
        SentryReporting.start(extensionName: "share")
        let model = ShareModel(providers: inputProviders)
        view = NSHostingView(rootView: ShareView(
            model: model,
            close: { [weak self] in self?.extensionContext?.completeRequest(returningItems: nil) },
            openApp: { [weak self] in
                NSWorkspace.shared.open(URL(string: "teak://connect")!)
                self?.extensionContext?.completeRequest(returningItems: nil)
            }))
        view.frame = NSRect(x: 0, y: 0, width: 360, height: 280)
    }

    private var inputProviders: [NSItemProvider] {
        (extensionContext?.inputItems as? [NSExtensionItem] ?? []).flatMap { $0.attachments ?? [] }
    }
}
#else
import UIKit

final class ShareViewController: UIViewController {
    override func viewDidLoad() {
        super.viewDidLoad()
        SentryReporting.start(extensionName: "share")
        let model = ShareModel(providers: inputProviders)
        let host = UIHostingController(rootView: ShareView(
            model: model,
            close: { [weak self] in self?.extensionContext?.completeRequest(returningItems: nil) },
            openApp: { [weak self] in self?.openTeak() }))
        addChild(host)
        host.view.frame = view.bounds
        host.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(host.view)
        host.didMove(toParent: self)
    }

    private var inputProviders: [NSItemProvider] {
        (extensionContext?.inputItems as? [NSExtensionItem] ?? []).flatMap { $0.attachments ?? [] }
    }

    /// Share extensions can't open URLs directly, so ask the hosting app's
    /// `UIApplication` through the responder chain, as the old app did.
    private func openTeak() {
        let url = URL(string: "teak://connect")!
        var responder: UIResponder? = self
        while let current = responder {
            let selector = NSSelectorFromString("openURL:options:completionHandler:")
            if current is UIApplication, current.responds(to: selector) {
                _ = current.perform(selector, with: url, with: [UIApplication.OpenExternalURLOptionsKey: Any]())
                break
            }
            responder = current.next
        }
        extensionContext?.completeRequest(returningItems: nil)
    }
}
#endif
