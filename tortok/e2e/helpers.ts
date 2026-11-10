import { device, element, by, waitFor } from 'detox';
import { execSync } from 'child_process';
import fs from 'fs';
import appJson from '../app.json';

const ANDROID_PACKAGE = appJson.expo.android.package;

// The throwaway atproto network and local backend started by
// scripts/e2e-up.sh. test-network/start.mjs writes the account here.
const NETWORK_FILE = process.env.E2E_NETWORK_FILE ?? '/tmp/tortok-e2e/network.json';

export type TestNetwork = { pdsUrl: string; did: string; handle: string; appPassword: string };

export function testNetwork(): TestNetwork {
  if (!fs.existsSync(NETWORK_FILE)) {
    throw new Error(`${NETWORK_FILE} not found; run scripts/e2e-up.sh first`);
  }
  return JSON.parse(fs.readFileSync(NETWORK_FILE, 'utf8'));
}

// Every port the app reaches on the host: backend, content/webseed, tracker,
// PLC and PDS. The Android emulator's localhost is the emulator itself.
const HOST_PORTS = [8080, 8090, 8000, 2582, 2583];

// Playback and WebTorrent keep the app busy, so Detox's idle synchronization
// never settles; tests wait explicitly instead. Starting with it off also
// skips the launch-time wait for idle, which on Android runs to a 90 s
// timeout (DetoxTest in plugins/withDetoxAndroid.js).
const NO_SYNC = { detoxEnableSynchronization: 0 };

/** The app with no stored session, as if freshly installed. */
export async function freshLaunch() {
  if (device.getPlatform() === 'ios') {
    // The iOS Keychain survives app deletion, and SecureStore keeps the
    // session there, so clear it explicitly.
    execSync(`xcrun simctl keychain ${device.id} reset`);
    await device.launchApp({ newInstance: true, delete: true, launchArgs: NO_SYNC });
  } else {
    // Clearing the app's data gives the same clean state as a reinstall, in
    // a second rather than most of a minute.
    await device.terminateApp();
    execSync(`adb -s ${device.id} shell pm clear ${ANDROID_PACKAGE}`);
    await device.launchApp({ newInstance: true, launchArgs: NO_SYNC });
    for (const port of HOST_PORTS) await device.reverseTcpPort(port);
  }
  await device.disableSynchronization();
}

/** Relaunch, keeping the stored session. */
export async function relaunch() {
  await device.launchApp({ newInstance: true, launchArgs: NO_SYNC });
  await device.disableSynchronization();
}

export async function waitForLoginScreen(timeout = 30000) {
  await waitFor(element(by.id('signInButton'))).toBeVisible().withTimeout(timeout);
}

/** Sign in through the e2e-only app-password form against the test PDS. */
export async function signIn(network = testNetwork(), password = network.appPassword) {
  await waitForLoginScreen();
  await fill('devServiceField', network.pdsUrl);
  await fill('devHandleField', network.handle);
  // Submit from the keyboard's Go key rather than tapping the button, which
  // is still moving while the keyboard closes (KeyboardAvoidingView).
  await element(by.id('devPasswordField')).replaceText(password);
  await element(by.id('devPasswordField')).tapReturnKey();
}

/**
 * Set a text field, then close the keyboard: it opens on focus and would
 * cover the fields and button below.
 */
async function fill(id: string, text: string) {
  await element(by.id(id)).replaceText(text);
  await element(by.id(id)).tapReturnKey();
  await new Promise((r) => setTimeout(r, 400));
}

export async function waitForFeed(timeout = 20000) {
  await waitFor(element(by.id('videoFeed'))).toBeVisible().withTimeout(timeout);
}

export async function signInAndWaitForFeed() {
  await signIn();
  await waitForFeed();
}

/** Wait until the active feed item reports `state` (see activeVideoState in the feed). */
export async function waitForActiveVideo(state: string, timeout = 30000) {
  await waitFor(element(by.id('activeVideoState').and(by.label(state))))
    .toExist()
    .withTimeout(timeout);
}

/**
 * Tap a tab. On iOS synchronization is on for the tap only, so Detox waits
 * for a screen transition still animating (such as sign-in into the tabs)
 * instead of tapping the view sliding over it. On Android synchronization
 * would wait for an idle that playback never allows, up to its 90 s timeout,
 * so it waits for the tab to be visible instead.
 */
export async function openTab(tab: 'homeTab' | 'recordTab' | 'profileTab') {
  if (device.getPlatform() === 'android') {
    await waitFor(element(by.id(tab))).toBeVisible().withTimeout(10000);
    await element(by.id(tab)).tap();
    return;
  }
  await device.enableSynchronization();
  try {
    await element(by.id(tab)).tap();
  } finally {
    await device.disableSynchronization();
  }
}
