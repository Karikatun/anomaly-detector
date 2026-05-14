import { Redirect } from 'expo-router';
import { ActivityIndicator, StyleSheet } from 'react-native';

import AppTabs from '@/components/app-tabs';
import { ThemedView } from '@/components/themed-view';
import { useAuth } from '@/lib/auth';

export default function TabsLayout() {
  const auth = useAuth();

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

  return <AppTabs />;
}

const styles = StyleSheet.create({
  centered: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
  },
});
