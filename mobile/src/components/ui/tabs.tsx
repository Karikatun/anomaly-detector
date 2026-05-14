import type { ReactNode } from 'react';
import React, { createContext, useContext } from 'react';
import { StyleSheet, View, type ViewProps } from 'react-native';

import { Button, type ButtonProps } from './button';
import { useControllableState } from './controllable-state';
import { renderTextChild, Surface } from './primitives';
import { useUiTheme } from './theme';

type TabsContextValue = {
  value?: string;
  onValueChange: (value: string) => void;
};

const TabsContext = createContext<TabsContextValue | null>(null);

export function tabsListVariants(options?: { variant?: 'default' | 'outline' }) {
  return options ?? {};
}

export function Tabs({
  value,
  defaultValue,
  onValueChange,
  children,
  style,
  ...props
}: ViewProps & {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  children?: ReactNode;
}) {
  const [currentValue, setValue] = useControllableState({
    value,
    defaultValue: defaultValue ?? '',
    onChange: onValueChange,
  });

  return (
    <TabsContext.Provider value={{ value: currentValue, onValueChange: (nextValue) => setValue(nextValue) }}>
      <View {...props} style={[styles.tabs, style]}>
        {children}
      </View>
    </TabsContext.Provider>
  );
}

export function TabsList({ children, style, ...props }: ViewProps & { children?: ReactNode }) {
  const theme = useUiTheme();
  return (
    <Surface
      {...props}
      tone="muted"
      rounded="full"
      style={[styles.list, { padding: theme.spacing.xs }, style]}>
      {children}
    </Surface>
  );
}

export function TabsTrigger({ value, children, ...props }: ButtonProps & { value: string }) {
  const context = useContext(TabsContext);
  const isSelected = context?.value === value;
  const isDisabled = props.disabled === true;

  return (
    <Button
      {...props}
      variant={isSelected ? 'secondary' : 'ghost'}
      accessibilityState={{ selected: isSelected, disabled: isDisabled }}
      onPress={(event) => {
        props.onPress?.(event);
        context?.onValueChange(value);
      }}>
      {children}
    </Button>
  );
}

export function TabsContent({ value, children, style, ...props }: ViewProps & { value: string; children?: ReactNode }) {
  const context = useContext(TabsContext);
  if (context?.value !== value) return null;

  return (
    <View {...props} style={[styles.content, style]}>
      {renderTextChild(children)}
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    marginTop: 12,
  },
  list: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    gap: 4,
  },
  tabs: {
    width: '100%',
  },
});
