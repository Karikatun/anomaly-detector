import { useRouter, type Href } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import type { ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type ScrollViewProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';

import { TEST_IDS } from '@/constants/testIds';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type ScreenBackButton = boolean | 'auto';

type ScreenProps = {
  children: ReactNode;
  backButton?: ScreenBackButton;
  backButtonTestID?: string;
  backFallbackHref?: Href;
  centered?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
  edges?: Edge[];
  keyboardAvoiding?: boolean;
  padded?: boolean;
  scroll?: boolean;
  scrollViewProps?: Omit<ScrollViewProps, 'children' | 'contentContainerStyle' | 'style'>;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

export function Screen({
  backButton = false,
  backButtonTestID = TEST_IDS.screen.backButton,
  backFallbackHref,
  centered,
  children,
  contentStyle,
  edges,
  keyboardAvoiding,
  padded = true,
  scroll,
  scrollViewProps,
  style,
  testID,
}: ScreenProps) {
  const router = useRouter();
  const colors = useTheme();
  const canGoBack = getCanGoBack(router);
  const showBackButton =
    backButton === true || (backButton === 'auto' && (canGoBack || Boolean(backFallbackHref)));

  const handleBack = () => {
    if (canGoBack) {
      router.back();
      return;
    }

    if (backFallbackHref) {
      router.replace(backFallbackHref);
    }
  };

  const body = (
    <SafeAreaView edges={edges} style={styles.safeArea}>
      {showBackButton && (
        <View style={styles.header}>
          <Pressable
            accessibilityLabel="Back"
            accessibilityRole="button"
            hitSlop={8}
            onPress={handleBack}
            style={[
              styles.backButton,
              {
                backgroundColor: colors.background,
                borderColor: colors.backgroundElement,
              },
            ]}
            testID={backButtonTestID}>
            <SymbolView
              name={{ ios: 'chevron.left', android: 'arrow_back', web: 'arrow_back' }}
              size={22}
              tintColor={colors.text}
            />
          </Pressable>
        </View>
      )}

      {scroll ? (
        <ScrollView
          {...scrollViewProps}
          contentContainerStyle={[
            styles.scrollContent,
            { gap: Spacing.four },
            padded && styles.padded,
            centered && styles.centeredContent,
            contentStyle,
          ]}
          style={styles.scrollView}
          testID={testID}>
          {children}
        </ScrollView>
      ) : (
        <View
          style={[
            styles.content,
            { gap: Spacing.four },
            padded && styles.padded,
            centered && styles.centeredContent,
            contentStyle,
          ]}
          testID={testID}>
          {children}
        </View>
      )}
    </SafeAreaView>
  );

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }, style]}>
      {keyboardAvoiding ? (
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.keyboardView}>
          {body}
        </KeyboardAvoidingView>
      ) : (
        body
      )}
    </View>
  );
}

function getCanGoBack(router: ReturnType<typeof useRouter>) {
  try {
    return router.canGoBack();
  } catch {
    return false;
  }
}

const styles = StyleSheet.create({
  backButton: {
    alignItems: 'center',
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  centeredContent: {
    justifyContent: 'center',
  },
  content: {
    flex: 1,
  },
  header: {
    alignItems: 'flex-start',
    minHeight: 56,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
  },
  keyboardView: {
    flex: 1,
  },
  padded: {
    padding: Spacing.four,
  },
  safeArea: {
    flex: 1,
  },
  screen: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  scrollView: {
    flex: 1,
  },
});
