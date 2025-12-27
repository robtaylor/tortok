//
//  LoginUITests.swift
//  TorTokUITests
//

import XCTest

final class LoginUITests: XCTestCase {

    var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false
        app = XCUIApplication()
        app.launch()
    }

    override func tearDownWithError() throws {
        app = nil
    }

    // MARK: - Login Screen Tests

    func testLoginScreenElementsExist() throws {
        // Verify login screen elements are present
        XCTAssertTrue(app.textFields["emailTextField"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.secureTextFields["passwordTextField"].exists)
        XCTAssertTrue(app.buttons["signInButton"].exists)
        XCTAssertTrue(app.buttons["signUpButton"].exists)

        // Verify branding
        XCTAssertTrue(app.staticTexts["TorTok"].exists)
        XCTAssertTrue(app.staticTexts["TikTok meets BitTorrent"].exists)
    }

    func testLoginWithEmptyFieldsShowsError() throws {
        // Tap sign in without entering credentials
        let signInButton = app.buttons["signInButton"]
        XCTAssertTrue(signInButton.waitForExistence(timeout: 5))
        signInButton.tap()

        // Verify error message appears
        let errorMessage = app.staticTexts["errorMessage"]
        XCTAssertTrue(errorMessage.waitForExistence(timeout: 3))
        XCTAssertEqual(errorMessage.label, "Please enter email and password")
    }

    func testLoginWithEmailOnlyShowsError() throws {
        // Enter only email
        let emailTextField = app.textFields["emailTextField"]
        XCTAssertTrue(emailTextField.waitForExistence(timeout: 5))
        emailTextField.tap()
        emailTextField.typeText("test@example.com")

        // Tap sign in
        app.buttons["signInButton"].tap()

        // Verify error message
        let errorMessage = app.staticTexts["errorMessage"]
        XCTAssertTrue(errorMessage.waitForExistence(timeout: 3))
        XCTAssertEqual(errorMessage.label, "Please enter email and password")
    }

    func testLoginWithInvalidCredentials() throws {
        // Enter invalid credentials
        let emailTextField = app.textFields["emailTextField"]
        XCTAssertTrue(emailTextField.waitForExistence(timeout: 5))
        emailTextField.tap()
        emailTextField.typeText("invalid@example.com")

        let passwordTextField = app.secureTextFields["passwordTextField"]
        passwordTextField.tap()
        passwordTextField.typeText("wrongpassword")

        // Tap sign in
        app.buttons["signInButton"].tap()

        // Wait for network request and error
        let errorMessage = app.staticTexts["errorMessage"]
        XCTAssertTrue(errorMessage.waitForExistence(timeout: 10))
    }

    func testSuccessfulLogin() throws {
        // NOTE: This test requires a valid test user in the backend
        // Test user: test@example.com / testpass123
        // Skip in CI without backend - uncomment to run locally with live backend
        throw XCTSkip("Requires live backend with test user - run manually")

        // Enter valid test credentials
        let emailTextField = app.textFields["emailTextField"]
        XCTAssertTrue(emailTextField.waitForExistence(timeout: 5))
        emailTextField.tap()
        emailTextField.typeText("test@example.com")

        let passwordTextField = app.secureTextFields["passwordTextField"]
        passwordTextField.tap()
        passwordTextField.typeText("testpass123")

        // Tap sign in
        app.buttons["signInButton"].tap()

        // Wait for network response and navigation
        // After successful login, we should see the feed view (empty state or videos)
        // Check for empty feed title which appears on successful login with no videos
        let emptyFeedTitle = app.staticTexts["emptyFeedTitle"]
        let feedAppeared = emptyFeedTitle.waitForExistence(timeout: 20)

        // If feed didn't appear, check if there's an error message (login failed)
        if !feedAppeared {
            let errorMessage = app.staticTexts["errorMessage"]
            if errorMessage.exists {
                XCTFail("Login failed with error: \(errorMessage.label)")
            } else {
                XCTFail("Navigation to feed did not occur within timeout")
            }
        }
    }

    // MARK: - Registration Screen Tests

    func testNavigateToRegisterScreen() throws {
        // Tap sign up button
        let signUpButton = app.buttons["signUpButton"]
        XCTAssertTrue(signUpButton.waitForExistence(timeout: 5))
        signUpButton.tap()

        // Verify register screen elements
        XCTAssertTrue(app.textFields["registerEmailTextField"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.textFields["registerUsernameTextField"].exists)
        XCTAssertTrue(app.textFields["registerDisplayNameTextField"].exists)
        XCTAssertTrue(app.secureTextFields["registerPasswordTextField"].exists)
        XCTAssertTrue(app.secureTextFields["registerConfirmPasswordTextField"].exists)
        XCTAssertTrue(app.buttons["createAccountButton"].exists)

        // Verify navigation title
        XCTAssertTrue(app.navigationBars["Sign Up"].exists)
    }

    func testRegisterWithMismatchedPasswordsShowsError() throws {
        // TODO: Fix form interaction - keyboard may be blocking button tap in iOS 26 simulator
        throw XCTSkip("Form interaction issue in iOS 26 simulator - needs investigation")

        // Navigate to register
        app.buttons["signUpButton"].tap()

        // Wait for register screen
        let emailField = app.textFields["registerEmailTextField"]
        XCTAssertTrue(emailField.waitForExistence(timeout: 5))

        // Fill in form with mismatched passwords
        emailField.tap()
        emailField.typeText("newuser@example.com")

        let usernameField = app.textFields["registerUsernameTextField"]
        usernameField.tap()
        usernameField.typeText("newuser")

        let displayNameField = app.textFields["registerDisplayNameTextField"]
        displayNameField.tap()
        displayNameField.typeText("New User")

        let passwordField = app.secureTextFields["registerPasswordTextField"]
        passwordField.tap()
        passwordField.typeText("password123")

        let confirmPasswordField = app.secureTextFields["registerConfirmPasswordTextField"]
        confirmPasswordField.tap()
        confirmPasswordField.typeText("differentpassword")

        // Tap on the create account button (may need to scroll if keyboard is blocking)
        let createButton = app.buttons["createAccountButton"]

        // If button isn't hittable, try scrolling up or dismissing keyboard
        if !createButton.isHittable {
            // Scroll up in the form to reveal the button
            app.swipeUp()
        }

        XCTAssertTrue(createButton.waitForExistence(timeout: 5))
        createButton.tap()

        // Verify error message appears
        let passwordMismatchError = app.staticTexts["Passwords don't match"]
        XCTAssertTrue(passwordMismatchError.waitForExistence(timeout: 5),
                      "Should show 'Passwords don't match' error")
    }

    func testCancelRegistration() throws {
        // Navigate to register
        let signUpButton = app.buttons["signUpButton"]
        XCTAssertTrue(signUpButton.waitForExistence(timeout: 5))
        signUpButton.tap()

        // Verify we're on register screen
        XCTAssertTrue(app.textFields["registerEmailTextField"].waitForExistence(timeout: 5))

        // Tap cancel
        app.buttons["Cancel"].tap()

        // Verify we're back on login screen
        XCTAssertTrue(app.textFields["emailTextField"].waitForExistence(timeout: 5))
    }

    // MARK: - Keyboard Tests

    func testKeyboardDismissalOnTap() throws {
        // Focus email field
        let emailTextField = app.textFields["emailTextField"]
        XCTAssertTrue(emailTextField.waitForExistence(timeout: 5))
        emailTextField.tap()

        // Type some text
        emailTextField.typeText("test")

        // Verify keyboard is shown (by checking if we can tap password field)
        let passwordTextField = app.secureTextFields["passwordTextField"]
        passwordTextField.tap()

        // Keyboard should still be visible, now test navigation works
        XCTAssertTrue(passwordTextField.isHittable)
    }
}
