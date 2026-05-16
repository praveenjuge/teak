//
//  SafariWebExtensionHandler.swift
//  Shared (Extension)
//
//  Created by Praveen Juge on 16/05/26.
//

import SafariServices
import os.log

class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {

    func beginRequest(with context: NSExtensionContext) {
        let request = context.inputItems.first as? NSExtensionItem

        let profile: UUID?
        if #available(macOS 14.0, *) {
            profile = request?.userInfo?[SFExtensionProfileKey] as? UUID
        } else {
            profile = request?.userInfo?["profile"] as? UUID
        }

        let message: Any?
        if #available(macOS 11.0, *) {
            message = request?.userInfo?[SFExtensionMessageKey]
        } else {
            message = request?.userInfo?["message"]
        }

        os_log(.default, "Received Teak Safari message: %@ (profile: %@)", String(describing: message), profile?.uuidString ?? "none")

        Task {
            let responseMessage = await self.handle(message: message)
            let response = NSExtensionItem()
            if #available(macOS 11.0, *) {
                response.userInfo = [ SFExtensionMessageKey: responseMessage ]
            } else {
                response.userInfo = [ "message": responseMessage ]
            }

            context.completeRequest(returningItems: [ response ], completionHandler: nil)
        }
    }

    private func handle(message: Any?) async -> [String: Any] {
        guard
            let payload = message as? [String: Any],
            payload["version"] as? Int == 1,
            let type = payload["type"] as? String
        else {
            return [
                "status": "error",
                "message": "Invalid Teak request.",
            ]
        }

        switch type {
        case "getAuthState":
            return await TeakSafariService.shared.authState()
        case "startSignIn":
            return await TeakSafariService.shared.startSignIn()
        case "saveCurrentPage":
            return await TeakSafariService.shared.saveCurrentPage(url: payload["url"] as? String)
        case "signOut":
            return await TeakSafariService.shared.signOut()
        default:
            return [
                "status": "error",
                "message": "Unsupported Teak request.",
            ]
        }
    }
}
