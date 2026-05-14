import { OverlayContent, OverlayNoop, OverlayRoot, OverlayTrigger } from './overlay';
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
import { RadioGroup } from './radio-group';

export const ContextMenu = OverlayRoot;
export const ContextMenuTrigger = OverlayTrigger;
export const ContextMenuContent = OverlayContent;
export const ContextMenuItem = MenuItem;
export const ContextMenuCheckboxItem = MenuCheckboxItem;
export const ContextMenuRadioItem = MenuRadioItem;
export const ContextMenuLabel = MenuLabel;
export const ContextMenuSeparator = MenuSeparator;
export const ContextMenuShortcut = MenuShortcut;
export const ContextMenuGroup = MenuGroup;
export const ContextMenuPortal = OverlayNoop;
export const ContextMenuSub = MenuNoop;
export const ContextMenuSubContent = MenuSubContent;
export const ContextMenuSubTrigger = MenuSubTrigger;
export const ContextMenuRadioGroup = RadioGroup;
