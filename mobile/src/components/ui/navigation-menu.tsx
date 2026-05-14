import type { ReactNode } from 'react';
import {
  StyleSheet,
  View,
  type PressableProps,
  type StyleProp,
  type ViewProps,
  type ViewStyle,
} from 'react-native';

import { Button, type ButtonProps } from './button';
import { Popover, PopoverContent, PopoverTrigger } from './popover';
import { renderTextChild, Surface, UiPressable } from './primitives';
import { MIN_TOUCH_TARGET } from './touch-target';

export function navigationMenuTriggerStyle(options?: { active?: boolean }) {
  return options ?? {};
}

export function NavigationMenu({ children, style, ...props }: ViewProps & { children?: ReactNode }) {
  return <View {...props} style={[styles.root, style]}>{children}</View>;
}

export function NavigationMenuList({ children, style, ...props }: ViewProps & { children?: ReactNode }) {
  return (
    <Surface {...props} tone="muted" rounded="full" style={[styles.list, style]}>
      {children}
    </Surface>
  );
}

export function NavigationMenuItem({ children, style, ...props }: ViewProps & { children?: ReactNode }) {
  return <View {...props} style={style}>{children}</View>;
}

export function NavigationMenuTrigger(props: ButtonProps) {
  return <Button {...props} variant={props.variant ?? 'ghost'}>{props.children}</Button>;
}

export function NavigationMenuContent({ children, ...props }: ViewProps & { children?: ReactNode }) {
  return (
    <Popover>
      <PopoverTrigger fallback="Open" />
      <PopoverContent {...props}>{children}</PopoverContent>
    </Popover>
  );
}

export function NavigationMenuLink({
  children,
  style,
  ...props
}: Omit<PressableProps, 'style' | 'children'> & {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <UiPressable {...props} style={[styles.link, style]}>
      {renderTextChild(children)}
    </UiPressable>
  );
}

export function NavigationMenuIndicator(props: ViewProps) {
  return <View {...props} />;
}

export function NavigationMenuViewport(props: ViewProps) {
  return <View {...props} />;
}

const styles = StyleSheet.create({
  link: {
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  list: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
    padding: 4,
  },
  root: {
    width: '100%',
  },
});
