import type { SubscriptionSnapshot } from '@web-app-demo/contracts';
import {
  deepLinkToSubscriptions,
  presentCodeRedemptionSheetIOS,
  useIAP,
  type ProductSubscription,
  type Purchase,
  type PurchaseOptions,
} from 'expo-iap';
import { createContext, type PropsWithChildren, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';

import { ApiRequestError } from './api';
import { useAuth } from './auth';
import { trackIapDiagnostic } from './iap-diagnostics';
import {
  buildReconcilePayloadFromPurchases,
  buildSubscriptionPurchaseRequest,
  friendlyIapErrorMessage,
  getIapErrorCode,
  ingestAndFinishPurchase,
  isNetworkIapError,
  isPostSuccessNoiseError,
  isRetryableIapError,
  isUserCancelledPurchaseError,
  retryIapOperation,
  sortProductsByConfiguredOrder,
  validateAppStorePurchaseForIngest,
} from './iap-utils';

const iosProductIds = [
  process.env.EXPO_PUBLIC_IAP_IOS_MONTHLY_PRODUCT_ID,
  process.env.EXPO_PUBLIC_IAP_IOS_YEARLY_PRODUCT_ID,
]
  .map((productId) => productId?.trim())
  .filter((productId): productId is string => Boolean(productId));
const offerCodeRedemptionClientTtlMs = 14 * 60 * 1000;
const allIosAvailablePurchaseOptions: PurchaseOptions = {
  alsoPublishToEventListenerIOS: false,
  onlyIncludeActiveItemsIOS: false,
};

type OfferCodeRedemptionSession = {
  expiresAtMs: number;
  token: string;
};

type AvailablePurchasesReconciliation = {
  finishPurchases: boolean;
  hasKnownOriginalTransaction: boolean;
  id: number;
  kind: 'restore' | 'sync';
  originalTransactionIds?: string[];
  restoreError?: unknown;
};

type SubscriptionContextValue = {
  error: string | null;
  isConnected: boolean;
  isLoadingProducts: boolean;
  isManagingSubscriptions: boolean;
  isPurchasing: boolean;
  isRedeemingOfferCode: boolean;
  isRestoring: boolean;
  isSupported: boolean;
  isSyncing: boolean;
  platform: typeof Platform.OS;
  productIds: string[];
  products: ProductSubscription[];
  purchase: () => Promise<void>;
  redeemOfferCode: () => Promise<void>;
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

  if (Platform.OS !== 'ios') {
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
  const userId = user?.id ?? null;
  const [selectedProductId, setSelectedProductId] = useState<string | null>(iosProductIds[0] ?? null);
  const [error, setError] = useState<string | null>(null);
  const [isLoadingProducts, setIsLoadingProducts] = useState(false);
  const [isManagingSubscriptions, setIsManagingSubscriptions] = useState(false);
  const [isPurchasing, setIsPurchasing] = useState(false);
  const [isRedeemingOfferCode, setIsRedeemingOfferCode] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const iapRef = useRef<ReturnType<typeof useIAP> | null>(null);
  const inFlightReconcileKeysRef = useRef(new Set<string>());
  const purchaseRequestInFlightRef = useRef(false);
  const processingTransactionsRef = useRef(new Set<string>());
  const processedTransactionsRef = useRef(new Set<string>());
  const handledAvailablePurchasesReconciliationIdsRef = useRef(new Set<number>());
  const nextAvailablePurchasesReconciliationIdRef = useRef(0);
  const pendingAvailablePurchasesReconciliationRef = useRef<AvailablePurchasesReconciliation | null>(null);
  const queuedPurchaseKeysRef = useRef(new Set<string>());
  const queuedPurchasesRef = useRef<Purchase[]>([]);
  const lastPurchaseSuccessAtRef = useRef<number | null>(null);
  const offerCodeRedemptionTokenRef = useRef<OfferCodeRedemptionSession | null>(null);

  const queuePurchaseUntilAuthenticated = useCallback((purchase: Purchase) => {
    const queueKey = purchaseQueueKey(purchase);
    if (queueKey && queuedPurchaseKeysRef.current.has(queueKey)) return;

    if (queueKey) {
      queuedPurchaseKeysRef.current.add(queueKey);
    }
    queuedPurchasesRef.current.push(purchase);
  }, []);

  const handlePurchase = useCallback(
    async (purchase: Purchase) => {
      if (!userId) {
        queuePurchaseUntilAuthenticated(purchase);
        purchaseRequestInFlightRef.current = false;
        setIsPurchasing(false);
        return;
      }

      const validation = validateAppStorePurchaseForIngest(purchase);
      if (!validation.ok) {
        if (!validation.pending) {
          reportIapDiagnostic('purchase-invalid', validation.message);
        }
        setError(validation.message);
        purchaseRequestInFlightRef.current = false;
        setIsPurchasing(false);
        return;
      }

      if (processedTransactionsRef.current.has(validation.transactionKey)) {
        purchaseRequestInFlightRef.current = false;
        setIsPurchasing(false);
        return;
      }

      if (processingTransactionsRef.current.has(validation.transactionKey)) {
        return;
      }

      processingTransactionsRef.current.add(validation.transactionKey);
      setIsPurchasing(true);
      setError(null);

      try {
        const offerCodeRedemptionToken = currentOfferCodeRedemptionToken(offerCodeRedemptionTokenRef.current);
        if (!offerCodeRedemptionToken) {
          offerCodeRedemptionTokenRef.current = null;
        }
        const result = await ingestAndFinishPurchase({
          purchase,
          signedTransactionInfo: validation.signedTransactionInfo,
          ingest: (request) =>
            api.ingestAppStoreTransaction({
              ...request,
              ...(offerCodeRedemptionToken ? { offerCodeRedemptionToken } : {}),
            }),
          finish: (nextPurchase) => {
            if (!iapRef.current) {
              throw new Error('Store connection is not ready.');
            }
            return iapRef.current.finishTransaction({ purchase: nextPurchase, isConsumable: false });
          },
        });
        offerCodeRedemptionTokenRef.current = null;
        setSubscription(result.subscription);
        if (result.finishError) {
          reportIapDiagnostic('purchase-finish-error', result.finishError);
        } else {
          processedTransactionsRef.current.add(validation.transactionKey);
        }
        lastPurchaseSuccessAtRef.current = Date.now();
      } catch (caughtError) {
        reportIapDiagnostic('purchase-ingest-error', caughtError);
        setError(messageForIapError(caughtError));
      } finally {
        purchaseRequestInFlightRef.current = false;
        processingTransactionsRef.current.delete(validation.transactionKey);
        setIsPurchasing(false);
      }
    },
    [api, queuePurchaseUntilAuthenticated, setSubscription, userId],
  );

  const iap = useIAP({
    onPurchaseSuccess: (purchase) => {
      void handlePurchase(purchase);
    },
    onPurchaseError: (purchaseError) => {
      purchaseRequestInFlightRef.current = false;
      setIsPurchasing(false);
      if (!isUserCancelledPurchaseError(purchaseError)) {
        if (shouldSuppressPostSuccessError(purchaseError, lastPurchaseSuccessAtRef.current)) {
          return;
        }
        reportIapDiagnostic('purchase-error', purchaseError);
        setError(messageForIapError(purchaseError));
      }
    },
    onError: (caughtError) => {
      if (isUserCancelledPurchaseError(caughtError)) {
        return;
      }
      reportIapDiagnostic('iap-error', caughtError);
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
      await retryIapOperation(() => fetchProducts({ skus: iosProductIds, type: 'subs' }));
    } catch (caughtError) {
      reportIapDiagnostic('product-fetch-error', caughtError);
      setError(messageForIapError(caughtError));
    } finally {
      setIsLoadingProducts(false);
    }
  }, [fetchProducts]);

  const reconcileAndFinishPurchases = useCallback(
    async ({
      finishPurchases,
      originalTransactionIds,
      purchases,
    }: {
      finishPurchases: boolean;
      originalTransactionIds?: string[];
      purchases: Purchase[];
    }) => {
      let firstError: unknown = null;
      let latestSubscription: SubscriptionSnapshot | null = null;
      let pendingPurchaseMessage: string | null = null;

      if (finishPurchases) {
        for (const purchase of purchases) {
          const validation = validateAppStorePurchaseForIngest(purchase);
          if (!validation.ok) {
            if (validation.pending) {
              pendingPurchaseMessage ??= validation.message;
            }
            continue;
          }

          if (
            processedTransactionsRef.current.has(validation.transactionKey) ||
            processingTransactionsRef.current.has(validation.transactionKey)
          ) {
            continue;
          }

          const reconcileKey = `signed:${validation.signedTransactionInfo}`;
          if (inFlightReconcileKeysRef.current.has(reconcileKey)) {
            continue;
          }

          inFlightReconcileKeysRef.current.add(reconcileKey);
          processingTransactionsRef.current.add(validation.transactionKey);

          try {
            const offerCodeRedemptionToken = currentOfferCodeRedemptionToken(offerCodeRedemptionTokenRef.current);
            if (!offerCodeRedemptionToken) {
              offerCodeRedemptionTokenRef.current = null;
            }
            const result = await ingestAndFinishPurchase({
              purchase,
              signedTransactionInfo: validation.signedTransactionInfo,
              ingest: (request) =>
                api.ingestAppStoreTransaction({
                  ...request,
                  ...(offerCodeRedemptionToken ? { offerCodeRedemptionToken } : {}),
                }),
              finish: (nextPurchase) => {
                if (!iapRef.current) {
                  throw new Error('Store connection is not ready.');
                }
                return iapRef.current.finishTransaction({ purchase: nextPurchase, isConsumable: false });
              },
            });
            offerCodeRedemptionTokenRef.current = null;
            setSubscription(result.subscription);
            latestSubscription = result.subscription;

            if (result.finishError) {
              reportIapDiagnostic('available-purchase-finish-error', result.finishError);
            } else {
              processedTransactionsRef.current.add(validation.transactionKey);
            }
          } catch (caughtError) {
            firstError ??= caughtError;
            reportIapDiagnostic('available-purchase-ingest-error', caughtError);
          } finally {
            processingTransactionsRef.current.delete(validation.transactionKey);
            inFlightReconcileKeysRef.current.delete(reconcileKey);
          }
        }
      }

      const originalPayload = buildReconcilePayloadFromPurchases([], originalTransactionIds);
      if (!originalPayload) {
        if (latestSubscription) return latestSubscription;
        if (firstError) throw firstError;
        if (pendingPurchaseMessage) {
          setError(pendingPurchaseMessage);
        }
        return null;
      }

      const originalReconcileKey = (originalPayload.originalTransactionIds ?? [])
        .map((transactionId) => `original:${transactionId}`)
        .join('|');

      if (inFlightReconcileKeysRef.current.has(originalReconcileKey)) {
        if (latestSubscription) return latestSubscription;
        if (firstError) throw firstError;
        return null;
      }

      inFlightReconcileKeysRef.current.add(originalReconcileKey);
      try {
        const response = await api.reconcileAppStoreTransactions(originalPayload);
        setSubscription(response.subscription);
        if (pendingPurchaseMessage && !response.subscription.isActive) {
          setError(pendingPurchaseMessage);
        }
        return response.subscription;
      } finally {
        inFlightReconcileKeysRef.current.delete(originalReconcileKey);
      }
    },
    [api, setSubscription],
  );

  useEffect(() => {
    const pendingReconciliation = pendingAvailablePurchasesReconciliationRef.current;
    if (!pendingReconciliation) return;
    if (handledAvailablePurchasesReconciliationIdsRef.current.has(pendingReconciliation.id)) return;

    handledAvailablePurchasesReconciliationIdsRef.current.add(pendingReconciliation.id);
    pendingAvailablePurchasesReconciliationRef.current = null;

    void (async () => {
      try {
        const subscription = await reconcileAndFinishPurchases({
          finishPurchases: pendingReconciliation.finishPurchases,
          originalTransactionIds: pendingReconciliation.originalTransactionIds,
          purchases: availablePurchases,
        });

        if (pendingReconciliation.kind === 'restore') {
          if (
            pendingReconciliation.restoreError &&
            availablePurchases.length === 0 &&
            !subscription?.isActive
          ) {
            setError(messageForIapError(pendingReconciliation.restoreError));
          } else if (!subscription && availablePurchases.length === 0) {
            setError(
              pendingReconciliation.restoreError
                ? messageForIapError(pendingReconciliation.restoreError)
                : pendingReconciliation.hasKnownOriginalTransaction
                  ? 'Apple did not return an active subscription for this account. Please try again.'
                  : 'No restorable App Store subscription was found for this account.',
            );
          }
        }
      } catch (caughtError) {
        reportIapDiagnostic(
          pendingReconciliation.kind === 'restore' ? 'restore-error' : 'subscription-sync-error',
          caughtError,
        );
        setError(messageForIapError(caughtError));
      } finally {
        if (pendingReconciliation.kind === 'restore') {
          setIsRestoring(false);
        } else {
          setIsSyncing(false);
        }
      }
    })();
  }, [availablePurchases, reconcileAndFinishPurchases]);

  const sync = useCallback(async () => {
    if (!userId) return;

    setIsSyncing(true);
    let waitingForAvailablePurchasesState = false;

    try {
      const entitlement = await api.iapEntitlement();
      setSubscription(entitlement.subscription);
      const originalTransactionIds = entitlement.subscription.originalTransactionId
        ? [entitlement.subscription.originalTransactionId]
        : undefined;

      if (connected) {
        const reconciliationId = nextAvailablePurchasesReconciliationIdRef.current + 1;
        nextAvailablePurchasesReconciliationIdRef.current = reconciliationId;
        pendingAvailablePurchasesReconciliationRef.current = {
          finishPurchases: true,
          hasKnownOriginalTransaction: Boolean(originalTransactionIds),
          id: reconciliationId,
          kind: 'sync',
          originalTransactionIds,
        };

        try {
          await retryIapOperation(() => getAvailablePurchases(allIosAvailablePurchaseOptions));
          waitingForAvailablePurchasesState = true;
          return;
        } catch (storeError) {
          pendingAvailablePurchasesReconciliationRef.current = null;
          if (!originalTransactionIds) {
            throw storeError;
          }
          reportIapDiagnostic('available-purchases-error', storeError);
        }
      }

      if (originalTransactionIds) {
        await reconcileAndFinishPurchases({
          finishPurchases: false,
          originalTransactionIds,
          purchases: [],
        });
      }
    } catch (caughtError) {
      reportIapDiagnostic('subscription-sync-error', caughtError);
      setError(messageForIapError(caughtError));
    } finally {
      if (!waitingForAvailablePurchasesState) {
        setIsSyncing(false);
      }
    }
  }, [api, connected, getAvailablePurchases, reconcileAndFinishPurchases, setSubscription, userId]);

  const purchase = useCallback(async () => {
    if (!user || !selectedProductId) return;
    if (purchaseRequestInFlightRef.current) return;

    if (!connected) {
      setError('App Store connection is not ready yet. Please try again in a moment.');
      return;
    }

    const selectedProduct = subscriptions.find((product) => product.id === selectedProductId);
    if (!selectedProduct) {
      setError('Selected subscription is not available in the App Store yet.');
      return;
    }

    setIsPurchasing(true);
    purchaseRequestInFlightRef.current = true;
    setError(null);

    try {
      await requestPurchase(buildSubscriptionPurchaseRequest(selectedProduct.id, user.id));
    } catch (caughtError) {
      purchaseRequestInFlightRef.current = false;
      setIsPurchasing(false);
      if (!isUserCancelledPurchaseError(caughtError)) {
        reportIapDiagnostic('purchase-request-error', caughtError);
        setError(messageForIapError(caughtError));
      }
    }
  }, [connected, requestPurchase, selectedProductId, subscriptions, user]);

  const restore = useCallback(async () => {
    if (!user) return;

    if (!connected) {
      setError('App Store connection is not ready yet. Please try again in a moment.');
      return;
    }

    setIsRestoring(true);
    setError(null);
    let waitingForAvailablePurchasesState = false;

    try {
      let restoreError: unknown = null;
      let restoreCancelled = false;
      await restorePurchases(allIosAvailablePurchaseOptions).catch((caughtError) => {
        if (isUserCancelledPurchaseError(caughtError)) {
          restoreCancelled = true;
          return;
        }
        restoreError = caughtError;
        reportIapDiagnostic('storekit-restore-sync-error', caughtError);
      });
      if (restoreCancelled) return;

      const originalTransactionIds = user.subscription.originalTransactionId
        ? [user.subscription.originalTransactionId]
        : undefined;
      const reconciliationId = nextAvailablePurchasesReconciliationIdRef.current + 1;
      nextAvailablePurchasesReconciliationIdRef.current = reconciliationId;
      pendingAvailablePurchasesReconciliationRef.current = {
        finishPurchases: true,
        hasKnownOriginalTransaction: Boolean(originalTransactionIds),
        id: reconciliationId,
        kind: 'restore',
        originalTransactionIds,
        restoreError,
      };
      await retryIapOperation(() => getAvailablePurchases(allIosAvailablePurchaseOptions));
      waitingForAvailablePurchasesState = true;
    } catch (caughtError) {
      pendingAvailablePurchasesReconciliationRef.current = null;
      reportIapDiagnostic('restore-error', caughtError);
      setError(messageForIapError(caughtError));
    } finally {
      if (!waitingForAvailablePurchasesState) {
        setIsRestoring(false);
      }
    }
  }, [connected, getAvailablePurchases, restorePurchases, user]);

  const redeemOfferCode = useCallback(async () => {
    if (!user) return;
    if (!connected) {
      setError('App Store connection is not ready yet. Please try again in a moment.');
      return;
    }

    setIsRedeemingOfferCode(true);
    setError(null);

    try {
      const response = await api.createAppStoreOfferCodeRedemption();
      offerCodeRedemptionTokenRef.current = {
        expiresAtMs: Date.now() + offerCodeRedemptionClientTtlMs,
        token: response.token,
      };
      const presented = await presentCodeRedemptionSheetIOS();
      if (presented === false) {
        throw new Error('App Store offer code sheet could not be opened.');
      }
      await sync();
    } catch (caughtError) {
      offerCodeRedemptionTokenRef.current = null;
      if (isUserCancelledPurchaseError(caughtError)) {
        return;
      }
      reportIapDiagnostic('offer-code-redemption-error', caughtError);
      setError(messageForIapError(caughtError));
    } finally {
      setIsRedeemingOfferCode(false);
    }
  }, [api, connected, sync, user]);

  const manageSubscriptions = useCallback(async () => {
    if (!connected) {
      setError('App Store connection is not ready yet. Please try again in a moment.');
      return;
    }

    setIsManagingSubscriptions(true);
    setError(null);

    try {
      await deepLinkToSubscriptions({});
    } catch (caughtError) {
      if (isUserCancelledPurchaseError(caughtError)) {
        return;
      }
      setError(messageForIapError(caughtError));
    } finally {
      setIsManagingSubscriptions(false);
    }
  }, [connected]);

  useEffect(() => {
    if (connected && userId) {
      void loadProducts();
    }
    void sync();
  }, [connected, loadProducts, sync, userId]);

  useEffect(() => {
    if (!userId || queuedPurchasesRef.current.length === 0) return;

    const queuedPurchases = queuedPurchasesRef.current;
    queuedPurchasesRef.current = [];
    queuedPurchaseKeysRef.current.clear();

    for (const purchase of queuedPurchases) {
      void handlePurchase(purchase);
    }
  }, [handlePurchase, userId]);

  useEffect(() => {
    if (subscriptions.length === 0) return;

    const orderedSubscriptions = sortProductsByConfiguredOrder(subscriptions, iosProductIds);
    if (!selectedProductId || !orderedSubscriptions.some((product) => product.id === selectedProductId)) {
      setSelectedProductId(orderedSubscriptions[0]?.id ?? null);
    }
  }, [subscriptions, selectedProductId]);

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
      isManagingSubscriptions,
      isPurchasing,
      isRedeemingOfferCode,
      isRestoring,
      isSupported: true,
      isSyncing,
      platform: Platform.OS,
      productIds: iosProductIds,
      products: sortProductsByConfiguredOrder(subscriptions, iosProductIds),
      purchase,
      redeemOfferCode,
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
      isManagingSubscriptions,
      isPurchasing,
      isRedeemingOfferCode,
      isRestoring,
      isSyncing,
      manageSubscriptions,
      purchase,
      redeemOfferCode,
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
    isManagingSubscriptions: false,
    isPurchasing: false,
    isRedeemingOfferCode: false,
    isRestoring: false,
    isSupported: false,
    isSyncing: false,
    platform: Platform.OS,
    productIds: [],
    products: [],
    purchase: async () => undefined,
    redeemOfferCode: async () => undefined,
    restore: async () => undefined,
    manageSubscriptions: async () => undefined,
    selectedProductId: null,
    setSelectedProductId: () => undefined,
    subscription,
    sync: async () => undefined,
  };
}

function currentOfferCodeRedemptionToken(session: OfferCodeRedemptionSession | null) {
  if (!session) return undefined;
  return session.expiresAtMs > Date.now() ? session.token : undefined;
}

function purchaseQueueKey(purchase: Purchase) {
  const validation = validateAppStorePurchaseForIngest(purchase);
  if (validation.ok) return validation.transactionKey;

  return purchase.transactionId?.trim() || purchase.purchaseToken?.trim() || null;
}

function messageForIapError(error: unknown) {
  if (error instanceof ApiRequestError) {
    switch (error.code) {
      case 'IAP_NOT_CONFIGURED':
        return 'Subscriptions are not configured on the server yet.';
      case 'IAP_INVALID_TRANSACTION':
        return 'The App Store transaction could not be verified. Use Restore purchases or try again.';
      case 'IAP_OWNERSHIP_MISMATCH':
        return 'This App Store purchase is linked to another account.';
      default:
        return error.message;
    }
  }

  return friendlyIapErrorMessage(error);
}

function shouldSuppressPostSuccessError(error: unknown, lastPurchaseSuccessAt: number | null) {
  return (
    Boolean(lastPurchaseSuccessAt) &&
    isPostSuccessNoiseError(error) &&
    Date.now() - Number(lastPurchaseSuccessAt) < 5_000
  );
}

function reportIapDiagnostic(event: string, error: unknown) {
  const code = typeof error === 'string' ? null : getIapErrorCode(error);
  const network = typeof error === 'string' ? false : isNetworkIapError(error);
  const retryable = typeof error === 'string' ? false : isRetryableIapError(error);
  const debugMessage = diagnosticStringField(error, 'debugMessage');
  const message = diagnosticMessage(error);
  const platform = diagnosticStringField(error, 'platform') ?? Platform.OS;
  const productId = diagnosticStringField(error, 'productId');
  const responseCode = diagnosticNumberField(error, 'responseCode');
  const underlyingError = diagnosticStringField(error, 'underlyingError');
  trackIapDiagnostic(event, {
    code,
    debugMessage,
    message,
    network,
    platform,
    productId,
    responseCode,
    retryable,
    underlyingError,
  });
}

function diagnosticMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (!isRecord(error)) return undefined;

  return diagnosticString(error.message);
}

function diagnosticStringField(error: unknown, field: 'debugMessage' | 'platform' | 'productId' | 'underlyingError') {
  if (!isRecord(error)) return undefined;

  return diagnosticString(error[field]);
}

function diagnosticString(value: unknown) {
  if (value instanceof Error) return value.message;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);

  return undefined;
}

function diagnosticNumberField(error: unknown, field: 'responseCode') {
  if (!isRecord(error)) return undefined;

  const value = error[field];
  return typeof value === 'number' ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object';
}
