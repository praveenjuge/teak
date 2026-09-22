//
//  ViewController.swift
//  Shared (App)
//
//  Created by Praveen Juge on 16/05/26.
//

import Cocoa
import SafariServices

let extensionBundleIdentifier = "com.praveenjuge.teak-safari.Extension"

/// Hosts the Settings and About tabs in a toolbar-styled tab controller,
/// matching the standard macOS app settings window.
final class ViewController: NSViewController {
    private let settingsViewController = SettingsViewController()
    private let aboutViewController = AboutViewController()
    var onSignInRequested: ((NSWindow) -> Void)?
    var onSignedOut: (([String: Any]) -> Void)?
    var onAuthenticationRequired: (([String: Any]) -> Void)?

    private lazy var tabViewController: NSTabViewController = {
        let settingsItem = NSTabViewItem(viewController: settingsViewController)
        settingsItem.label = "Settings"
        settingsItem.image = NSImage(systemSymbolName: "gearshape", accessibilityDescription: "Settings")
        let aboutItem = NSTabViewItem(viewController: aboutViewController)
        aboutItem.label = "About"
        aboutItem.image = NSImage(systemSymbolName: "info.circle", accessibilityDescription: "About")
        let tabs = NSTabViewController()
        tabs.tabStyle = .toolbar
        tabs.addTabViewItem(settingsItem)
        tabs.addTabViewItem(aboutItem)
        return tabs
    }()

    override func viewDidAppear() {
        super.viewDidAppear()
        if let window = view.window {
            window.setContentSize(NSSize(width: 460, height: 344))
            window.minSize = window.frame.size
            window.maxSize = window.frame.size
        }
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        settingsViewController.onSignInRequested = { [weak self] in
            self?.startSignIn()
        }
        settingsViewController.onSignedOut = { [weak self] state in
            self?.onSignedOut?(state)
        }
        settingsViewController.onAuthenticationRequired = { [weak self] state in
            self?.onAuthenticationRequired?(state)
        }
        // Fixed pane size: without it the tab controller stretches the window
        // to each tab's fitting width (the About paragraph unwraps to 1200+pt).
        settingsViewController.preferredContentSize = NSSize(width: 460, height: 344)
        aboutViewController.preferredContentSize = NSSize(width: 460, height: 344)
        addChild(tabViewController)
        tabViewController.view.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(tabViewController.view)
        NSLayoutConstraint.activate([
            tabViewController.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            tabViewController.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            tabViewController.view.topAnchor.constraint(equalTo: view.topAnchor),
            tabViewController.view.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ])
    }

    /// Opens the Settings tab and starts OAuth. Invoked by the teak-safari://connect deep link.
    func startSignIn() {
        showSettingsTab()
        guard let window = view.window else { return }
        settingsViewController.prepareForSignIn()
        onSignInRequested?(window)
    }

    /// Selects the Settings tab (index 0) so "Open Settings…" never lands on About.
    func showSettingsTab() {
        tabViewController.selectedTabViewItemIndex = 0
    }

    func renderAccountState(_ state: [String: Any]) {
        settingsViewController.renderAccountState(state)
    }
}

final class SettingsViewController: NSViewController {
    var onSignInRequested: (() -> Void)?
    var onSignedOut: (([String: Any]) -> Void)?
    var onAuthenticationRequired: (([String: Any]) -> Void)?

    private let accountStatusLabel = NSTextField(labelWithString: "Checking account…")
    private let signInButton = NSButton(title: "Sign In", target: nil, action: #selector(startSignInFromButton))
    private let signOutButton = NSButton(title: "Sign Out", target: nil, action: #selector(signOutFromButton))
    private let spinner = NSProgressIndicator()
    private let extensionStatusLabel = NSTextField(labelWithString: "Checking extension…")
    private let openSettingsButton = NSButton(title: "Open Safari Settings…", target: nil, action: #selector(openSafariExtensionPreferences))
    private let menuBarToggle = NSButton(checkboxWithTitle: "Show Teak in the menu bar", target: nil, action: #selector(menuBarToggleChanged))
    private var isSignedIn = false
    private var isSigningIn = false
    private var activeObserver: NSObjectProtocol?
    private var accountStateGeneration = 0

    override func loadView() {
        view = NSView()
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        title = "Settings"
        signInButton.target = self
        signOutButton.target = self
        openSettingsButton.target = self
        menuBarToggle.target = self
        menuBarToggle.state = MenuBarController.isEnabled ? .on : .off
        signInButton.bezelStyle = .rounded
        signOutButton.bezelStyle = .rounded
        openSettingsButton.bezelStyle = .rounded
        signOutButton.isHidden = true
        spinner.style = .spinning
        spinner.controlSize = .small
        spinner.isDisplayedWhenStopped = false
        spinner.startAnimation(nil)
        signInButton.isEnabled = false

        let statusRow = NSStackView(views: [spinner, accountStatusLabel])
        statusRow.orientation = .horizontal
        statusRow.alignment = .centerY
        statusRow.spacing = 6
        accountStatusLabel.lineBreakMode = .byWordWrapping
        accountStatusLabel.maximumNumberOfLines = 2
        accountStatusLabel.setContentHuggingPriority(.init(1), for: .horizontal)
        extensionStatusLabel.lineBreakMode = .byWordWrapping
        extensionStatusLabel.maximumNumberOfLines = 2

        let accountButtons = NSStackView(views: [signInButton, signOutButton])
        accountButtons.orientation = .horizontal
        accountButtons.spacing = 8

        let separator = NSBox()
        separator.boxType = .separator

        let menuSeparator = NSBox()
        menuSeparator.boxType = .separator

        let stack = NSStackView(views: [
            Self.sectionLabel("Account"),
            statusRow,
            accountButtons,
            separator,
            Self.sectionLabel("Safari Extension"),
            extensionStatusLabel,
            openSettingsButton,
            menuSeparator,
            Self.sectionLabel("Menu Bar"),
            menuBarToggle,
        ])
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 8
        stack.setCustomSpacing(12, after: accountButtons)
        stack.setCustomSpacing(12, after: separator)
        stack.setCustomSpacing(12, after: openSettingsButton)
        stack.setCustomSpacing(12, after: menuSeparator)
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 20),
            stack.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -20),
            stack.topAnchor.constraint(equalTo: view.topAnchor, constant: 16),
            stack.bottomAnchor.constraint(lessThanOrEqualTo: view.bottomAnchor, constant: -16),
            // The stack's leading alignment leaves rows at their fitting size;
            // stretch the full-width rows so labels wrap and the rule spans.
            statusRow.widthAnchor.constraint(equalTo: stack.widthAnchor),
            separator.widthAnchor.constraint(equalTo: stack.widthAnchor),
            extensionStatusLabel.widthAnchor.constraint(equalTo: stack.widthAnchor),
            menuSeparator.widthAnchor.constraint(equalTo: stack.widthAnchor),
        ])
    }

    override func viewDidAppear() {
        super.viewDidAppear()
        view.window?.title = "Settings"
        refreshAccountState()
        refreshExtensionState()
        activeObserver = NotificationCenter.default.addObserver(
            forName: NSApplication.didBecomeActiveNotification, object: nil, queue: .main
        ) { [weak self] _ in
            guard let self, self.isViewLoaded, self.view.window != nil else { return }
            self.refreshAccountState()
            self.refreshExtensionState()
        }
    }

    override func viewDidDisappear() {
        super.viewDidDisappear()
        if let activeObserver {
            NotificationCenter.default.removeObserver(activeObserver)
            self.activeObserver = nil
        }
    }

    private static func sectionLabel(_ text: String) -> NSTextField {
        let label = NSTextField(labelWithString: text)
        label.font = .systemFont(ofSize: 13, weight: .semibold)
        return label
    }

    private func nextAccountStateGeneration() -> Int {
        accountStateGeneration += 1
        return accountStateGeneration
    }

    private func refreshAccountState() {
        // Never interleave with an active OAuth exchange: the callback's
        // result is authoritative and must render uncontested.
        guard !isSigningIn else { return }
        let generation = nextAccountStateGeneration()
        Task { @MainActor in
            let state = await TeakSafariService.shared.authState()
            guard generation == self.accountStateGeneration else { return }
            self.renderAccountState(state)
        }
    }

    func renderAccountState(_ state: [String: Any]) {
        if let authenticated = state["authenticated"] as? Bool {
            isSignedIn = authenticated
        }
        if let message = state["message"] as? String {
            accountStatusLabel.stringValue = message
        } else {
            accountStatusLabel.stringValue = isSignedIn ? "Ready to save pages." : "Sign in to save pages."
        }
        signInButton.isHidden = isSignedIn
        signOutButton.isHidden = !isSignedIn
        let busy = state["status"] as? String == "waiting"
        isSigningIn = busy
        if busy {
            spinner.startAnimation(nil)
        } else {
            spinner.stopAnimation(nil)
        }
        signInButton.isEnabled = !busy
        signOutButton.isEnabled = !busy

        if !busy,
           state["authenticated"] as? Bool == false,
           state["status"] as? String != "signed-out" {
            onAuthenticationRequired?(state)
        }
    }

    private func refreshExtensionState() {
        SFSafariExtensionManager.getStateOfSafariExtension(withIdentifier: extensionBundleIdentifier) { [weak self] state, _ in
            DispatchQueue.main.async {
                guard let self else { return }
                if let state {
                    self.extensionStatusLabel.stringValue = state.isEnabled
                        ? "Teak for Safari is on — save pages from the Safari toolbar."
                        : "Teak for Safari is off — turn it on in Safari Settings."
                } else {
                    self.extensionStatusLabel.stringValue = "Couldn’t check the extension state."
                }
            }
        }
    }

    func prepareForSignIn() {
        guard !isSigningIn else { return }
        // Invalidate in-flight reads; the shared coordinator's callback below
        // renders unconditionally.
        _ = nextAccountStateGeneration()
        isSigningIn = true
    }

    @objc private func startSignInFromButton() {
        onSignInRequested?()
    }

    @objc private func signOutFromButton() {
        isSigningIn = false
        let generation = nextAccountStateGeneration()
        Task { @MainActor in
            let state = await TeakSafariService.shared.signOut()
            guard generation == self.accountStateGeneration else { return }
            self.renderAccountState(state)
            if CompanionRoute.shouldShowOnboardingAfterSignOut(state) {
                self.onSignedOut?(state)
            }
        }
    }

    @objc private func menuBarToggleChanged() {
        MenuBarController.isEnabled = menuBarToggle.state == .on
        (NSApp.delegate as? AppDelegate)?.refreshMenuBar()
    }

    @objc private func openSafariExtensionPreferences() {
        SFSafariApplication.showPreferencesForExtension(withIdentifier: extensionBundleIdentifier) { _ in
            DispatchQueue.main.async {
                NSApp.activate(ignoringOtherApps: true)
            }
        }
    }
}

/// Mirrors the Teak settings footer (packages/ui SettingsFooter): wordmark,
/// Early Access badge, feedback note with links, and signature.
/// Artwork PNGs are rasterized from the shared SVG sources; see
/// packages/ui/src/logo.tsx and SettingsFooter.tsx.
final class AboutViewController: NSViewController {
    private static let brandRed = NSColor(srgbRed: 0xDC / 255.0, green: 0x26 / 255.0, blue: 0x26 / 255.0, alpha: 1)
    private var bodyView: NSTextView?
    private var bodyHeightConstraint: NSLayoutConstraint?

    override func loadView() {
        view = NSView()
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        title = "About"

        let wordmarkView = NSImageView()
        wordmarkView.image = Self.bundledImage(named: "Wordmark", size: NSSize(width: 63, height: 20))
        wordmarkView.imageScaling = .scaleProportionallyUpOrDown
        wordmarkView.setAccessibilityLabel("Teak")
        wordmarkView.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            wordmarkView.widthAnchor.constraint(equalToConstant: 63),
            wordmarkView.heightAnchor.constraint(equalToConstant: 20),
        ])

        let badgeLabel = NSTextField(labelWithString: "Early Access")
        badgeLabel.font = .systemFont(ofSize: 12, weight: .medium)
        let badge = NSBox()
        badge.boxType = .custom
        badge.fillColor = .clear
        badge.borderColor = .separatorColor
        badge.borderWidth = 1
        badge.cornerRadius = 10
        badgeLabel.translatesAutoresizingMaskIntoConstraints = false
        badge.addSubview(badgeLabel)
        NSLayoutConstraint.activate([
            badgeLabel.leadingAnchor.constraint(equalTo: badge.leadingAnchor, constant: 8),
            badgeLabel.trailingAnchor.constraint(equalTo: badge.trailingAnchor, constant: -8),
            badgeLabel.topAnchor.constraint(equalTo: badge.topAnchor, constant: 3),
            badgeLabel.bottomAnchor.constraint(equalTo: badge.bottomAnchor, constant: -3),
        ])

        let headerRow = NSStackView(views: [wordmarkView, badge])
        headerRow.orientation = .horizontal
        headerRow.alignment = .centerY
        headerRow.spacing = 8

        let bodyView = NSTextView()
        bodyView.isEditable = false
        bodyView.isSelectable = true
        bodyView.isRichText = true
        bodyView.importsGraphics = false
        bodyView.drawsBackground = false
        bodyView.backgroundColor = .clear
        bodyView.focusRingType = .none
        bodyView.isVerticallyResizable = true
        bodyView.isHorizontallyResizable = false
        bodyView.textContainerInset = .zero
        bodyView.textContainer?.lineFragmentPadding = 0
        bodyView.textContainer?.widthTracksTextView = true
        bodyView.textContainer?.heightTracksTextView = false
        bodyView.linkTextAttributes = [
            .foregroundColor: Self.brandRed,
            .font: NSFont.systemFont(ofSize: 13, weight: .semibold),
            .underlineStyle: 0,
        ]
        bodyView.textStorage?.setAttributedString(Self.bodyText())
        self.bodyView = bodyView
        bodyHeightConstraint = bodyView.heightAnchor.constraint(equalToConstant: 100)

        let signatureView = NSImageView()
        if let signature = Self.bundledImage(named: "Signature", size: NSSize(width: 112, height: 39)) {
            signature.isTemplate = true
            signatureView.image = signature
        }
        signatureView.contentTintColor = .secondaryLabelColor
        signatureView.imageScaling = .scaleProportionallyUpOrDown
        signatureView.setAccessibilityLabel("Praveen Juge Signature")
        signatureView.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            signatureView.widthAnchor.constraint(equalToConstant: 112),
            signatureView.heightAnchor.constraint(equalToConstant: 39),
        ])

        let versionLabel = NSTextField(labelWithString: Self.versionString())
        versionLabel.font = .systemFont(ofSize: 11)
        versionLabel.textColor = .secondaryLabelColor

        let stack = NSStackView(views: [headerRow, bodyView, signatureView, versionLabel])
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 12
        stack.setCustomSpacing(10, after: bodyView)
        stack.setCustomSpacing(8, after: signatureView)
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 20),
            stack.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -20),
            stack.topAnchor.constraint(equalTo: view.topAnchor, constant: 16),
            stack.bottomAnchor.constraint(lessThanOrEqualTo: view.bottomAnchor, constant: -16),
            bodyView.widthAnchor.constraint(equalTo: stack.widthAnchor),
            bodyHeightConstraint,
        ].compactMap { $0 })
    }

    override func viewDidAppear() {
        super.viewDidAppear()
        view.window?.title = "About"
        fitBodyHeight()
    }

    /// Sizes the body text view to its laid-out text at the stack width.
    private func fitBodyHeight() {
        guard let bodyView, let container = bodyView.textContainer,
              let layout = bodyView.layoutManager else { return }
        view.layoutSubtreeIfNeeded()
        layout.ensureLayout(for: container)
        bodyHeightConstraint?.constant = ceil(layout.usedRect(for: container).height)
    }

    private static func bundledImage(named name: String, size: NSSize) -> NSImage? {
        guard let url = Bundle.main.url(forResource: name, withExtension: "png"),
              let image = NSImage(contentsOf: url) else { return nil }
        // The PNGs are rasterized at 4x; pin the point size for Retina rendering.
        image.size = size
        return image
    }

    private static func bodyText() -> NSAttributedString {
        let paragraph = NSMutableParagraphStyle()
        paragraph.lineSpacing = 4
        let body: [NSAttributedString.Key: Any] = [
            .font: NSFont.systemFont(ofSize: 13),
            .foregroundColor: NSColor.secondaryLabelColor,
            .paragraphStyle: paragraph,
        ]
        func link(_ text: String, url: URL) -> NSAttributedString {
            // Display styling comes from the text view's linkTextAttributes.
            var attributes = body
            attributes[.link] = url
            return NSAttributedString(string: text, attributes: attributes)
        }
        let text = NSMutableAttributedString(string: "Let me know ", attributes: body)
        text.append(link("@praveenjuge", url: URL(string: "https://x.com/praveenjuge")!))
        text.append(NSAttributedString(string: " / ", attributes: body))
        text.append(link("hello@praveenjuge.com", url: URL(string: "mailto:hello@praveenjuge.com")!))
        text.append(NSAttributedString(
            string: " if you have any feedback. If you ever want to leave, you can ",
            attributes: body
        ))
        text.append(link(
            "delete your account",
            url: TeakSafariService.appBaseURL.appendingPathComponent("settings")
        ))
        text.append(NSAttributedString(
            string: ". Hope you enjoy using Teak as much as I enjoyed creating it.",
            attributes: body
        ))
        return text
    }

    private static func versionString() -> String {
        let info = Bundle.main.infoDictionary
        let version = info?["CFBundleShortVersionString"] as? String ?? "–"
        let build = info?["CFBundleVersion"] as? String ?? "–"
        return "Version \(version) (\(build))"
    }
}
