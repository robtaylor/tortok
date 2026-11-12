import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useAuthStore } from '@/stores/auth';

export default function ProfileScreen() {
  // The handle and DID the user signed in with. Nothing fetches their
  // atproto profile (display name, avatar, bio) yet.
  const { did, lastHandle: handle, signOut } = useAuthStore();

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
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
});
