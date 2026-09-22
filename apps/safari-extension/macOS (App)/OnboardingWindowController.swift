import Cocoa

final class OnboardingWindowController: NSWindowController {
    let onboardingViewController = OnboardingViewController()

    init() {
        let contentSize = NSSize(width: 500, height: 360)
        let window = NSWindow(
            contentRect: NSRect(origin: .zero, size: contentSize),
            styleMask: [.titled, .closable, .miniaturizable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        window.title = "Welcome to Teak"
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.isMovableByWindowBackground = true
        window.isReleasedWhenClosed = false
        window.collectionBehavior.insert(.fullScreenNone)
        window.contentViewController = onboardingViewController
        window.setContentSize(contentSize)
        window.minSize = window.frame.size
        window.maxSize = window.frame.size
        super.init(window: window)
        shouldCascadeWindows = false
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    func present() {
        guard let window else { return }
        if !window.isVisible {
            window.center()
        }
        window.makeKeyAndOrderFront(nil)
    }
}

final class OnboardingViewController: NSViewController {
    var onSignIn: ((NSWindow) -> Void)?

    private let statusLabel = NSTextField(labelWithString: "")
    private let spinner = NSProgressIndicator()
    private let signInButton = NSButton(title: "Sign In", target: nil, action: #selector(signIn))

    override func loadView() {
        view = NSView()
    }

    override func viewDidLoad() {
        super.viewDidLoad()

        let wordmark = NSImageView()
        wordmark.image = Self.bundledWordmark()
        wordmark.imageScaling = .scaleProportionallyUpOrDown
        wordmark.setAccessibilityLabel("Teak")
        wordmark.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            wordmark.widthAnchor.constraint(equalToConstant: 72),
            wordmark.heightAnchor.constraint(equalToConstant: 23),
        ])

        let headline = NSTextField(wrappingLabelWithString: "Save Anything. Anywhere.")
        headline.font = .systemFont(ofSize: 22, weight: .semibold)
        headline.alignment = .center
        headline.maximumNumberOfLines = 1
        headline.setAccessibilityRole(.staticText)

        let description = NSTextField(wrappingLabelWithString:
            "Your personal everything management system. Organize, save, and access all your text, images, and documents in one place."
        )
        description.font = .systemFont(ofSize: 13)
        description.textColor = .secondaryLabelColor
        description.alignment = .center
        description.maximumNumberOfLines = 4
        description.setContentCompressionResistancePriority(.required, for: .vertical)

        let spacer = NSView()
        spacer.setContentHuggingPriority(.init(1), for: .vertical)

        statusLabel.font = .systemFont(ofSize: 12)
        statusLabel.textColor = .secondaryLabelColor
        statusLabel.alignment = .center
        statusLabel.maximumNumberOfLines = 2
        statusLabel.isHidden = true

        spinner.style = .spinning
        spinner.controlSize = .small
        spinner.isDisplayedWhenStopped = false
        spinner.setAccessibilityLabel("Signing in")

        signInButton.target = self
        signInButton.bezelStyle = .rounded
        signInButton.controlSize = .regular
        signInButton.keyEquivalent = "\r"
        signInButton.setAccessibilityLabel("Sign In to Teak")
        signInButton.translatesAutoresizingMaskIntoConstraints = false
        signInButton.widthAnchor.constraint(equalToConstant: 144).isActive = true

        let actionRow = NSStackView(views: [spinner, signInButton])
        actionRow.orientation = .horizontal
        actionRow.alignment = .centerY
        actionRow.spacing = 8

        let stack = NSStackView(views: [wordmark, headline, description, spacer, statusLabel, actionRow])
        stack.orientation = .vertical
        stack.alignment = .centerX
        stack.spacing = 10
        stack.setCustomSpacing(22, after: wordmark)
        stack.setCustomSpacing(9, after: headline)
        stack.setCustomSpacing(14, after: statusLabel)
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)

        NSLayoutConstraint.activate([
            stack.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            stack.topAnchor.constraint(equalTo: view.topAnchor, constant: 60),
            stack.bottomAnchor.constraint(equalTo: view.bottomAnchor, constant: -32),
            headline.widthAnchor.constraint(equalToConstant: 400),
            description.widthAnchor.constraint(equalToConstant: 380),
            statusLabel.widthAnchor.constraint(equalToConstant: 380),
        ])
    }

    func render(_ state: [String: Any]) {
        let busy = state["status"] as? String == "waiting"
        signInButton.isEnabled = !busy
        signInButton.title = busy ? "Signing In…" : "Sign In"
        if busy {
            spinner.startAnimation(nil)
        } else {
            spinner.stopAnimation(nil)
        }

        let message = state["message"] as? String ?? ""
        statusLabel.stringValue = message == "Connect Teak Safari to save pages." ? "" : message
        statusLabel.isHidden = statusLabel.stringValue.isEmpty
    }

    @objc private func signIn() {
        guard let window = view.window else { return }
        onSignIn?(window)
    }

    private static func bundledWordmark() -> NSImage? {
        guard let url = Bundle.main.url(forResource: "Wordmark", withExtension: "png"),
              let image = NSImage(contentsOf: url) else { return nil }
        image.size = NSSize(width: 72, height: 23)
        return image
    }
}
