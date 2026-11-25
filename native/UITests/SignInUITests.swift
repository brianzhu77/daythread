import XCTest

final class SignInUITests: XCTestCase {
  override func setUp() {
    continueAfterFailure = false
  }

  /// A server with sign-in on answers 401 to an account request without a session.
  @MainActor
  func test_sign_in_shows_and_its_button_waits_for_both_fields() throws {
    let server = try Wrapper.value("DAYTHREAD_SIGN_IN_SERVER_URL")
    let app = XCUIApplication.daythread(server: server, store: Wrapper.storeName())
    app.launch()

    let button = app.buttons["Sign in"]
    XCTAssertTrue(button.waitForExistence(timeout: 30), "the sign-in screen")
    XCTAssertTrue(app.staticTexts["Daythread"].exists, "its title")
    XCTAssertFalse(button.isEnabled)

    let email = app.textFields["Email"]
    email.tap()
    email.typeText("someone@example.com")
    XCTAssertFalse(button.isEnabled, "no password yet")

    let password = app.secureTextFields["Password"]
    password.tap()
    password.typeText("secret")
    XCTAssertTrue(button.isEnabled)
    app.terminate()
  }
}
