import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type LoginRequest,
  type RefreshResponse,
  type RegisterRequest,
  type UserDto,
} from '@web-app-demo/contracts';
import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { ApiClient } from './api';
import {
  clearStoredRefreshToken,
  getStoredRefreshToken,
  setStoredRefreshToken,
} from './token-store';

type AuthContextValue = {
  user: UserDto | null;
  isBootstrapping: boolean;
  isAuthenticated: boolean;
  register: (input: RegisterRequest) => Promise<void>;
  login: (input: LoginRequest) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);
const meQueryKey = ['auth', 'me'] as const;
let bootstrapRefreshPromise: Promise<RefreshResponse | null> | null = null;

export function AuthProvider({ children }: PropsWithChildren) {
  const queryClient = useQueryClient();
  const accessTokenRef = useRef<string | null>(null);
  const [accessToken, setAccessTokenState] = useState<string | null>(null);
  const [isBootstrapping, setIsBootstrapping] = useState(true);

  const setAccessToken = useCallback((nextAccessToken: string | null) => {
    accessTokenRef.current = nextAccessToken;
    setAccessTokenState(nextAccessToken);
  }, []);
  const handleAuthExpired = useCallback(async () => {
    setAccessToken(null);
    await clearStoredRefreshToken();
    queryClient.removeQueries({ queryKey: meQueryKey });
  }, [queryClient, setAccessToken]);

  const api = useMemo(
    () =>
      new ApiClient({
        getAccessToken: () => accessTokenRef.current,
        setAccessToken,
        getRefreshToken: getStoredRefreshToken,
        setRefreshToken: setStoredRefreshToken,
        clearRefreshToken: clearStoredRefreshToken,
        onAuthExpired: handleAuthExpired,
      }),
    [handleAuthExpired, setAccessToken],
  );

  useEffect(() => {
    let isMounted = true;

    refreshBootstrapSession(api)
      .then(async (response) => {
        if (!isMounted || !response) return;
        setAccessToken(response.accessToken);

        if (response.refreshToken) {
          await setStoredRefreshToken(response.refreshToken);
        }
      })
      .catch(async () => {
        if (!isMounted) return;
        setAccessToken(null);
        await clearStoredRefreshToken();
      })
      .finally(() => {
        if (isMounted) {
          setIsBootstrapping(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [api, setAccessToken]);

  const meQuery = useQuery({
    queryKey: meQueryKey,
    enabled: !isBootstrapping && Boolean(accessToken),
    queryFn: () => api.me(),
  });
  const user = meQuery.data?.user ?? null;
  const isResolvingUser = !isBootstrapping && Boolean(accessToken) && !user && meQuery.isPending;
  const isAuthBootstrapping = isBootstrapping || isResolvingUser;

  const register = useCallback(
    async (input: RegisterRequest) => {
      const response = await api.register(input);
      setAccessToken(response.accessToken);

      if (response.refreshToken) {
        await setStoredRefreshToken(response.refreshToken);
      }

      queryClient.setQueryData(meQueryKey, { user: response.user });
    },
    [api, queryClient, setAccessToken],
  );

  const login = useCallback(
    async (input: LoginRequest) => {
      const response = await api.login(input);
      setAccessToken(response.accessToken);

      if (response.refreshToken) {
        await setStoredRefreshToken(response.refreshToken);
      }

      queryClient.setQueryData(meQueryKey, { user: response.user });
    },
    [api, queryClient, setAccessToken],
  );

  const logout = useCallback(async () => {
    await api.logout().catch(() => undefined);
    setAccessToken(null);
    await clearStoredRefreshToken();
    queryClient.removeQueries({ queryKey: meQueryKey });
  }, [api, queryClient, setAccessToken]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isBootstrapping: isAuthBootstrapping,
      isAuthenticated: Boolean(user),
      register,
      login,
      logout,
    }),
    [isAuthBootstrapping, login, logout, register, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider');
  }

  return context;
}

function refreshBootstrapSession(api: ApiClient) {
  bootstrapRefreshPromise ??= getStoredRefreshToken()
    .then((refreshToken) => {
      if (!refreshToken) return null;
      return api.refresh();
    })
    .finally(() => {
      bootstrapRefreshPromise = null;
    });

  return bootstrapRefreshPromise;
}
