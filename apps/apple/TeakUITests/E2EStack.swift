import Foundation
import XCTest

/// This checkout's local E2E stack (`bun run --cwd packages/tests e2e:stack`):
/// a local Convex backend and the WorkOS emulator. Every account is a
/// throwaway emulator user that exists only for the run.
enum E2EStack {
    static let clientId = "client_01TEAKE2EEMULATOR"
    static let apiKey = "sk_test_default"

    struct Urls {
        let convex: String
        let emulator: String
        let web: String
    }

    /// From `TEAK_E2E_*` (xcodebuild passes them as `TEST_RUNNER_TEAK_E2E_*`).
    static func urls() throws -> Urls {
        let environment = ProcessInfo.processInfo.environment
        guard let convex = environment["TEAK_E2E_CONVEX_URL"], let emulator = environment["TEAK_E2E_EMULATOR_URL"]
        else {
            throw XCTSkip("Start the E2E stack and pass TEAK_E2E_CONVEX_URL and TEAK_E2E_EMULATOR_URL (scripts/ui-tests.sh does both)")
        }
        return Urls(convex: convex, emulator: emulator, web: environment["TEAK_E2E_WEB_URL"] ?? "http://localhost:3000")
    }

    struct Account {
        let email: String
        let password: String
        let launchEnvironment: [String: String]
    }

    /// A verified emulator user with a vault, and a signed-in session for the app.
    static func account(signedIn: Bool = true) async throws -> Account {
        let urls = try urls()
        let suffix = UUID().uuidString.prefix(8).lowercased()
        let email = "e2e-apple-ui-\(Int(Date().timeIntervalSince1970))-\(suffix)@example.org"
        let password = "Teak-\(UUID().uuidString)-Aa1"
        _ = try await post(urls.emulator, "/user_management/users", [
            "email": email, "email_verified": true, "first_name": "Teak", "last_name": "Test", "password": password,
        ])
        var environment = [
            "TeakConvexURL": urls.convex,
            "TeakWorkOSURL": urls.emulator,
            "TeakWebURL": urls.web,
            "TeakEnvironment": "e2e",
            "TEAK_UI_TEST_RESET": "1",
        ]
        if signedIn {
            let response = try await post(urls.emulator, "/user_management/authenticate", [
                "client_id": clientId, "client_secret": apiKey, "email": email, "grant_type": "password",
                "password": password,
            ])
            environment["TEAK_UI_TEST_CLIENT_ID"] = clientId
            environment["TEAK_UI_TEST_SESSION"] = response.base64EncodedString()
        }
        return Account(email: email, password: password, launchEnvironment: environment)
    }

    private static func post(_ origin: String, _ path: String, _ body: [String: Any]) async throws -> Data {
        var request = URLRequest(url: URL(string: origin + path)!)
        request.httpMethod = "POST"
        request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, response) = try await URLSession.shared.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            throw NSError(domain: "E2EStack", code: status, userInfo: [NSLocalizedDescriptionKey: "Emulator \(path) failed: \(status)"])
        }
        return data
    }
}

extension XCUIElement {
    /// Waits for the element, failing the test with a clear message.
    @discardableResult
    func waitToAppear(_ timeout: TimeInterval = 15, file: StaticString = #filePath, line: UInt = #line) -> XCUIElement {
        XCTAssertTrue(waitForExistence(timeout: timeout), "\(self) never appeared", file: file, line: line)
        return self
    }

    func waitToDisappear(_ timeout: TimeInterval = 15, file: StaticString = #filePath, line: UInt = #line) {
        let gone = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: self)
        XCTAssertEqual(XCTWaiter.wait(for: [gone], timeout: timeout), .completed, "\(self) never went away",
                       file: file, line: line)
    }

    /// Opens the element's context menu: long press on iPhone and iPad, right click on Mac.
    func openContextMenu() {
        #if os(macOS)
        rightClick()
        #else
        press(forDuration: 1.2)
        #endif
    }
}
