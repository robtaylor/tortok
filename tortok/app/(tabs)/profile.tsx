import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { authStyles } from '@/lib/styles';
import { AppViewUrlError, DEFAULT_APPVIEW_URL, useAppViewStore } from '@/stores/appview';
import { useAuthStore } from '@/stores/auth';

/**
 * Which AppView the feed comes from. Saving checks the address serves a
 * feed first; "Use the default" goes back to the build's default.
 */
function AppViewSetting() {
  const { url, setUrl, reset } = useAppViewStore();
  const custom = url !== DEFAULT_APPVIEW_URL;
  const [draft, setDraft] = useState(url);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setError(null);
    setSaving(true);
    try {
      setDraft(await setUrl(draft));
    } catch (e) {
      setError(e instanceof AppViewUrlError ? e.message : 'Couldn’t save the AppView');
    } finally {
      setSaving(false);
    }
  };

  const resetToDefault = () => {
    setError(null);
    reset();
    setDraft(DEFAULT_APPVIEW_URL);
  };

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>AppView</Text>
      <Text style={styles.sectionHint}>
        The server your feed comes from{custom ? '' : ' (the default)'}.
      </Text>
      <TextInput
        style={authStyles.input}
        value={draft}
        onChangeText={setDraft}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        returnKeyType="done"
        onSubmitEditing={save}
        testID="appViewUrlField"
      />
      {error ? <Text style={authStyles.error} testID="appViewError">{error}</Text> : null}
      <TouchableOpacity
        style={[authStyles.button, saving && authStyles.buttonDisabled]}
        onPress={save}
        disabled={saving}
        testID="appViewSaveButton"
      >
        {saving ? <ActivityIndicator color="#000" /> : <Text style={authStyles.buttonText}>Save</Text>}
      </TouchableOpacity>
      {custom ? (
        <TouchableOpacity onPress={resetToDefault} style={styles.resetButton} testID="appViewResetButton">
          <Text style={styles.resetText}>Use the default</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

export default function ProfileScreen() {
  // The handle and DID the user signed in with. Nothing fetches their
  // atproto profile (display name, avatar, bio) yet.
  const { did, lastHandle: handle, signOut } = useAuthStore();

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      testID="profileScroll"
    >
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Profile</Text>
        <TouchableOpacity onPress={signOut} style={styles.logoutButton} testID="logoutButton">
          <FontAwesome name="sign-out" size={20} color="#fff" />
        </TouchableOpacity>
      </View>

      <View style={styles.avatarContainer}>
        <View style={styles.avatar}>
          <FontAwesome name="user" size={40} color="#888" />
        </View>
      </View>

      <Text style={styles.handle} testID="username">
        {handle ? `@${handle}` : 'Signed in'}
      </Text>
      {did ? <Text style={styles.did} testID="did" selectable>{did}</Text> : null}

      <AppViewSetting />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  content: {
    paddingTop: 60,
    paddingHorizontal: 24,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 32,
  },
  headerTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
  },
  logoutButton: {
    padding: 8,
  },
  avatarContainer: {
    alignItems: 'center',
    marginBottom: 16,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#1a1a1a',
    justifyContent: 'center',
    alignItems: 'center',
  },
  handle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 4,
  },
  did: {
    color: '#555',
    fontSize: 12,
    textAlign: 'center',
    marginBottom: 24,
  },
  section: {
    borderTopWidth: 1,
    borderTopColor: '#222',
    paddingTop: 24,
    marginBottom: 32,
  },
  sectionTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  sectionHint: {
    color: '#888',
    fontSize: 13,
    marginBottom: 12,
  },
  resetButton: {
    alignItems: 'center',
    padding: 12,
  },
  resetText: {
    color: '#888',
    fontSize: 14,
  },
});
