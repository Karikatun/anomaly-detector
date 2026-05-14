import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/button';
import { Surface, UiText } from '@/components/ui/primitives';
import { useAuth } from '@/lib/auth';

export default function ProfileScreen() {
  const auth = useAuth();

  if (!auth.user) return null;

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.content}>
        <View style={styles.header}>
          <UiText variant="xs" muted>
            Account
          </UiText>
          <UiText variant="title" weight="700">
            {auth.user.displayName ?? 'Profile'}
          </UiText>
          <UiText variant="sm" muted>
            {auth.user.email}
          </UiText>
        </View>

        <Surface bordered padded style={styles.card}>
          <UiText variant="xs" muted>
            User ID
          </UiText>
          <UiText variant="mono">{auth.user.id}</UiText>
        </Surface>

        <Button variant="outline" onPress={() => void auth.logout()}>
          Logout
        </Button>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: 8,
  },
  content: {
    flex: 1,
    gap: 16,
    justifyContent: 'center',
    padding: 20,
  },
  header: {
    gap: 6,
  },
  safeArea: {
    flex: 1,
  },
});
