import type { ComponentProps } from 'react';

import { OverlayClose, OverlayContent, OverlayDescription, OverlayFooter, OverlayHeader, OverlayNoop, OverlayRoot, OverlayTitle, OverlayTrigger } from './overlay';

export const Drawer = OverlayRoot;
export const DrawerPortal = OverlayNoop;
export const DrawerOverlay = OverlayNoop;
export const DrawerTrigger = OverlayTrigger;
export const DrawerClose = OverlayClose;
export const DrawerHeader = OverlayHeader;
export const DrawerFooter = OverlayFooter;
export const DrawerTitle = OverlayTitle;
export const DrawerDescription = OverlayDescription;

export function DrawerContent(props: ComponentProps<typeof OverlayContent>) {
  return <OverlayContent {...props} position={props.position ?? 'bottom'} />;
}
