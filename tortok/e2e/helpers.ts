import { device, element, by, expect, waitFor } from 'detox';
import { execSync } from 'child_process';

export async function resetKeychainAndLaunch() {
  // iOS Keychain persists across app delete+reinstall. SecureStore uses the
  // Keychain, so auth tokens survive `delete: true`. Reset it explicitly.
  const udid = device.id;
  execSync(`xcrun simctl keychain ${udid} reset`);

  await device.launchApp({ newInstance: true, delete: true });
}

export async function waitForApp() {
  // Expo dev builds keep the main thread busy (Metro connection, dev menu,
  // etc.) so Detox's automatic synchronization never resolves. Disable it
  // and rely on explicit waitFor timeouts instead.
  await device.disableSynchronization();

  await waitFor(element(by.text('TorTok')))
    .toBeVisible()
    .withTimeout(30000);
}

export async function login(
  email = 'expo-test@tortok.dev',
  password = 'TestPass123!',
) {
  await waitForApp();

  // Use replaceText instead of typeText to avoid the keyboard entirely.
  // typeText triggers the iOS keyboard which covers the Sign In button,
  // and with Detox sync disabled the keyboard dismiss animation isn't
  // waited on, causing "not hittable" errors.
  await element(by.id('emailTextField')).replaceText(email);
  await element(by.id('passwordTextField')).replaceText(password);

  // replaceText focuses the password field and opens the keyboard,
  // which pushes the KeyboardAvoidingView and can cover the sign-in
  // button. Enable sync so Detox waits for any launch/transition
  // animations (UIDimmingView) to clear, tap the title to dismiss
  // the keyboard, then wait for the KeyboardAvoidingView to settle.
  await device.enableSynchronization();
  await element(by.text('TorTok')).tap();
  await device.disableSynchronization();
  await new Promise((r) => setTimeout(r, 500));

  // Re-enable sync so Detox waits for remaining animations before tap.
  await device.enableSynchronization();
  await element(by.id('signInButton')).tap();
  await device.disableSynchronization();

  // Wait for login to complete — login screen disappears
  await waitFor(element(by.id('signInButton')))
    .not.toBeVisible()
    .withTimeout(8000);
}
