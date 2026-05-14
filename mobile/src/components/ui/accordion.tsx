import type { ReactNode } from 'react';
import React, { createContext, useContext } from 'react';
import { StyleSheet, View, type PressableProps, type ViewProps } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { Button } from './button';
import { useControllableState } from './controllable-state';
import { Separator } from './separator';
import { renderTextChild } from './primitives';
import { useUiTheme } from './theme';

type AccordionContextValue = {
  type: 'single' | 'multiple';
  value: string | string[];
  setValue: (value: string | string[]) => void;
};

type AccordionItemContextValue = {
  value: string;
  open: boolean;
  toggle: () => void;
};

const AccordionContext = createContext<AccordionContextValue | null>(null);
const AccordionItemContext = createContext<AccordionItemContextValue | null>(null);

export function Accordion({
  type = 'single',
  value,
  defaultValue,
  onValueChange,
  children,
  style,
  ...props
}: ViewProps & {
  type?: 'single' | 'multiple';
  value?: string | string[];
  defaultValue?: string | string[];
  onValueChange?: (value: string | string[]) => void;
  children?: ReactNode;
}) {
  const [currentValue, setValue] = useControllableState<string | string[]>({
    value,
    defaultValue: defaultValue ?? (type === 'multiple' ? [] : ''),
    onChange: onValueChange,
  });

  return (
    <AccordionContext.Provider value={{ type, value: currentValue, setValue }}>
      <View {...props} style={[styles.root, style]}>
        {children}
      </View>
    </AccordionContext.Provider>
  );
}

export function AccordionItem({ value, children, style, ...props }: ViewProps & { value: string; children?: ReactNode }) {
  const context = useContext(AccordionContext);
  const currentValue = context?.value;
  const open = Array.isArray(currentValue) ? currentValue.includes(value) : currentValue === value;

  function toggle() {
    if (!context) return;

    if (context.type === 'multiple') {
      const values = Array.isArray(context.value) ? context.value : [];
      context.setValue(values.includes(value) ? values.filter((item) => item !== value) : [...values, value]);
      return;
    }

    context.setValue(open ? '' : value);
  }

  return (
    <AccordionItemContext.Provider value={{ value, open, toggle }}>
      <View {...props} style={[styles.item, style]}>
        {children}
        <Separator />
      </View>
    </AccordionItemContext.Provider>
  );
}

export function AccordionTrigger({ children, ...props }: PressableProps & { children?: ReactNode }) {
  const context = useContext(AccordionItemContext);
  return (
    <Button
      {...props}
      variant="ghost"
      style={styles.trigger}
      onPress={(event) => {
        props.onPress?.(event);
        context?.toggle();
      }}>
      {children}
      {context?.open ? ' v' : ' >'}
    </Button>
  );
}

export function AccordionContent({ children, style, ...props }: ViewProps & { children?: ReactNode }) {
  const context = useContext(AccordionItemContext);
  const theme = useUiTheme();
  if (!context?.open) return null;

  return (
    <Animated.View entering={FadeIn.duration(160)}>
      <View {...props} style={[styles.content, { paddingBottom: theme.spacing.md }, style]}>
        {renderTextChild(children)}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 4,
  },
  item: {
    gap: 8,
  },
  root: {
    gap: 8,
  },
  trigger: {
    justifyContent: 'space-between',
  },
});
