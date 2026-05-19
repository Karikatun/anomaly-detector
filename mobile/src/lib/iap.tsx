import type { SubscriptionSnapshot } from '@web-app-demo/contracts';
import {
  deepLinkToSubscriptions,
  useIAP,
  type ProductSubscription,
  type Purchase,
} from 'expo-iap';
import { createContext, type PropsWithChildren, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';

import { ApiRequestError } from './api';
import { useAuth } from './auth';
import {
  buildReconcilePayloadFromPurchases,
  buildSubscriptionPurchaseRequest,
  extractSignedTransactionInfo,
  ingestAndFinishPurchase,
  isUserCancelledPurchaseError,
  processPurchaseResult,
  sortProductsByConfiguredOrder,
} from './iap-utils';

const iosProductIds = [
  process.env.EXPO_PUBLIC_IAP_IOS_MONTHLY_PRODUCT_ID,
  process.env.EXPO_PUBLIC_IAP_IOS_YEARLY_PRODUCT_ID,
]
  .map((productId) => productId?.trim())
  .filter((productId): productId is string => Boolean(productId));

type SubscriptionContextValue = {
  error: string | null;
  isConnected: boolean;
  isLoadingProducts: boolean;
  isPurchasing: boolean;
  isRestoring: boolean;
  isSupported: boolean;
  isSyncing: boolean;
  platform: typeof Platform.OS;
  productIds: string[];
  products: ProductSubscription[];
  purchase: () => Promise<void>;
  restore: () => Promise<void>;
  manageSubscriptions: () => Promise<void>;
  selectedProductId: string | null;
  setSelectedProductId: (productId: string) => void;
  subscription: SubscriptionSnapshot | null;
  sync: () => Promise<void>;
};

const SubscriptionContext = createContext<SubscriptionContextValue | null>(null);

export function IapProvider({ children }: PropsWithChildren) {
  const auth = useAuth();

  if (!auth.user || Platform.OS !== 'ios') {
    return (
      <SubscriptionContext.Provider value={unsupportedSubscriptionValue(auth.user?.subscription ?? null)}>
        {children}
      </SubscriptionContext.Provider>
    );
  }

  return <IosIapProvider>{children}</IosIapProvider>;
}

function IosIapProvider({ children }: PropsWithChildren) {
  const auth = useAuth();
  const { api, setSubscription } = auth;
  const user = auth.user;
  const [selectedProductId, setSelectedProductId] = useState<string | null>(iosProductIds[0] ?? null);
  const [error, setError] = useState<string | null>(null);
  const [isLoadingProducts, setIsLoadingProducts] = useState(false);
  const [isPurchasing, setIsPurchasing] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const iapRef = useRef<ReturnType<typeof useIAP> | null>(null);
  const lastReconcileKeyRef = useRef<string | null>(null);
  const processingTransactionsRef = useRef(new Set<string>());

  const handlePurchase = useCallback(
    async (purchase: Purchase) => {
      if (!user) return;

      const signedTransactionInfo = extractSignedTransactionInfo(purchase);
      if (!signedTransactionInfo || processingTransactionsRef.current.has(signedTransactionInfo)) {
        return;
      }

      processingTransactionsRef.current.add(signedTransactionInfo);
      setError(null);

      try {
        const subscription = await ingestAndFinishPurchase({
          purchase,
          ingest: (request) => api.ingestAppStoreTransaction(request),
          finish: (nextPurchase) => {
            if (!iapRef.current) {
              throw new Error('Store connection is not ready.');
            }
            return iapRef.current.finishTransaction({ purchase: nextPurchase, isConsumable: false });
          },
        });
        setSubscription(subscription);
      } catch (caughtError) {
        setError(messageForIapError(caughtError));
      } finally {
        processingTransactionsRef.current.delete(signedTransactionInfo);
        setIsPurchasing(false);
      }
    },
    [api, setSubscription, user],
  );

  const iap = useIAP({
    onPurchaseSuccess: (purchase) => {
      void handlePurchase(purchase);
    },
    onPurchaseError: (purchaseError) => {
      setIsPurchasing(false);
      if (!isUserCancelledPurchaseError(purchaseError)) {
        setError(messageForIapError(purchaseError));
      }
    },
    onError: (caughtError) => {
      setError(messageForIapError(caughtError));
    },
  });
  iapRef.current = iap;
  const {
    availablePurchases,
    connected,
    fetchProducts,
    getAvailablePurchases,
    requestPurchase,
    restorePurchases,
    subscriptions,
  } = iap;

  const loadProducts = useCallback(async () => {
    if (iosProductIds.length === 0) {
      setError('Subscription product IDs are not configured.');
      return;
    }

    setIsLoadingProducts(true);
    setError(null);

    try {
      await fetchProducts({ skus: iosProductIds, type: 'subs' });
    } catch (caughtError) {
      setError(messageForIapError(caughtError));
    } finally {
      setIsLoadingProducts(false);
    }
  }, [fetchProducts]);

  const sync = useCallback(async () => {
    if (!user) return;

    setIsSyncing(true);

    try {
      const entitlement = await auth.api.iapEntitlement();
      setSubscription(entitlement.subscription);

      if (connected) {
        await getAvailablePurchases({
          alsoPublishToEventListenerIOS: false,
          onlyIncludeActiveItemsIOS: true,
        });
      }
    } catch (caughtError) {
      setError(messageForIapError(caughtError));
    } finally {
      setIsSyncing(false);
    }
  }, [api, connected, getAvailablePurchases, setSubscription, user]);

  const purchase = useCallback(async () => {
    if (!user || !selectedProductId) return;

    setIsPurchasing(true);
    setError(null);

    try {
      const result = await requestPurchase(buildSubscriptionPurchaseRequest(selectedProductId, user.id));
      await processPurchaseResult(result, handlePurchase);
    } catch (caughtError) {
      setIsPurchasing(false);
      if (!isUserCancelledPurchaseError(caughtError)) {
        setError(messageForIapError(caughtError));
      }
    }
  }, [handlePurchase, requestPurchase, selectedProductId, user]);

  const restore = useCallback(async () => {
    setIsRestoring(true);
    setError(null);

    try {
      await restorePurchases({
        alsoPublishToEventListenerIOS: false,
        onlyIncludeActiveItemsIOS: true,
      });
      await getAvailablePurchases({
        alsoPublishToEventListenerIOS: false,
        onlyIncludeActiveItemsIOS: true,
      });
    } catch (caughtError) {
      setError(messageForIapError(caughtError));
    } finally {
      setIsRestoring(false);
    }
  }, [getAvailablePurchases, restorePurchases]);

  const manageSubscriptions = useCallback(async () => {
    try {
      await deepLinkToSubscriptions({});
    } catch (caughtError) {
      setError(messageForIapError(caughtError));
    }
  }, []);

  useEffect(() => {
    if (!connected) return;

    void loadProducts();
    void sync();
  }, [connected, loadProducts, sync]);

  useEffect(() => {
    if (subscriptions.length > 0 && !selectedProductId) {
      setSelectedProductId(subscriptions[0]?.id ?? null);
    }
  }, [subscriptions, selectedProductId]);

  useEffect(() => {
    const payload = buildReconcilePayloadFromPurchases(availablePurchases);
    if (!payload || !user) return;

    const reconcileKey = payload.signedTransactions.join('|');
    if (lastReconcileKeyRef.current === reconcileKey) return;
    lastReconcileKeyRef.current = reconcileKey;

    let isMounted = true;
    setIsSyncing(true);

    api
      .reconcileAppStoreTransactions(payload)
      .then((response) => {
        if (isMounted) setSubscription(response.subscription);
      })
      .catch((caughtError: unknown) => {
        if (isMounted) setError(messageForIapError(caughtError));
      })
      .finally(() => {
        if (isMounted) setIsSyncing(false);
      });

    return () => {
      isMounted = false;
    };
  }, [api, availablePurchases, setSubscription, user]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void sync();
      }
    });

    return () => {
      subscription.remove();
    };
  }, [sync]);

  const value = useMemo<SubscriptionContextValue>(
    () => ({
      error,
      isConnected: connected,
      isLoadingProducts,
      isPurchasing,
      isRestoring,
      isSupported: true,
      isSyncing,
      platform: Platform.OS,
      productIds: iosProductIds,
      products: sortProductsByConfiguredOrder(subscriptions, iosProductIds),
      purchase,
      restore,
      manageSubscriptions,
      selectedProductId,
      setSelectedProductId,
      subscription: user?.subscription ?? null,
      sync,
    }),
    [
      error,
      connected,
      isLoadingProducts,
      isPurchasing,
      isRestoring,
      isSyncing,
      manageSubscriptions,
      purchase,
      restore,
      selectedProductId,
      sync,
      user?.subscription,
      subscriptions,
    ],
  );

  return <SubscriptionContext.Provider value={value}>{children}</SubscriptionContext.Provider>;
}

export function useSubscriptionIap() {
  const context = useContext(SubscriptionContext);
  if (!context) {
    throw new Error('useSubscriptionIap must be used inside IapProvider');
  }

  return context;
}

function unsupportedSubscriptionValue(subscription: SubscriptionSnapshot | null): SubscriptionContextValue {
  return {
    error: null,
    isConnected: false,
    isLoadingProducts: false,
    isPurchasing: false,
    isRestoring: false,
    isSupported: false,
    isSyncing: false,
    platform: Platform.OS,
    productIds: [],
    products: [],
    purchase: async () => undefined,
    restore: async () => undefined,
    manageSubscriptions: async () => undefined,
    selectedProductId: null,
    setSelectedProductId: () => undefined,
    subscription,
    sync: async () => undefined,
  };
}

function messageForIapError(error: unknown) {
  if (error instanceof ApiRequestError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Unexpected subscription error.';
}
