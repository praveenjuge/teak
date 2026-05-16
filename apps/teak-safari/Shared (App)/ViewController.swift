//
//  ViewController.swift
//  Shared (App)
//
//  Created by Praveen Juge on 16/05/26.
//

import WebKit
import Cocoa
import SafariServices

let extensionBundleIdentifier = "com.praveenjuge.teak-safari.Extension"

class ViewController: NSViewController, WKNavigationDelegate, WKScriptMessageHandler {

    @IBOutlet var webView: WKWebView!
    private var authPollTimer: Timer?

    override func viewDidLoad() {
        super.viewDidLoad()

        self.webView.navigationDelegate = self

        self.webView.configuration.userContentController.add(self, name: "controller")

        self.webView.loadFileURL(Bundle.main.url(forResource: "Main", withExtension: "html")!, allowingReadAccessTo: Bundle.main.resourceURL!)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        webView.evaluateJavaScript("show('mac')")

        SFSafariExtensionManager.getStateOfSafariExtension(withIdentifier: extensionBundleIdentifier) { (state, error) in
            guard let state = state, error == nil else {
                // Insert code to inform the user that something went wrong.
                return
            }

            DispatchQueue.main.async {
                if #available(macOS 13, *) {
                    webView.evaluateJavaScript("show('mac', \(state.isEnabled), true)")
                } else {
                    webView.evaluateJavaScript("show('mac', \(state.isEnabled), false)")
                }
            }
        }
        refreshAccountState()
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let command = message.body as? String else {
            return
        }

        switch command {
        case "refresh":
            refreshAccountState()
        case "start-sign-in":
            startSignIn()
        case "sign-out":
            signOut()
        case "open-preferences":
            openSafariExtensionPreferences()
        default:
            return
        }
    }

    private func refreshAccountState() {
        Task { @MainActor in
            let state = await TeakSafariService.shared.authState()
            renderAccountState(state)
        }
    }

    private func startSignIn() {
        Task { @MainActor in
            let response = await TeakSafariService.shared.startSignIn()
            renderAccountState([
                "authenticated": false,
                "status": "waiting",
                "message": "Complete sign in in your browser.",
            ])

            if let authURL = response["authUrl"] as? String, let url = URL(string: authURL) {
                openExternalURL(url)
                startAuthPolling()
            } else {
                renderAccountState(response)
            }
        }
    }

    private func signOut() {
        Task { @MainActor in
            authPollTimer?.invalidate()
            let state = await TeakSafariService.shared.signOut()
            renderAccountState(state)
        }
    }

    private func startAuthPolling() {
        authPollTimer?.invalidate()
        authPollTimer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] timer in
            Task { @MainActor in
                guard let self else {
                    timer.invalidate()
                    return
                }

                let state = await TeakSafariService.shared.authState()
                self.renderAccountState(state)

                if state["authenticated"] as? Bool == true {
                    timer.invalidate()
                    self.authPollTimer = nil
                }
            }
        }
    }

    private func renderAccountState(_ state: [String: Any]) {
        guard
            let data = try? JSONSerialization.data(withJSONObject: state),
            let json = String(data: data, encoding: .utf8)
        else {
            return
        }

        webView.evaluateJavaScript("renderAccountState(\(json))")
    }

    private func openExternalURL(_ url: URL) {
        NSWorkspace.shared.open(url)
    }

    private func openSafariExtensionPreferences() {
        SFSafariApplication.showPreferencesForExtension(withIdentifier: extensionBundleIdentifier) { error in
            guard error == nil else {
                return
            }

            DispatchQueue.main.async {
                NSApp.activate(ignoringOtherApps: true)
            }
        }
    }

}
