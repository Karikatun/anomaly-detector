import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedView } from '@/components/themed-view';
import { Surface, UiText } from '@/components/ui/primitives';
import { TEST_IDS } from '@/constants/testIds';
import { useAuth } from '@/lib/auth';

export default function DetailsScreen() {
  const auth = useAuth();
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const detailsId = Array.isArray(params.id) ? params.id[0] : params.id;

  if (auth.isBootstrapping) {
    return (
      <ThemedView style={styles.centered}>
        <ActivityIndicator />
      </ThemedView>
    );
  }

  if (!auth.user) {
    return <Redirect href="/" />;
  }

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }

    router.replace('/components');
  };

  return (
    <ThemedView style={styles.screen}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <Pressable
            accessibilityLabel="Back"
            accessibilityRole="button"
            hitSlop={8}
            onPress={handleBack}
            style={styles.backButton}
            testID={TEST_IDS.details.backButton}>
            <SymbolView
              name={{ ios: 'chevron.left', android: 'arrow_back', web: 'arrow_back' }}
              size={22}
              tintColor="#172018"
            />
          </Pressable>
        </View>

        <View style={styles.content} testID={TEST_IDS.details.screen}>
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
        </View>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  backButton: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#D8DED5',
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  card: {
    gap: 8,
  },
  centered: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
  },
  content: {
    flex: 1,
    gap: 16,
    justifyContent: 'center',
    padding: 20,
  },
  header: {
    alignItems: 'flex-start',
    minHeight: 56,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  safeArea: {
    flex: 1,
  },
  screen: {
    flex: 1,
  },
});
