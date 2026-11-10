import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useAuthStore } from '@/stores/auth';

function StatView({ count, label }: { count: number; label: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statCount}>{count}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

export default function ProfileScreen() {
  const { user, did, lastHandle, signOut } = useAuthStore();

  // Signed in with atproto: show the handle and DID. The legacy `user`
  // (counts, bio) exists only for accounts signed in to the old backend;
  // nothing fills an atproto profile yet (Phase 3 Unit 2.5B and later).
  const handle = lastHandle ?? user?.username ?? null;

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

      <Text style={styles.displayName} testID="displayName">
        {user?.displayName ?? handle ?? 'Signed in'}
      </Text>
      {handle ? <Text style={styles.username} testID="username">@{handle}</Text> : null}
      {did ? <Text style={styles.did} testID="did" selectable>{did}</Text> : null}

      {user?.bio ? <Text style={styles.bio} testID="bio">{user.bio}</Text> : null}

      {user ? (
        <View style={styles.statsRow}>
          <StatView count={user.followerCount} label="Followers" />
          <StatView count={user.followingCount} label="Following" />
          <StatView count={user.videoCount} label="Videos" />
        </View>
      ) : null}
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
  displayName: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 4,
  },
  username: {
    color: '#888',
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 24,
  },
  did: {
    color: '#555',
    fontSize: 12,
    textAlign: 'center',
    marginBottom: 24,
  },
  bio: {
    color: '#fff',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 24,
    paddingHorizontal: 24,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 24,
  },
  stat: {
    alignItems: 'center',
  },
  statCount: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  statLabel: {
    color: '#888',
    fontSize: 13,
    marginTop: 2,
  },
});
