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

    func applicationDidFinishLaunching(_ notification: Notification) {
        if let iconURL = Bundle.main.url(forResource: "Icon", withExtension: "png"),
           let icon = NSImage(contentsOf: iconURL) {
            NSApplication.shared.applicationIconImage = icon
        }
        UserDefaults.standard.register(defaults: [MenuBarController.enabledDefaultsKey: false])
        menuBar = MenuBarController()
    }

    func application(_ application: NSApplication, open urls: [URL]) {
        guard urls.contains(where: { $0.absoluteString == "teak-safari://connect" }) else { return }
        showSettingsWindow()
        for window in application.windows {
            if let controller = window.contentViewController as? ViewController {
                controller.startSignIn()
                return
            }
        }
    }

    /// Brings the existing Settings window forward.
    func showSettingsWindow() {
        NSApplication.shared.activate(ignoringOtherApps: true)
        for window in NSApplication.shared.windows {
            if window.contentViewController is ViewController {
                window.makeKeyAndOrderFront(nil)
                return
            }
        }
    }

    /// Syncs the menu bar item with its Settings toggle.
    func refreshMenuBar() {
        menuBar?.sync()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        // With the menu bar enabled the app lives on after its window closes;
        // otherwise closing Settings quits, as before.
        return !MenuBarController.isEnabled
    }

}
