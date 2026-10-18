import Foundation
import SafariServices
import TeakCore

#if os(macOS)
import AppKit
#endif

final class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {
    func beginRequest(with context: NSExtensionContext) {
        let request = context.inputItems.first as? NSExtensionItem
        let message = request?.userInfo?[SFExtensionMessageKey]
        let payload = message as? [String: Any]
        let type = payload?["version"] as? Int == 1 ? payload?["type"] as? String : nil
        let url = payload?["url"] as? String
        nonisolated(unsafe) let context = context
        Task {
            let reply = await SafariRequests().handle(type: type, url: url)
            let response = NSExtensionItem()
            response.userInfo = [SFExtensionMessageKey: reply]
            context.completeRequest(returningItems: [response], completionHandler: nil)
        }
    }
}

struct SafariRequests {
    let session = TeakServices.session()

    func handle(type: String?, url: String?) async -> [String: Any] {
        switch type {
        case "getAuthState": return await authState()
        case "startSignIn": return await startSignIn()
        case "saveCurrentPage": return await save(url)
        case "signOut": return await signOut()
        case nil: return ["status": "error", "message": "Invalid Teak request."]
        default: return ["status": "error", "message": "Unsupported Teak request."]
        }
    }

    private func authState() async -> [String: Any] {
        do {
            guard try await session.restore() != nil, try await session.accessToken() != nil else {
                return ["authenticated": false, "status": "signed-out"]
            }
            return ["authenticated": true]
        } catch {
            return ["status": "error", "message": error.teakMessage]
        }
    }

    private func startSignIn() async -> [String: Any] {
        let url = URL(string: "teak://connect")!
        #if os(macOS)
        let opened = await MainActor.run { NSWorkspace.shared.open(url) }
        return opened
            ? ["status": "opening-app"]
            : ["status": "error", "message": "Open Teak from Applications to sign in."]
        #else
        return ["status": "open-url", "url": url.absoluteString]
        #endif
    }

    private func save(_ raw: String?) async -> [String: Any] {
        guard let url = SafeURL.sanitize(raw)?.absoluteString else {
            return ["status": "error", "message": "Open a regular website and try again."]
        }
        do {
            guard try await session.restore() != nil else { return ["status": "unauthenticated"] }
            let convex = TeakServices.http(session: session)
            let duplicate = try await convex.query(ConvexFunctions.findDuplicateCard, ["url": .string(url)])
            if let duplicate { return ["status": "duplicate", "cardId": duplicate.id] }
            let id = try await convex.mutation(ConvexFunctions.createCard,
                                                       ["content": .string(url), "type": "link", "url": .string(url),
                                                        "source": CardSource.apple])
            return ["status": "saved", "cardId": id]
        } catch let error as TeakError where error.code == TeakError.unauthenticatedCode {
            return ["status": "unauthenticated"]
        } catch {
            return ["status": "error", "message": error.teakMessage]
        }
    }

    private func signOut() async -> [String: Any] {
        do {
            guard try await session.restore() != nil, try await session.accessToken() != nil,
                  let sessionId = await session.sessionId
            else {
                await session.clear()
                return ["status": "signed-out"]
            }
            let _: ConvexVoid = try await TeakServices.http(session: session)
                .action(ConvexFunctions.revokeAuthkitSession, ["sessionId": .string(sessionId)])
            await session.clear()
            return ["status": "signed-out"]
        } catch {
            return ["status": "error", "message": "Couldn't sign out. Check your connection and try again."]
        }
    }
}
