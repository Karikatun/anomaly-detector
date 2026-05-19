import type { ProductSubscription } from 'expo-iap';
import { Redirect, useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { PageHeader } from '@/components/page-header';
import { Screen } from '@/components/screen';
import { ScreenLoader } from '@/components/screen-states';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { Typography } from '@/components/ui/typography';
import { TEST_IDS } from '@/constants/testIds';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { useSubscriptionIap } from '@/lib/iap';

export default function PaywallScreen() {
  const auth = useAuth();
  const router = useRouter();
  const iap = useSubscriptionIap();
  const colors = useTheme();

  if (auth.isBootstrapping) {
    return <ScreenLoader />;
  }

  if (!auth.user) {
    return <Redirect href="/" />;
  }

  if (auth.user.subscription.isActive) {
    return <Redirect href="/components" />;
  }

  if (!iap.isSupported) {
    return (
      <Screen centered testID={TEST_IDS.paywall.screen}>
        <PageHeader
          eyebrow="Premium"
          title="iOS subscriptions come first."
          description="Android billing is intentionally deferred for this MVP. Your account, profile, and logout remain available."
        />
        <View style={styles.actions}>
          <Button testID={TEST_IDS.paywall.profileButton} onPress={() => router.push('/profile')} variant="outline">
            Profile
          </Button>
          <Button testID={TEST_IDS.auth.logoutButton} onPress={() => void auth.logout()} variant="outline">
            Logout
          </Button>
        </View>
      </Screen>
    );
  }

  const selectedProduct = iap.products.find((product) => product.id === iap.selectedProductId) ?? iap.products[0];
  const isPrimaryLoading = iap.isPurchasing || iap.isSyncing;
  const isProductListEmpty = !iap.isLoadingProducts && iap.products.length === 0;

  return (
    <Screen
      scroll
      contentStyle={styles.content}
      scrollViewProps={{ showsVerticalScrollIndicator: false }}
      testID={TEST_IDS.paywall.screen}>
      <PageHeader
        eyebrow="Premium"
        title="Unlock the full component workspace."
        description="Subscribe through the App Store. The backend verifies every transaction before premium access is granted."
      />

      <Card>
        <CardHeader>
          <CardTitle>Choose a plan</CardTitle>
          <CardDescription>Monthly and yearly plans are managed by Apple and can be restored any time.</CardDescription>
        </CardHeader>
        <CardContent style={styles.cardContent}>
          {iap.isLoadingProducts && iap.products.length === 0 ? (
            <View style={styles.loadingRow} testID={TEST_IDS.paywall.loading}>
              <Spinner />
              <Typography muted>Loading App Store products...</Typography>
            </View>
          ) : null}

          {isProductListEmpty ? (
            <View
              style={[
                styles.notice,
                {
                  backgroundColor: colors.backgroundElement,
                },
              ]}
              testID={TEST_IDS.paywall.empty}>
              <Typography weight="600">Products are not available yet.</Typography>
              <Typography muted>
                Check the iOS product IDs, App Store Connect status, sandbox account, and dev-client build.
              </Typography>
            </View>
          ) : null}

          {iap.products.map((product) => (
            <PlanOption
              key={product.id}
              product={product}
              selected={product.id === selectedProduct?.id}
              onPress={() => iap.setSelectedProductId(product.id)}
            />
          ))}
        </CardContent>
      </Card>

      {iap.error ? (
        <View
          style={[
            styles.notice,
            {
              backgroundColor: colors.backgroundElement,
            },
          ]}
          testID={TEST_IDS.paywall.error}>
          <Typography weight="600">Subscription is not ready.</Typography>
          <Typography muted>{iap.error}</Typography>
        </View>
      ) : null}

      <View style={styles.actions}>
        <Button
          disabled={!selectedProduct || isPrimaryLoading}
          loading={iap.isPurchasing}
          onPress={() => void iap.purchase()}
          testID={TEST_IDS.paywall.purchaseButton}>
          {selectedProduct ? `Subscribe for ${selectedProduct.displayPrice}` : 'Subscribe'}
        </Button>
        <Button
          disabled={iap.isRestoring || iap.isPurchasing}
          loading={iap.isRestoring}
          onPress={() => void iap.restore()}
          testID={TEST_IDS.paywall.restoreButton}
          variant="outline">
          Restore purchases
        </Button>
      </View>

      <View style={styles.footerActions}>
        <Button onPress={() => router.push('/profile')} variant="ghost">
          Profile
        </Button>
        <Button onPress={() => void auth.logout()} variant="ghost">
          Logout
        </Button>
      </View>
    </Screen>
  );
}

function PlanOption({
  onPress,
  product,
  selected,
}: {
  onPress: () => void;
  product: ProductSubscription;
  selected: boolean;
}) {
  const colors = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[
        styles.plan,
        {
          backgroundColor: selected ? colors.backgroundSelected : colors.backgroundElement,
          borderColor: selected ? colors.text : colors.backgroundElement,
        },
      ]}
      testID={`${TEST_IDS.paywall.planOption}.${product.id}`}>
      <View style={styles.planText}>
        <Typography weight="600">{product.displayName ?? product.title}</Typography>
        <Typography muted>{product.description || product.id}</Typography>
      </View>
      <Typography weight="700">{product.displayPrice}</Typography>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  actions: {
    gap: Spacing.two,
  },
  cardContent: {
    gap: Spacing.two,
  },
  content: {
    paddingBottom: Spacing.five,
  },
  footerActions: {
    flexDirection: 'row',
    gap: Spacing.two,
    justifyContent: 'center',
  },
  loadingRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Spacing.two,
  },
  notice: {
    borderRadius: 8,
    gap: Spacing.one,
    padding: Spacing.three,
  },
  plan: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: Spacing.two,
    justifyContent: 'space-between',
    minHeight: 72,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  planText: {
    flex: 1,
    gap: Spacing.half,
  },
});
