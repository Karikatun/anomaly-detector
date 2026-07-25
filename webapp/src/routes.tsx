import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  redirect,
} from '@tanstack/react-router'

import { RootLayout } from './root-layout'

const rootRoute = createRootRoute({
  component: RootLayout,
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
  component: lazyRouteComponent(() => import('./features/tender/public/tender'), 'TenderRoute'),
})

const routeTree = rootRoute.addChildren([indexRoute, appRoute, profileRoute, roomsRoute, roomLobbyRoute, tenderRoute])

export const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
