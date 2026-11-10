import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { signIn as atprotoSignIn } from '@/lib/atproto/oauth';
import { DEV_SIGN_IN_ENABLED, devSignIn } from '@/lib/atproto/devSignIn';
import { authStyles } from '@/lib/styles';
import { useAuthStore } from '@/stores/auth';

// Phase 3 Unit 2: replaces the legacy email/password form with atproto
// OAuth (PAR + DPoP) against the user's existing PDS — typically
// bsky.social. Users register / recover their account on the PDS, not
// in TorTok, which is why there's no sign-up link any more.
export default function LoginScreen() {
  const lastHandle = useAuthStore((s) => s.lastHandle);
  const [handle, setHandle] = useState(lastHandle ?? '');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const signInWithDid = useAuthStore((s) => s.signInWithDid);
  const router = useRouter();
  const [devService, setDevService] = useState('http://localhost:2583');
  const [devHandle, setDevHandle] = useState('');
  const [devPassword, setDevPassword] = useState('');

  /** Run a sign-in that yields a DID and handle, then enter the app. */
  const runSignIn = async (tag: string, attempt: () => Promise<{ did: string; handle: string }>) => {
    setError('');
    setLoading(true);
    try {
      const { did, handle: signedIn } = await attempt();
      await signInWithDid(did, signedIn);
      router.replace('/');
    } catch (e) {
      console.error(`[${tag}] signIn failed:`, e);
      if (e instanceof Error && 'cause' in e && e.cause) {
        console.error(`[${tag}] cause:`, e.cause);
        if (e.cause instanceof Error && 'cause' in e.cause && e.cause.cause) {
          console.error(`[${tag}] cause.cause:`, e.cause.cause);
        }
      }
      setError(e instanceof Error ? e.message : 'Sign in failed');
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = () => {
    const trimmed = handle.trim();
    if (!trimmed) {
      setError('Please enter your Bluesky handle');
      return;
    }
    void runSignIn('oauth', async () => ({ did: (await atprotoSignIn(trimmed)).sub, handle: trimmed }));
  };

  // `password` comes from the submit event when there is one: it carries the
  // field's current text even if this render's state hasn't caught up yet.
  const handleDevSignIn = (password = devPassword) =>
    void runSignIn('dev-sign-in', () => devSignIn(devService.trim(), devHandle.trim(), password));

  return (
    <KeyboardAvoidingView
      style={authStyles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.inner}>
        <Text style={styles.title}>TorTok</Text>
        <Text style={styles.subtitle}>Sign in with Bluesky</Text>

        {error ? (
          <Text style={authStyles.error} testID="errorMessage">
            {error}
          </Text>
        ) : null}

        <TextInput
          style={authStyles.input}
          placeholder="tortok-dev.bsky.social"
          placeholderTextColor="#888"
          value={handle}
          onChangeText={setHandle}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          textContentType="username"
          autoComplete="username"
          testID="handleTextField"
        />

        <TouchableOpacity
          style={[authStyles.button, loading && authStyles.buttonDisabled]}
          onPress={handleLogin}
          disabled={loading}
          testID="signInButton"
        >
          {loading ? (
            <ActivityIndicator color="#000" />
          ) : (
            <Text style={authStyles.buttonText}>Sign in with Bluesky</Text>
          )}
        </TouchableOpacity>

        <Text style={styles.helpText}>
          Enter the handle you use on Bluesky. You'll be redirected to
          your PDS to authorize TorTok.
        </Text>

        {DEV_SIGN_IN_ENABLED ? (
          <View style={styles.devSection} testID="devSignIn">
            <Text style={styles.devTitle}>Test sign-in (e2e builds only)</Text>
            <TextInput
              style={authStyles.input}
              value={devService}
              onChangeText={setDevService}
              autoCapitalize="none"
              autoCorrect={false}
              testID="devServiceField"
            />
            <TextInput
              style={authStyles.input}
              placeholder="handle"
              placeholderTextColor="#888"
              value={devHandle}
              onChangeText={setDevHandle}
              autoCapitalize="none"
              autoCorrect={false}
              testID="devHandleField"
            />
            <TextInput
              style={authStyles.input}
              placeholder="app password"
              placeholderTextColor="#888"
              value={devPassword}
              onChangeText={setDevPassword}
              autoCapitalize="none"
              autoCorrect={false}
              // A throwaway app password for the test PDS, so a plain field:
              // a secure one makes iOS offer to save it, and that sheet
              // covers the app in tests.
              autoComplete="off"
              returnKeyType="go"
              onSubmitEditing={(e) => handleDevSignIn(e.nativeEvent.text)}
              testID="devPasswordField"
            />
            <TouchableOpacity
              style={[authStyles.button, loading && authStyles.buttonDisabled]}
              onPress={() => handleDevSignIn()}
              disabled={loading}
              testID="devSignInButton"
            >
              <Text style={authStyles.buttonText}>Test sign-in</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  inner: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  title: {
    fontSize: 40,
    fontWeight: 'bold',
    color: '#fff',
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#888',
    textAlign: 'center',
    marginBottom: 32,
  },
  devSection: {
    marginTop: 32,
    borderTopWidth: 1,
    borderTopColor: '#333',
    paddingTop: 16,
  },
  devTitle: {
    color: '#888',
    fontSize: 13,
    marginBottom: 8,
  },
  helpText: {
    color: '#666',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 24,
    paddingHorizontal: 8,
    lineHeight: 18,
  },
});
