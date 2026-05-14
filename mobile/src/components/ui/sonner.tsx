import type { ReactNode } from 'react';
import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Surface, Typography } from './primitives';
import { useUiTheme } from './theme';

type ToastType = 'success' | 'info' | 'warning' | 'error' | 'loading';

type Toast = {
  id: number;
  title: ReactNode;
  description?: ReactNode;
  type?: ToastType;
};

type ToasterContextValue = {
  toast: (toast: Omit<Toast, 'id'>) => void;
};

const ToasterContext = createContext<ToasterContextValue | null>(null);

export function Toaster({ children }: { children?: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const showToast = useCallback((toast: Omit<Toast, 'id'>) => {
    const id = Date.now();
    setToasts((currentToasts) => [...currentToasts, { ...toast, id }]);
    setTimeout(() => {
      setToasts((currentToasts) => currentToasts.filter((currentToast) => currentToast.id !== id));
    }, toast.type === 'loading' ? 4000 : 2600);
  }, []);
  const value = useMemo(() => ({ toast: showToast }), [showToast]);
  const theme = useUiTheme();

  return (
    <ToasterContext.Provider value={value}>
      {children}
      <View pointerEvents="none" style={styles.host}>
        {toasts.map((toast) => (
          <Surface key={toast.id} tone="popover" bordered rounded="xl" style={styles.toast}>
            <Typography variant="bodySm" weight="700" style={{ color: toastColor(toast.type, theme.colors.foreground, theme.colors.destructive) }}>
              {toast.title}
            </Typography>
            {toast.description ? <Typography variant="caption" muted>{toast.description}</Typography> : null}
          </Surface>
        ))}
      </View>
    </ToasterContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToasterContext);
  if (!context) {
    return { toast: () => undefined };
  }
  return context;
}

function toastColor(type: ToastType | undefined, foreground: string, destructive: string) {
  if (type === 'error' || type === 'warning') return destructive;
  return foreground;
}

const styles = StyleSheet.create({
  host: {
    bottom: 24,
    gap: 8,
    left: 16,
    position: 'absolute',
    right: 16,
  },
  toast: {
    padding: 14,
  },
});
