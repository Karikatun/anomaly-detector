import { Image, type ImageProps } from 'expo-image';
import type { ReactNode } from 'react';
import { StyleSheet, View, type ViewProps } from 'react-native';

import { Surface, Typography } from './primitives';
import { useUiTheme } from './theme';

export function Avatar({ children, style, ...props }: ViewProps & { children?: ReactNode }) {
  const theme = useUiTheme();
  return (
    <Surface
      {...props}
      tone="muted"
      rounded="full"
      style={[styles.avatar, { borderColor: theme.colors.background }, style]}>
      {children}
    </Surface>
  );
}

export function AvatarImage({ style, ...props }: ImageProps) {
  return <Image {...props} style={[StyleSheet.absoluteFill, styles.image, style]} />;
}

export function AvatarFallback({ children, style, ...props }: ViewProps & { children?: ReactNode }) {
  return (
    <View {...props} style={[styles.fallback, style]}>
      <Typography variant="bodySm" weight="700">
        {children}
      </Typography>
    </View>
  );
}

export function AvatarGroup({ children, style, ...props }: ViewProps & { children?: ReactNode }) {
  return (
    <View {...props} style={[styles.group, style]}>
      {children}
    </View>
  );
}

export function AvatarGroupCount({ children, style, ...props }: ViewProps & { children?: ReactNode }) {
  return (
    <Avatar {...props} style={style}>
      <AvatarFallback>+{children}</AvatarFallback>
    </Avatar>
  );
}

export function AvatarBadge({ style, ...props }: ViewProps) {
  const theme = useUiTheme();
  return (
    <View
      {...props}
      style={[styles.badge, { backgroundColor: theme.colors.primary, borderColor: theme.colors.background }, style]}
    />
  );
}

const styles = StyleSheet.create({
  avatar: {
    alignItems: 'center',
    borderWidth: 2,
    height: 40,
    justifyContent: 'center',
    overflow: 'hidden',
    width: 40,
  },
  badge: {
    borderRadius: 999,
    borderWidth: 2,
    bottom: -1,
    height: 12,
    position: 'absolute',
    right: -1,
    width: 12,
  },
  fallback: {
    alignItems: 'center',
    height: '100%',
    justifyContent: 'center',
    width: '100%',
  },
  group: {
    alignItems: 'center',
    flexDirection: 'row',
  },
  image: {
    borderRadius: 999,
  },
});
