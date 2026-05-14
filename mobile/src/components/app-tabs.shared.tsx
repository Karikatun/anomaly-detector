import { Tabs as RouterTabs } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TEST_IDS } from '@/constants/testIds';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export default function AppTabs() {
  const colors = useTheme();
  const insets = useSafeAreaInsets();
  const tabBarHeight = 56 + Math.max(insets.bottom, Spacing.two);

  return (
    <RouterTabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors.background },
        tabBarActiveTintColor: colors.text,
        tabBarHideOnKeyboard: true,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarItemStyle: styles.tabBarItem,
        tabBarLabelStyle: styles.tabBarLabel,
        tabBarStyle: [
          styles.tabBar,
          {
            backgroundColor: colors.background,
            borderTopColor: colors.backgroundElement,
            height: tabBarHeight,
            paddingBottom: Math.max(insets.bottom, Spacing.two),
          },
        ],
      }}>
      <RouterTabs.Screen
        name="components"
        options={{
          title: 'Components',
          tabBarButtonTestID: TEST_IDS.tabs.componentsTab,
          tabBarIcon: ({ color, size }) => (
            <SymbolView
              name={{ ios: 'square.grid.2x2.fill', android: 'view_module', web: 'view_module' }}
              size={size}
              tintColor={color}
            />
          ),
        }}
      />
      <RouterTabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarButtonTestID: TEST_IDS.tabs.profileTab,
          tabBarIcon: ({ color, size }) => (
            <SymbolView
              name={{ ios: 'person.crop.circle.fill', android: 'person', web: 'person' }}
              size={size}
              tintColor={color}
            />
          ),
        }}
      />
    </RouterTabs>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    borderTopWidth: StyleSheet.hairlineWidth,
    elevation: 0,
    paddingTop: Spacing.two,
    shadowOpacity: 0,
  },
  tabBarItem: {
    paddingVertical: Spacing.one,
  },
  tabBarLabel: {
    fontSize: 12,
    fontWeight: '700',
  },
});
