//
//  AppDelegate.swift
//  macOS (App)
//
//  Created by Praveen Juge on 16/05/26.
//

import Cocoa

@main
class AppDelegate: NSObject, NSApplicationDelegate {

    func applicationDidFinishLaunching(_ notification: Notification) {
        if let iconURL = Bundle.main.url(forResource: "Icon", withExtension: "png"),
           let icon = NSImage(contentsOf: iconURL) {
            NSApplication.shared.applicationIconImage = icon
        }
    }

    func application(_ application: NSApplication, open urls: [URL]) {
        guard urls.contains(where: { $0.absoluteString == "teak-safari://connect" }) else { return }
        application.activate(ignoringOtherApps: true)
        for window in application.windows {
            if let controller = window.contentViewController as? ViewController {
                window.makeKeyAndOrderFront(nil)
                controller.startSignIn()
                return
            }
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        return true
    }

}
