import type { ComponentProps } from 'react';

import { OverlayClose, OverlayContent, OverlayDescription, OverlayFooter, OverlayHeader, OverlayRoot, OverlayTitle, OverlayTrigger } from './overlay';

export const Sheet = OverlayRoot;
export const SheetTrigger = OverlayTrigger;
export const SheetClose = OverlayClose;
export const SheetHeader = OverlayHeader;
export const SheetFooter = OverlayFooter;
export const SheetTitle = OverlayTitle;
export const SheetDescription = OverlayDescription;

export function SheetContent(props: ComponentProps<typeof OverlayContent>) {
  return <OverlayContent {...props} position={props.position ?? 'bottom'} />;
}
