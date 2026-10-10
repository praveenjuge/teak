import XCTest

/// Signing in, against the local E2E stack's WorkOS emulator.
final class SignInTests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    @MainActor
    func testSignedOutLaunchShowsWelcome() async throws {
        let account = try await E2EStack.account(signedIn: false)
        let app = XCUIApplication()
        app.launchEnvironment = account.launchEnvironment
        app.launch()
        app.buttons["signIn.emailSignIn"].waitToAppear(30)
        XCTAssertTrue(app.buttons["signIn.apple"].exists)
        XCTAssertTrue(app.buttons["signIn.google"].exists)
        XCTAssertTrue(app.staticTexts["Save Anything. Anywhere."].exists)
    }

    #if os(iOS)
    /// The whole PKCE flow: AuthKit's page, the code exchange, `ensureUser`, then the library.
    @MainActor
    func testEmailSignInThroughAuthKit() async throws {
        let account = try await E2EStack.account(signedIn: false)
        let app = XCUIApplication()
        app.launchEnvironment = account.launchEnvironment
        app.launch()
        app.buttons["signIn.emailSignIn"].waitToAppear(30).tap()

        let browser = XCUIApplication(bundleIdentifier: "com.apple.SafariViewService")
        let email = browser.webViews.textFields.firstMatch
        XCTAssertTrue(email.waitForExistence(timeout: 30), "AuthKit's sign-in page never loaded")
        email.tap()
        email.typeText(account.email + "\n")
        let password = browser.webViews.secureTextFields.firstMatch
        XCTAssertTrue(password.waitForExistence(timeout: 15), "AuthKit never asked for the password")
        password.tap()
        password.typeText(account.password + "\n")

        app.searchFields.firstMatch.waitToAppear(40)
        app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Welcome to Teak")).firstMatch.waitToAppear(20)
    }
    #endif
}
