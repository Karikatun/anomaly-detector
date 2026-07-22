import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
} from '@tanstack/react-router'

import { RootLayout } from './root-layout'

const rootRoute = createRootRoute({
  component: RootLayout,
})

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: lazyRouteComponent(() => import('./pages'), 'HomePage'),
})

const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/app',
  component: lazyRouteComponent(() => import('./features/rooms'), 'MyMatchesPage'),
})

const profileRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/profile',
  component: lazyRouteComponent(() => import('./pages'), 'ProfilePage'),
})

const roomsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/rooms',
  component: lazyRouteComponent(() => import('./features/rooms'), 'RoomListPage'),
})

const roomLobbyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/rooms/$roomId',
  component: lazyRouteComponent(() => import('./features/rooms'), 'RoomLobbyPage'),
})

const tenderRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/tenders/$tenderId',
  component: lazyRouteComponent(() => import('./features/tender'), 'TenderPage'),
})

const routeTree = rootRoute.addChildren([indexRoute, appRoute, profileRoute, roomsRoute, roomLobbyRoute, tenderRoute])

export const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
