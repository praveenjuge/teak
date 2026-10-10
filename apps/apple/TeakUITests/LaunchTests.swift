import XCTest

/// The app opens to sign-in or the library, never a blank screen.
final class LaunchTests: XCTestCase {
    @MainActor
    func testLaunchShowsSignInOrLibrary() {
        let app = XCUIApplication()
        app.launch()
        let welcome = app.buttons["signIn.emailSignIn"]
        let library = app.searchFields.firstMatch
        let appeared = welcome.waitForExistence(timeout: 20) || library.waitForExistence(timeout: 5)
        XCTAssertTrue(appeared, "Expected the welcome screen or the library")
    }
}
