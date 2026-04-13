/** @type {Detox.DetoxConfig} */
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
      binaryPath:
        'ios/build/Build/Products/Debug-iphonesimulator/tortokexpo.app',
      build:
        'cd ios && xcodebuild -workspace tortokexpo.xcworkspace -scheme tortokexpo -configuration Debug -sdk iphonesimulator -derivedDataPath build',
    },
    'ios.release': {
      type: 'ios.app',
      binaryPath:
        'ios/build/Build/Products/Release-iphonesimulator/tortokexpo.app',
      build:
        'cd ios && xcodebuild -workspace tortokexpo.xcworkspace -scheme tortokexpo -configuration Release -sdk iphonesimulator -derivedDataPath build',
    },
  },
  devices: {
    simulator: {
      type: 'ios.simulator',
      device: {
        type: 'iPhone 16 Pro',
      },
    },
  },
  configurations: {
    'ios.debug': {
      device: 'simulator',
      app: 'ios.debug',
    },
    'ios.release': {
      device: 'simulator',
      app: 'ios.release',
    },
  },
};
