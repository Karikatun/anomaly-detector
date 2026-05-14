import { StyleSheet, View } from 'react-native';

import { Screen } from '@/components/screen';
import { Button } from '@/components/ui/button';
import { Surface, Typography } from '@/components/ui/primitives';
import { useAuth } from '@/lib/auth';

export default function ProfileScreen() {
  const auth = useAuth();

  if (!auth.user) return null;

  return (
    <Screen centered padded={false} contentStyle={styles.content}>
      <View style={styles.header}>
        <Typography variant="caption" muted>
          Account
        </Typography>
        <Typography variant="h4" weight="700">
          {auth.user.displayName ?? 'Profile'}
        </Typography>
        <Typography variant="bodySm" muted>
          {auth.user.email}
        </Typography>
      </View>

      <Surface bordered padded style={styles.card}>
        <Typography variant="caption" muted>
          User ID
        </Typography>
        <Typography variant="code">{auth.user.id}</Typography>
      </Surface>

      <Button variant="outline" onPress={() => void auth.logout()}>
        Logout
      </Button>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: 8,
  },
  content: {
    gap: 16,
    padding: 20,
  },
  header: {
    gap: 6,
  },
});
