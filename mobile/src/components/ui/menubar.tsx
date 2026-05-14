import type { ReactNode } from 'react';
import { StyleSheet, type ViewProps } from 'react-native';

import {
  MenuCheckboxItem,
  MenuGroup,
  MenuItem,
  MenuLabel,
  MenuNoop,
  MenuRadioItem,
  MenuSeparator,
  MenuShortcut,
  MenuSubContent,
  MenuSubTrigger,
} from './menu-primitives';
import { OverlayContent, OverlayNoop, OverlayRoot, OverlayTrigger } from './overlay';
import { RadioGroup } from './radio-group';
import { Surface } from './primitives';

export function Menubar({ children, style, ...props }: ViewProps & { children?: ReactNode }) {
  return (
    <Surface {...props} tone="muted" rounded="full" style={[styles.menubar, style]}>
      {children}
    </Surface>
  );
}

export const MenubarPortal = OverlayNoop;
export const MenubarMenu = OverlayRoot;
export const MenubarTrigger = OverlayTrigger;
export const MenubarContent = OverlayContent;
export const MenubarGroup = MenuGroup;
export const MenubarSeparator = MenuSeparator;
export const MenubarLabel = MenuLabel;
export const MenubarItem = MenuItem;
export const MenubarShortcut = MenuShortcut;
export const MenubarCheckboxItem = MenuCheckboxItem;
export const MenubarRadioGroup = RadioGroup;
export const MenubarRadioItem = MenuRadioItem;
export const MenubarSub = MenuNoop;
export const MenubarSubTrigger = MenuSubTrigger;
export const MenubarSubContent = MenuSubContent;

const styles = StyleSheet.create({
  menubar: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
    padding: 4,
  },
});
