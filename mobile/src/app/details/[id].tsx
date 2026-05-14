import { Redirect, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, StyleSheet } from 'react-native';

import { Screen } from '@/components/screen';
import { Surface, Typography } from '@/components/ui/primitives';
import { TEST_IDS } from '@/constants/testIds';
import { useAuth } from '@/lib/auth';

export default function DetailsScreen() {
  const auth = useAuth();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const detailsId = Array.isArray(params.id) ? params.id[0] : params.id;

  if (auth.isBootstrapping) {
    return (
      <Screen centered padded={false}>
        <ActivityIndicator />
      </Screen>
    );
  }

  if (!auth.user) {
    return <Redirect href="/" />;
  }

  return (
    <Screen
      backButton="auto"
      backButtonTestID={TEST_IDS.details.backButton}
      backFallbackHref="/components"
      centered
      contentStyle={styles.content}
      padded={false}
      testID={TEST_IDS.details.screen}>
      <Typography variant="caption" muted>
        Stack screen
      </Typography>
      <Typography variant="h4" weight="700">
        Details
      </Typography>
      <Surface bordered padded style={styles.card}>
        <Typography variant="caption" muted>
          Route parameter
        </Typography>
        <Typography variant="code">{detailsId ?? 'missing-id'}</Typography>
      </Surface>
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
});
