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

export const DropdownMenu = OverlayRoot;
export const DropdownMenuPortal = OverlayNoop;
export const DropdownMenuTrigger = OverlayTrigger;
export const DropdownMenuContent = OverlayContent;
export const DropdownMenuGroup = MenuGroup;
export const DropdownMenuLabel = MenuLabel;
export const DropdownMenuItem = MenuItem;
export const DropdownMenuCheckboxItem = MenuCheckboxItem;
export const DropdownMenuRadioGroup = RadioGroup;
export const DropdownMenuRadioItem = MenuRadioItem;
export const DropdownMenuSeparator = MenuSeparator;
export const DropdownMenuShortcut = MenuShortcut;
export const DropdownMenuSub = MenuNoop;
export const DropdownMenuSubTrigger = MenuSubTrigger;
export const DropdownMenuSubContent = MenuSubContent;
