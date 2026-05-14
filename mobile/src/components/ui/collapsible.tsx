import type { ReactNode } from 'react';
import React, { createContext, useContext } from 'react';
import { StyleSheet, View, type PressableProps, type StyleProp, type ViewProps, type ViewStyle } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { Button } from './button';
import { useControllableState } from './controllable-state';
import { renderTextChild, Surface } from './primitives';
import { useUiTheme } from './theme';

type CollapsibleContextValue = {
  open: boolean;
  setOpen: (open: boolean) => void;
};

const CollapsibleContext = createContext<CollapsibleContextValue | null>(null);

export function Collapsible({
  children,
  open,
  defaultOpen = false,
  onOpenChange,
  title,
  style,
  ...props
}: ViewProps & {
  children?: ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  title?: string;
}) {
  const [isOpen, setOpen] = useControllableState({
    value: open,
    defaultValue: defaultOpen,
    onChange: onOpenChange,
  });

  return (
    <CollapsibleContext.Provider value={{ open: isOpen, setOpen }}>
      <View {...props} style={[styles.root, style]}>
        {title ? (
          <>
            <CollapsibleTrigger>{title}</CollapsibleTrigger>
            <CollapsibleContent>{children}</CollapsibleContent>
          </>
        ) : (
          children
        )}
      </View>
    </CollapsibleContext.Provider>
  );
}

export function CollapsibleTrigger({
  children,
  ...props
}: Omit<PressableProps, 'style'> & { children?: ReactNode; style?: StyleProp<ViewStyle> }) {
  const context = useContext(CollapsibleContext);
  return (
    <Button
      {...props}
      variant="ghost"
      onPress={(event) => {
        props.onPress?.(event);
        context?.setOpen(!context.open);
      }}>
      {context?.open ? 'v ' : '> '}
      {children}
    </Button>
  );
}

export function CollapsibleContent({ children, style, ...props }: ViewProps & { children?: ReactNode }) {
  const context = useContext(CollapsibleContext);
  const theme = useUiTheme();
  if (!context?.open) return null;

  return (
    <Animated.View entering={FadeIn.duration(160)}>
      <Surface {...props} tone="muted" rounded="xl" style={[styles.content, { padding: theme.spacing.lg }, style]}>
        {renderTextChild(children)}
      </Surface>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  content: {
    marginTop: 8,
  },
  root: {
    gap: 8,
  },
});
