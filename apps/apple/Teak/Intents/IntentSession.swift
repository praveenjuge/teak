import TeakCore

/// Teak's backend for Shortcuts, Siri and controls, signed in as the app is.
/// It reads only TeakCore, so an extension can run these intents too.
enum IntentSession {
    /// A signed-in client, or the "Open Teak and sign in" error.
    static func http() async throws -> ConvexHTTP {
        let session = TeakServices.session()
        guard try await session.restore() != nil else { throw signedOut }
        return TeakServices.http(session: session)
    }

    static func requireSignedIn() async throws {
        guard try await TeakServices.session().restore() != nil else { throw signedOut }
    }

    static var signedOut: TeakError { TeakError(message: tr("native.app.saveRequest.signedOutMessage")) }
}
