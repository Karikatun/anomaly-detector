import {
  TabList,
  TabSlot,
  Tabs,
  TabTrigger,
  type TabListProps,
  type TabTriggerSlotProps,
} from 'expo-router/ui';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Typography } from '@/components/ui/typography';
import { TEST_IDS } from '@/constants/testIds';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export default function AppTabs() {
  const colors = useTheme();
  const insets = useSafeAreaInsets();
  const bottomPadding = Math.max(insets.bottom, Spacing.two);
  const slotStyle = StyleSheet.flatten([styles.slot, { paddingBottom: 56 + bottomPadding }]);
  const tabBarStyle = StyleSheet.flatten([
    styles.tabBar,
    {
      backgroundColor: colors.background,
      borderTopColor: colors.backgroundElement,
      paddingBottom: bottomPadding,
    },
  ]);

  return (
    <Tabs style={styles.root}>
      <TabSlot style={slotStyle} />
      <TabList asChild>
        <BottomTabList style={tabBarStyle}>
          <TabTrigger name="components" href="/components" asChild>
            <TabButton
              icon={{ ios: 'square.grid.2x2.fill', android: 'view_module', web: 'view_module' }}
              testID={TEST_IDS.tabs.componentsTab}>
              Components
            </TabButton>
          </TabTrigger>
          <TabTrigger name="profile" href="/profile" asChild>
            <TabButton
              icon={{ ios: 'person.crop.circle.fill', android: 'person', web: 'person' }}
              testID={TEST_IDS.tabs.profileTab}>
              Profile
            </TabButton>
          </TabTrigger>
        </BottomTabList>
      </TabList>
    </Tabs>
  );
}

function BottomTabList(props: TabListProps) {
  return <View {...props} />;
}

type TabButtonProps = TabTriggerSlotProps & {
  icon: SymbolViewProps['name'];
};

function TabButton({ children, icon, isFocused, ...props }: TabButtonProps) {
  const colors = useTheme();
  const color = isFocused ? colors.text : colors.textSecondary;

  return (
    <Pressable {...props} style={({ pressed }) => [styles.tabButton, pressed && styles.pressed]}>
      <SymbolView name={icon} size={22} tintColor={color} />
      <Typography colorValue={color} variant="caption" weight="700">
        {children}
      </Typography>
    </Pressable>
  );
}

const styles = {
  pressed: {
    opacity: 0.72,
  },
  root: {
    flex: 1,
    minHeight: '100vh' as unknown as ViewStyle['minHeight'],
  },
  slot: {
    minHeight: '100vh' as unknown as ViewStyle['minHeight'],
  },
  tabBar: {
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    bottom: 0,
    flexDirection: 'row',
    gap: Spacing.two,
    justifyContent: 'center',
    left: 0,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    position: 'fixed' as ViewStyle['position'],
    right: 0,
  },
  tabButton: {
    alignItems: 'center',
    flex: 1,
    gap: Spacing.one,
    justifyContent: 'center',
    minHeight: 48,
  },
} satisfies Record<string, ViewStyle>;
