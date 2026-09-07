//
//  ViewController.swift
//  Shared (App)
//
//  Created by Praveen Juge on 16/05/26.
//

import AuthenticationServices
import WebKit
import Cocoa
import SafariServices

let extensionBundleIdentifier = "com.praveenjuge.teak-safari.Extension"

class ViewController: NSViewController, WKNavigationDelegate, WKScriptMessageHandler, ASWebAuthenticationPresentationContextProviding {

    @IBOutlet var webView: WKWebView!
    private var authenticationSession: ASWebAuthenticationSession?

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

    func startSignIn() {
        guard authenticationSession == nil else { return }
        do {
            let pending = try SafariOAuthRequest()
            let session = ASWebAuthenticationSession(
                url: pending.authorizationURL(baseURL: TeakSafariService.appBaseURL),
                callback: .customScheme("teak-safari")
            ) { [weak self] callback, error in
                Task { @MainActor in
                    guard let self else { return }
                    self.authenticationSession = nil
                    guard let callback, error == nil else {
                        self.renderAccountState([
                            "authenticated": false,
                            "message": "Sign-in was cancelled. You can try again.",
                        ])
                        return
                    }
                    let state = await TeakSafariService.shared.completeSignIn(pending, callback: callback)
                    self.renderAccountState(state)
                }
            }
            session.presentationContextProvider = self
            authenticationSession = session
            renderAccountState(["status": "waiting", "message": "Approve Teak Safari in your browser."])
            if !session.start() {
                authenticationSession = nil
                renderAccountState(["message": "Unable to open sign in. Please try again."])
            }
        } catch {
            renderAccountState(["message": error.localizedDescription])
        }
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        view.window ?? ASPresentationAnchor()
    }

    private func signOut() {
        authenticationSession?.cancel()
        authenticationSession = nil
        Task { @MainActor in
            let state = await TeakSafariService.shared.signOut()
            renderAccountState(state)
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
