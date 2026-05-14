import type { ReactNode } from 'react';
import React from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
  type PressableProps,
  type StyleProp,
  type TextProps,
  type TextStyle,
  type ViewProps,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { mapTextChildren } from './text-utils';
import { useUiTheme, withAlpha, type UiTheme } from './theme';
import { MIN_TOUCH_TARGET } from './touch-target';

export type UiColor = keyof UiTheme['colors'];
export type UiSize = 'xs' | 'sm' | 'default' | 'lg';
export type UiVariant = 'default' | 'secondary' | 'outline' | 'ghost' | 'destructive' | 'link';
export type UiViewStyle = StyleProp<ViewStyle>;
export type UiTextStyle = StyleProp<TextStyle>;

export type UiTextProps = Omit<TextProps, 'style'> & {
  children?: ReactNode;
  color?: UiColor;
  variant?: 'xs' | 'sm' | 'base' | 'lg' | 'xl' | 'title' | 'mono';
  weight?: TextStyle['fontWeight'];
  muted?: boolean;
  style?: StyleProp<TextStyle | ViewStyle>;
};

export function UiText({
  children,
  color = 'foreground',
  variant = 'base',
  weight = '500',
  muted,
  style,
  ...props
}: UiTextProps) {
  const theme = useUiTheme();
  const textColor = muted ? theme.colors.mutedForeground : theme.colors[color];
  const typography = theme.typography[variant === 'mono' ? 'base' : variant];

  return (
    <Text
      {...props}
      style={[
        typography,
        variant === 'mono' && theme.typography.mono,
        { color: textColor, fontWeight: weight },
        style as StyleProp<TextStyle>,
      ]}>
      {children}
    </Text>
  );
}

export type SurfaceProps = ViewProps & {
  children?: ReactNode;
  tone?: 'background' | 'card' | 'popover' | 'muted' | 'accent' | 'transparent';
  bordered?: boolean;
  padded?: boolean | 'sm' | 'lg';
  rounded?: keyof UiTheme['radius'];
};

export function Surface({
  children,
  tone = 'card',
  bordered,
  padded,
  rounded = 'xl',
  style,
  ...props
}: SurfaceProps) {
  const theme = useUiTheme();

  return (
    <View
      {...props}
      style={[
        {
          backgroundColor:
            tone === 'transparent'
              ? theme.colors.transparent
              : theme.colors[tone === 'muted' ? 'muted' : tone],
          borderRadius: theme.radius[rounded],
        },
        bordered && { borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border },
        padded === true && { padding: theme.spacing.lg },
        padded === 'sm' && { padding: theme.spacing.md },
        padded === 'lg' && { padding: theme.spacing.xl },
        style,
      ]}>
      {children}
    </View>
  );
}

export type UiPressableProps = Omit<PressableProps, 'style'> & {
  style?: PressableProps['style'];
  children?: PressableProps['children'];
};

export function UiPressable({ disabled, style, children, ...props }: UiPressableProps) {
  const theme = useUiTheme();

  return (
    <Pressable
      {...props}
      disabled={disabled}
      style={(state) => [
        state.pressed && !disabled && { opacity: theme.opacity.pressed },
        disabled && { opacity: theme.opacity.disabled },
        typeof style === 'function' ? style(state) : style,
      ]}>
      {children}
    </Pressable>
  );
}

export function renderTextChild(children: ReactNode, style?: UiTextStyle, color?: UiColor) {
  return mapTextChildren(children, (child) => (
    <UiText color={color} variant="sm" style={style}>
      {child}
    </UiText>
  ));
}

export function stackStyle(theme: UiTheme, gap: number = theme.spacing.sm): ViewStyle {
  return {
    gap,
  };
}

export function rowStyle(theme: UiTheme, gap: number = theme.spacing.sm): ViewStyle {
  return {
    alignItems: 'center',
    flexDirection: 'row',
    gap,
  };
}

export function getInteractiveColors(theme: UiTheme, variant: UiVariant) {
  if (variant === 'secondary') {
    return {
      backgroundColor: theme.colors.secondary,
      borderColor: theme.colors.transparent,
      color: theme.colors.secondaryForeground,
    };
  }

  if (variant === 'outline') {
    return {
      backgroundColor: withAlpha(theme.colors.input, theme.scheme === 'dark' ? 0.35 : 0.3),
      borderColor: theme.colors.border,
      color: theme.colors.foreground,
    };
  }

  if (variant === 'ghost' || variant === 'link') {
    return {
      backgroundColor: theme.colors.transparent,
      borderColor: theme.colors.transparent,
      color: theme.colors.foreground,
    };
  }

  if (variant === 'destructive') {
    return {
      backgroundColor: withAlpha(theme.colors.destructive, theme.scheme === 'dark' ? 0.22 : 0.12),
      borderColor: theme.colors.transparent,
      color: theme.colors.destructive,
    };
  }

  return {
    backgroundColor: theme.colors.primary,
    borderColor: theme.colors.transparent,
    color: theme.colors.primaryForeground,
  };
}

export function getControlHeight(size: UiSize) {
  if (size === 'lg') return 48;
  return MIN_TOUCH_TARGET;
}

export type OverlayRootProps = {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  children?: ReactNode;
};

export function cloneWithPress(
  child: ReactNode,
  onPress: (event: GestureResponderEvent) => void,
): ReactNode {
  if (!React.isValidElement(child)) return child;

  const element = child as React.ReactElement<{ onPress?: (event: GestureResponderEvent) => void }>;
  return React.cloneElement(element, {
    onPress: (event: GestureResponderEvent) => {
      element.props.onPress?.(event);
      onPress(event);
    },
  });
}

export type OverlayFrameProps = {
  visible: boolean;
  onRequestClose: () => void;
  children: ReactNode;
  position?: 'center' | 'bottom' | 'top';
  scrollable?: boolean;
};

export function OverlayFrame({
  visible,
  onRequestClose,
  children,
  position = 'center',
  scrollable,
}: OverlayFrameProps) {
  const theme = useUiTheme();
  const content = scrollable ? (
    <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      {children}
    </ScrollView>
  ) : (
    children
  );

  return (
    <Modal animationType="fade" transparent visible={visible} onRequestClose={onRequestClose}>
      <SafeAreaView style={styles.modalSafeArea}>
        <Pressable
          accessibilityRole="button"
          style={[styles.modalOverlay, { backgroundColor: withAlpha('#000000', 0.42) }]}
          onPress={onRequestClose}
        />
        <View
          pointerEvents="box-none"
          style={[
            styles.modalContentHost,
            position === 'bottom' && styles.modalBottom,
            position === 'top' && styles.modalTop,
          ]}>
          <Surface
            tone="popover"
            bordered
            rounded={position === 'center' ? 'xxl' : 'xl'}
            style={[
              styles.modalContent,
              {
                shadowColor: '#000000',
                shadowOpacity: theme.scheme === 'dark' ? 0.4 : 0.14,
                shadowRadius: 24,
                shadowOffset: { width: 0, height: 12 },
              },
              position === 'bottom' && styles.sheetBottom,
              position === 'top' && styles.sheetTop,
            ]}>
            {content}
          </Surface>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalSafeArea: {
    flex: 1,
  },
  modalOverlay: {
    ...StyleSheet.absoluteFillObject,
  },
  modalContentHost: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  modalBottom: {
    justifyContent: 'flex-end',
  },
  modalTop: {
    justifyContent: 'flex-start',
  },
  modalContent: {
    width: '100%',
    maxWidth: 520,
    maxHeight: '86%',
    padding: 20,
  },
  sheetBottom: {
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    maxWidth: 680,
  },
  sheetTop: {
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
    maxWidth: 680,
  },
});
