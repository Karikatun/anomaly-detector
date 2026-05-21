import { Redirect, useLocalSearchParams } from 'expo-router';

import { KeyValueCard } from '@/components/key-value-card';
import { PageHeader } from '@/components/page-header';
import { Screen } from '@/components/screen';
import { ScreenLoader } from '@/components/screen-states';
import { TEST_IDS } from '@/constants/testIds';
import { useAuth } from '@/lib/auth';

export default function DetailsScreen() {
  const auth = useAuth();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const detailsId = Array.isArray(params.id) ? params.id[0] : params.id;

  if (auth.isBootstrapping) {
    return <ScreenLoader />;
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
      testID={TEST_IDS.details.screen}>
      <PageHeader eyebrow="Stack screen" title="Details" />
      <KeyValueCard label="Route parameter" value={detailsId ?? 'missing-id'} />
    </Screen>
  );
}
