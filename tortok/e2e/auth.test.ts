import { device, element, by, expect, waitFor } from 'detox';
import { resetKeychainAndLaunch, waitForApp } from './helpers';

describe('Authentication', () => {
  beforeEach(async () => {
    await resetKeychainAndLaunch();
    await waitForApp();
  });

  describe('Login screen', () => {
    it('should show login screen on fresh launch', async () => {
      await expect(element(by.text('TorTok'))).toBeVisible();
      await expect(element(by.text('Sign in to continue'))).toBeVisible();
      await expect(element(by.id('emailTextField'))).toBeVisible();
      await expect(element(by.id('passwordTextField'))).toBeVisible();
      await expect(element(by.id('signInButton'))).toBeVisible();
      await expect(element(by.id('signUpButton'))).toBeVisible();
    });

    it('should show error on empty submit', async () => {
      await element(by.id('signInButton')).tap();
      await expect(element(by.id('errorMessage'))).toBeVisible();
      await expect(element(by.text('Please fill in all fields'))).toBeVisible();
    });

    it('should show error for invalid credentials', async () => {
      await element(by.id('emailTextField')).replaceText('wrong@test.com');
      await element(by.id('passwordTextField')).replaceText('WrongPass1!');
      // Dismiss keyboard so sign-in button is hittable
      await device.enableSynchronization();
      await element(by.text('TorTok')).tap();
      await device.disableSynchronization();
      await new Promise((r) => setTimeout(r, 500));
      await device.enableSynchronization();
      await element(by.id('signInButton')).tap();
      await device.disableSynchronization();

      await waitFor(element(by.id('errorMessage')))
        .toBeVisible()
        .withTimeout(5000);
    });

    it('should login successfully with valid credentials', async () => {
      await element(by.id('emailTextField')).replaceText('expo-test@tortok.dev');
      await element(by.id('passwordTextField')).replaceText('TestPass123!');
      // Dismiss keyboard so KeyboardAvoidingView settles
      await element(by.text('TorTok')).tap();
      await new Promise((r) => setTimeout(r, 500));
      await device.enableSynchronization();
      await element(by.id('signInButton')).tap();
      await device.disableSynchronization();

      // Should leave login screen
      await waitFor(element(by.id('signInButton')))
        .not.toBeVisible()
        .withTimeout(8000);
    });
  });

  describe('Registration screen', () => {
    it('should navigate to registration', async () => {
      await element(by.id('signUpButton')).tap();
      await waitFor(element(by.id('registerEmailTextField')))
        .toBeVisible()
        .withTimeout(10000);
      await expect(element(by.id('registerUsernameTextField'))).toBeVisible();
      await expect(element(by.id('registerDisplayNameTextField'))).toBeVisible();
      await expect(element(by.id('registerPasswordTextField'))).toBeVisible();
      await expect(element(by.id('registerConfirmPasswordTextField'))).toBeVisible();
      await expect(element(by.id('createAccountButton'))).toBeVisible();
    });

    it('should show error on empty registration submit', async () => {
      await element(by.id('signUpButton')).tap();
      await waitFor(element(by.id('createAccountButton')))
        .toBeVisible()
        .withTimeout(10000);
      // Re-enable sync so the tap properly triggers React's onPress handler
      await device.enableSynchronization();
      await element(by.id('createAccountButton')).tap();
      await device.disableSynchronization();
      await waitFor(element(by.id('registerErrorMessage')))
        .toBeVisible()
        .withTimeout(5000);
    });

    it('should show error on password mismatch', async () => {
      await element(by.id('signUpButton')).tap();
      await waitFor(element(by.id('registerEmailTextField')))
        .toBeVisible()
        .withTimeout(10000);
      await element(by.id('registerEmailTextField')).replaceText('mismatch@test.com');
      await element(by.id('registerUsernameTextField')).replaceText('mismatch');
      await element(by.id('registerDisplayNameTextField')).replaceText('Mismatch');
      await element(by.id('registerPasswordTextField')).replaceText('TestPass123!');
      await element(by.id('registerConfirmPasswordTextField')).replaceText('Different!');
      // replaceText focuses the field and opens the keyboard — dismiss it
      await element(by.id('registerConfirmPasswordTextField')).tapReturnKey();
      await new Promise((r) => setTimeout(r, 1000));
      // Re-enable sync for proper tap handling
      await device.enableSynchronization();
      await element(by.id('createAccountButton')).tap();
      await device.disableSynchronization();
      await waitFor(element(by.id('registerErrorMessage')))
        .toBeVisible()
        .withTimeout(5000);
    });

    it('should dismiss registration with cancel', async () => {
      await element(by.id('signUpButton')).tap();
      await waitFor(element(by.id('registerEmailTextField')))
        .toBeVisible()
        .withTimeout(10000);
      // Re-enable sync so modal dismiss animation completes
      await device.enableSynchronization();
      await element(by.text('Cancel')).tap();
      await device.disableSynchronization();
      await waitFor(element(by.id('signInButton')))
        .toBeVisible()
        .withTimeout(10000);
    });
  });
});
