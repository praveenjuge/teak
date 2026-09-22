//
//  AppDelegate.swift
//  macOS (App)
//
//  Created by Praveen Juge on 16/05/26.
//

import Cocoa

@main
class AppDelegate: NSObject, NSApplicationDelegate {
    private var menuBar: MenuBarController?
    private var settingsWindow: NSWindow?
    private var settingsWindowController: NSWindowController?
    private var onboardingWindowController: OnboardingWindowController?
    private let signInCoordinator = SafariSignInCoordinator()
    private var routeGeneration = 0
    private var isResolvingInitialRoute = true
    private var didFinishLaunching = false
    private var connectRequested = false

    func applicationWillFinishLaunching(_ notification: Notification) {
        // The storyboard owns the Settings window, but account state owns
        // which window is allowed to appear. Keep it hidden until routing
        // resolves so signed-out launches never flash Settings first.
        NSApplication.shared.windows
            .filter { $0.contentViewController is ViewController }
            .forEach { $0.orderOut(nil) }
        ProcessInfo.processInfo.disableAutomaticTermination("Resolving Teak account state")
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        if let iconURL = Bundle.main.url(forResource: "Icon", withExtension: "png"),
           let icon = NSImage(contentsOf: iconURL) {
            NSApplication.shared.applicationIconImage = icon
        }
        UserDefaults.standard.register(defaults: [MenuBarController.enabledDefaultsKey: false])
        menuBar = MenuBarController()
        configureSettingsWindow()
        didFinishLaunching = true
        resolveAndPresentRoute()
    }

    func application(_ application: NSApplication, open urls: [URL]) {
        guard urls.contains(where: { $0.absoluteString == "teak-safari://connect" }) else { return }
        connectRequested = true
        guard didFinishLaunching else { return }
        resolveAndPresentRoute()
    }

    /// Resolves account state before presenting Settings or onboarding.
    func showSettingsWindow() {
        resolveAndPresentRoute()
    }

    private func configureSettingsWindow() {
        let existingWindow = NSApplication.shared.windows.first(where: {
            $0.contentViewController is ViewController
        })
        let fallbackController = existingWindow == nil
            ? NSStoryboard(name: "Main", bundle: nil).instantiateInitialController() as? NSWindowController
            : nil
        guard let window = existingWindow ?? fallbackController?.window,
              let controller = window.contentViewController as? ViewController else { return }

        settingsWindow = window
        settingsWindowController = window.windowController ?? fallbackController
        window.orderOut(nil)
        controller.onSignInRequested = { [weak self, weak controller] window in
            self?.startSignIn(presenting: window) { state in
                controller?.renderAccountState(state)
            }
        }
        controller.onSignedOut = { [weak self] state in
            self?.presentOnboarding(state: state)
        }
        controller.onAuthenticationRequired = { [weak self] state in
            self?.presentOnboarding(state: state)
        }
    }

    private func nextRouteGeneration() -> Int {
        routeGeneration += 1
        return routeGeneration
    }

    private func resolveAndPresentRoute() {
        if signInCoordinator.isAuthenticating {
            connectRequested = false
            NSApplication.shared.activate(ignoringOtherApps: true)
            signInCoordinator.presentingWindow?.makeKeyAndOrderFront(nil)
            return
        }

        let generation = nextRouteGeneration()
        Task { @MainActor in
            let state = await TeakSafariService.shared.authState()
            guard generation == self.routeGeneration else { return }

            // A newer OAuth session is authoritative. Do not replace its
            // waiting state with the signed-out result from this earlier read.
            if self.signInCoordinator.isAuthenticating {
                self.connectRequested = false
                NSApplication.shared.activate(ignoringOtherApps: true)
                self.signInCoordinator.presentingWindow?.makeKeyAndOrderFront(nil)
                return
            }

            switch CompanionRoute.resolve(from: state) {
            case .settings:
                self.connectRequested = false
                self.presentSettings(state: state)
            case .onboarding:
                self.presentOnboarding(state: state)
                if CompanionRoute.shouldStartSignIn(
                    from: state,
                    connectRequested: self.connectRequested
                ),
                   let window = self.onboardingWindowController?.window {
                    self.connectRequested = false
                    self.startOnboardingSignIn(presenting: window)
                }
            }
        }
    }

    private func presentSettings(state: [String: Any]) {
        NSApplication.shared.activate(ignoringOtherApps: true)
        guard let window = settingsWindow,
              let controller = window.contentViewController as? ViewController else { return }
        controller.showSettingsTab()
        controller.renderAccountState(state)
        window.makeKeyAndOrderFront(nil)
        onboardingWindowController?.window?.orderOut(nil)
        finishInitialRouteIfNeeded()
    }

    private func presentOnboarding(state: [String: Any] = [:]) {
        let controller: OnboardingWindowController
        if let existing = onboardingWindowController {
            controller = existing
        } else {
            controller = OnboardingWindowController()
            controller.onboardingViewController.onSignIn = { [weak self, weak controller] window in
                guard controller != nil else { return }
                self?.startOnboardingSignIn(presenting: window)
            }
            onboardingWindowController = controller
        }

        controller.onboardingViewController.render(state)
        NSApplication.shared.activate(ignoringOtherApps: true)
        controller.present()
        settingsWindow?.orderOut(nil)
        finishInitialRouteIfNeeded()
    }

    private func finishInitialRouteIfNeeded() {
        guard isResolvingInitialRoute else { return }
        isResolvingInitialRoute = false
        ProcessInfo.processInfo.enableAutomaticTermination("Resolving Teak account state")
    }

    private func startSignIn(
        presenting window: NSWindow,
        render: @escaping ([String: Any]) -> Void
    ) {
        signInCoordinator.start(
            presenting: window,
            onStateChange: render
        ) { [weak self] state in
            guard let self else { return }
            render(state)
            if CompanionRoute.resolve(from: state) == .settings {
                self.presentSettings(state: state)
            }
        }
    }

    private func startOnboardingSignIn(presenting window: NSWindow) {
        startSignIn(presenting: window) { [weak self] state in
            self?.onboardingWindowController?.onboardingViewController.render(state)
        }
    }

    /// Syncs the menu bar item with its Settings toggle.
    func refreshMenuBar() {
        menuBar?.sync()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        // With the menu bar enabled the app lives on after its window closes;
        // otherwise closing Settings quits, as before.
        return !isResolvingInitialRoute && !MenuBarController.isEnabled
    }

}
