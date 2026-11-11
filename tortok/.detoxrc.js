// Detox: end-to-end tests on the iOS simulator and the Android emulator.
//
// The *.release configurations bundle the JavaScript into the app, so no
// Metro server is needed; CI uses them (.github/workflows/e2e.yml). Build
// them through the npm scripts (`npm run e2e:build:ios` / `:android`), which
// set EXPO_PUBLIC_E2E=1 (the test sign-in) and point the app at the local
// backend. Start that backend first with scripts/e2e-up.sh.
//
// Env: DETOX_IOS_DEVICE  simulator type (default iPhone 17 Pro)
//      DETOX_IOS_UDID    a specific simulator, overriding the type (CI)
//      DETOX_AVD         Android emulator AVD name (default Medium_Phone_API_35)
//      E2E_ANDROID_ARCH  ABI to build for the emulator (default x86_64;
//                        arm64-v8a on Apple silicon)

/** @type {Detox.DetoxConfig} */
// With ccache on PATH, the release build compiles C, C++ and Objective-C
// through it. React Native's USE_CCACHE wrapper is silently skipped on
// Xcode 26, whose explicit modules don't recognise it, so ccache is handed to
// Xcode as C_COMPILER_LAUNCHER instead (as Nitro and Reanimated do). The
// config is React Native's own ccache.conf (sloppiness for module compiles);
// the compiler is checked by version string, since runner image updates touch
// clang's mtime without changing it. Swift isn't cached.
const IOS_CCACHE =
  'c=$(command -v ccache) &&' +
  ' export CCACHE_CONFIGPATH="$PWD/node_modules/react-native/scripts/xcode/ccache.conf"' +
  ' CCACHE_COMPILERCHECK="string:$(xcrun clang --version | head -1)"' +
  ' XCODE_CCACHE="C_COMPILER_LAUNCHER=$c CLANG_ENABLE_EXPLICIT_MODULES_WITH_COMPILER_LAUNCHER=YES"; ';

module.exports = {
  testRunner: {
    args: {
      config: 'e2e/jest.config.js',
      _: ['e2e'],
    },
  },
  apps: {
    'ios.debug': {
      type: 'ios.app',
      binaryPath: 'ios/build/Build/Products/Debug-iphonesimulator/tortok.app',
      build:
        'cd ios && xcodebuild -workspace tortok.xcworkspace -scheme tortok -configuration Debug -sdk iphonesimulator -derivedDataPath build',
    },
    'ios.release': {
      type: 'ios.app',
      binaryPath: 'ios/build/Build/Products/Release-iphonesimulator/tortok.app',
      build:
        IOS_CCACHE +
        'cd ios && xcodebuild -workspace tortok.xcworkspace -scheme tortok -configuration Release -sdk iphonesimulator -derivedDataPath build -quiet $XCODE_CCACHE',
    },
    'android.release': {
      type: 'android.apk',
      binaryPath: 'android/app/build/outputs/apk/release/app-release.apk',
      testBinaryPath: 'android/app/build/outputs/apk/androidTest/release/app-release-androidTest.apk',
      // One ABI only (the emulator's), which saves most of the build time.
      build:
        'cd android && ./gradlew assembleRelease assembleAndroidTest -DtestBuildType=release -PreactNativeArchitectures=${E2E_ANDROID_ARCH:-x86_64}',
    },
  },
  devices: {
    simulator: {
      type: 'ios.simulator',
      // CI passes the UDID of the simulator it warmed up; otherwise by type.
      device: process.env.DETOX_IOS_UDID
        ? { id: process.env.DETOX_IOS_UDID }
        : { type: process.env.DETOX_IOS_DEVICE ?? 'iPhone 17 Pro' },
    },
    emulator: {
      type: 'android.emulator',
      device: { avdName: process.env.DETOX_AVD ?? 'Medium_Phone_API_35' },
    },
  },
  configurations: {
    'ios.debug': { device: 'simulator', app: 'ios.debug' },
    'ios.release': { device: 'simulator', app: 'ios.release' },
    'android.release': { device: 'emulator', app: 'android.release' },
  },
};
