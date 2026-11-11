// Expo config plugin: silence compiler warnings from dependencies' native code,
// applied at `expo prebuild`. A full build logged ~3,700 warnings on iOS and
// ~730 on Android, almost all from React Native, Expo modules and pods such as
// react-native-quick-crypto, which we can't fix. Warnings from our own native
// code (the iOS app target, the Android `app` module) stay visible.
//
// - iOS: CocoaPods' `inhibit_all_warnings!` for every pod. About 580 remain:
//   umbrella-header, libtool "no symbols", nullability and Hermes warnings
//   that these switches don't reach. They're left for the Expo SDK 55 upgrade.
// - Android: library subprojects only: Kotlin and Java warnings suppressed, and
//   `-w` for their C/C++ builds (down to ~5).
//
// Set TORTOK_NATIVE_WARNINGS=1 when prebuilding to keep every warning, e.g. to
// see dependencies' deprecations while planning an SDK upgrade.
//
// The blocks are managed with mergeContents, so editing them here replaces the
// old block on the next prebuild.

const { withPodfile, withProjectBuildGradle } = require('@expo/config-plugins');
const { mergeContents, removeContents } = require('@expo/config-plugins/build/utils/generateCode');

const TAG = 'tortok-quiet-dependency-warnings';
const KEEP_WARNINGS = process.env.TORTOK_NATIVE_WARNINGS === '1';

// Adds the tagged block, or with KEEP_WARNINGS removes it (prebuild without
// --clean keeps the previous native files, block included).
const apply = (src, block) =>
  (KEEP_WARNINGS ? removeContents({ src, tag: TAG }) : mergeContents({ src, tag: TAG, ...block })).contents;

const withQuietPods = (config) =>
  withPodfile(config, (cfg) => {
    cfg.modResults.contents = apply(cfg.modResults.contents, {
      newSrc: '  inhibit_all_warnings!',
      anchor: /^target '[^']+' do$/,
      offset: 1,
      comment: '#',
    });
    return cfg;
  });

const GRADLE_BLOCK = `subprojects { sub ->
  if (sub.name == 'app') return
  sub.tasks.withType(org.jetbrains.kotlin.gradle.tasks.KotlinCompile).configureEach {
    compilerOptions { suppressWarnings.set(true) }
  }
  sub.tasks.withType(JavaCompile).configureEach {
    options.compilerArgs += ['-nowarn', '-Xlint:none']
  }
  sub.plugins.withId('com.android.library') {
    sub.android.defaultConfig.externalNativeBuild.cmake {
      cFlags '-w'
      cppFlags '-w'
    }
  }
}`;

const withQuietGradle = (config) =>
  withProjectBuildGradle(config, (cfg) => {
    cfg.modResults.contents = apply(cfg.modResults.contents, {
      newSrc: GRADLE_BLOCK,
      anchor: /^apply plugin: "com\.facebook\.react\.rootproject"$/,
      offset: 1,
      comment: '//',
    });
    return cfg;
  });

module.exports = (config) => withQuietGradle(withQuietPods(config));
