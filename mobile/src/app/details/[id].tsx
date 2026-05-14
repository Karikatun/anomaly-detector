import { Redirect, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, StyleSheet } from 'react-native';

import { Screen } from '@/components/screen';
import { Surface, UiText } from '@/components/ui/primitives';
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
      <UiText variant="xs" muted>
        Stack screen
      </UiText>
      <UiText variant="title" weight="700">
        Details
      </UiText>
      <Surface bordered padded style={styles.card}>
        <UiText variant="xs" muted>
          Route parameter
        </UiText>
        <UiText variant="mono">{detailsId ?? 'missing-id'}</UiText>
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
