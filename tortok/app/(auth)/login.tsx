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
import { authStyles } from '@/lib/styles';
import { useAuthStore } from '@/stores/auth';

// Phase 3 Unit 2: replaces the legacy email/password form with atproto
// OAuth (PAR + DPoP) against the user's existing PDS — typically
// bsky.social. Users register / recover their account on the PDS, not
// in TorTok, which is why there's no sign-up link any more.
export default function LoginScreen() {
  const [handle, setHandle] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const signInWithDid = useAuthStore((s) => s.signInWithDid);
  const router = useRouter();

  const handleLogin = async () => {
    const trimmed = handle.trim();
    if (!trimmed) {
      setError('Please enter your Bluesky handle');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const session = await atprotoSignIn(trimmed);
      await signInWithDid(session.sub);
      router.replace('/');
    } catch (e) {
      console.error('[oauth] signIn failed:', e);
      if (e instanceof Error && 'cause' in e && e.cause) {
        console.error('[oauth] cause:', e.cause);
        if (e.cause instanceof Error && 'cause' in e.cause && e.cause.cause) {
          console.error('[oauth] cause.cause:', e.cause.cause);
        }
      }
      setError(e instanceof Error ? e.message : 'Sign in failed');
    } finally {
      setLoading(false);
    }
  };

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
  helpText: {
    color: '#666',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 24,
    paddingHorizontal: 8,
    lineHeight: 18,
  },
});
