import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  redirect,
} from '@tanstack/react-router'

import { RootLayout } from './root-layout'
import { NotFoundPage } from './not-found-page'

const rootRoute = createRootRoute({
  component: RootLayout,
  notFoundComponent: NotFoundPage,
})

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: lazyRouteComponent(() => import('./home-page'), 'HomePage'),
})

const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/app',
  component: lazyRouteComponent(() => import('./features/rooms/public/my-matches'), 'MyMatchesRoute'),
})

const profileRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/profile',
  component: lazyRouteComponent(() => import('./features/profile/public/profile'), 'ProfileRoute'),
})

const recoveryCodeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/recover/code',
  component: lazyRouteComponent(
    () => import('./features/auth/public/recovery-code'),
    'RecoveryCodeRoute',
  ),
})

const roomsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/rooms',
  beforeLoad: () => {
    throw redirect({ to: '/', replace: true })
  },
})

const roomLobbyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/rooms/$roomId',
  component: lazyRouteComponent(() => import('./features/rooms/public/room-lobby'), 'RoomLobbyRoute'),
})

const tenderRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/tenders/$tenderId',
  validateSearch: (search: Record<string, unknown>) => ({
    from: search.from === 'matches' ? 'matches' as const : undefined,
  }),
  component: lazyRouteComponent(() => import('./features/tender/public/tender'), 'TenderRoute'),
})

const tutorialRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/tutorial',
  component: lazyRouteComponent(() => import('./features/tutorial/public/tutorial'), 'TutorialRoute'),
})

const privacyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/privacy',
  component: lazyRouteComponent(() => import('./features/legal/public/privacy'), 'PrivacyRoute'),
})

const personalDataConsentRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/personal-data-consent',
  component: lazyRouteComponent(
    () => import('./features/legal/public/personal-data-consent'),
    'PersonalDataConsentRoute',
  ),
})

const termsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/terms',
  component: lazyRouteComponent(() => import('./features/legal/public/terms'), 'TermsRoute'),
})

const routeTree = rootRoute.addChildren([
  indexRoute,
  appRoute,
  profileRoute,
  recoveryCodeRoute,
  roomsRoute,
  roomLobbyRoute,
  tenderRoute,
  tutorialRoute,
  privacyRoute,
  personalDataConsentRoute,
  termsRoute,
])

export const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
