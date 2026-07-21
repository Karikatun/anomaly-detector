// Russian translations — primary and default locale
const ru = {
  // Layout
  'app.logo': 'anomaly_detector',
  'nav.auth': 'Вход',
  'nav.rooms': 'Комнаты',
  'nav.app': 'Приложение',
  'button.logout': 'Выйти',
  'logout.failed': 'Не удалось выйти. Сессия всё ещё активна, попробуйте ещё раз.',

  // Auth pages
  'auth.title': 'Доступ к аккаунту',
  'auth.description': 'Создайте аккаунт или продолжайте существующую сессию.',
  'auth.tab.register': 'Регистрация',
  'auth.tab.login': 'Вход',
  'auth.oauth.or': 'Или продолжить через',

  // Register form
  'register.email': 'Email',
  'register.email.placeholder': 'you@example.com',
  'register.password': 'Пароль',
  'register.password.placeholder': 'Минимум 8 символов',
  'register.displayName': 'Имя',
  'register.displayName.placeholder': 'Ваше имя',
  'register.privacyConsent': 'Я принимаю политику обработки персональных данных',
  'register.ageConfirmation': 'Подтверждаю, что мне есть 16 лет',
  'register.submit': 'Зарегистрироваться',
  'register.submitting': 'Регистрация...',
  'register.error.unexpected': 'Непредвиденная ошибка',

  // Login form
  'login.email': 'Email',
  'login.email.placeholder': 'you@example.com',
  'login.password': 'Пароль',
  'login.submit': 'Войти',
  'login.submitting': 'Вход...',
  'login.error.unexpected': 'Непредвиденная ошибка',

  // OAuth
  'oauth.yandex': 'Яндекс ID',
  'oauth.vk': 'VK ID',
  'oauth.redirecting': 'Перенаправляем...',

  // Home page
  'home.authenticated.badge': 'Сессия активна',
  'home.authenticated.title': 'Сессия активна',
  'home.authenticated.description': 'Вы вошли как',
  'home.authenticated.subtitle': 'Базовая аутентификация для будущих функций.',
  'home.authenticated.cta': 'В приложение',
  'home.guest.badge': 'Демо приложение',
  'home.guest.title': 'Аутентификация, валидация, API-состояние и формы — готовы к работе.',
  'home.guest.description': 'Приложение использует общие Zod-контракты, TanStack Query для серверного состояния, TanStack Form для форм и API-клиент с автообновлением сессии.',

  // App page
  'app.protected.badge': 'Требуется вход',
  'app.protected.title': 'Требуется вход',
  'app.protected.description': 'Этот раздел доступен только авторизованным пользователям.',
  'app.protected.cta': 'Войти',
  'app.profile.badge': 'Текущий пользователь',
  'app.profile.title': 'Профиль',
  'app.profile.userId': 'ID пользователя',
  'app.profile.locale': 'Язык',
  'app.profile.created': 'Создан',
  'app.profile.locale.ru': 'Русский',
  'app.profile.locale.en': 'English',

  // Loading/error states
  'loading.session': 'Проверка сессии...',
  'error.session.title': 'Проверка сессии временно недоступна',
  'error.session.description': 'Сессия не была сброшена. Проверьте соединение и попробуйте снова.',
  'error.session.retry': 'Попробовать снова',

  // Room list
  'rooms.title': 'Комнаты тендера',
  'rooms.description': 'Создайте приватную комнату и пригласите других игроков для начала Тендера.',
  'rooms.create.title': 'Создать комнату',
  'rooms.create.description': 'Выберите количество игроков для этого Тендера.',
  'rooms.create.capacity': 'Количество игроков',
  'rooms.create.capacity.2': '2 игрока',
  'rooms.create.capacity.3': '3 игрока',
  'rooms.create.capacity.4': '4 игрока',
  'rooms.create.submit': 'Создать комнату',
  'rooms.create.submitting': 'Создаём...',
  'rooms.create.error.invalid': 'Некорректное количество игроков',
  'rooms.create.error.generic': 'Не удалось создать комнату',

  // Room lobby
  'lobby.title': 'Комната тендера',
  'lobby.description': 'Поделитесь ID комнаты с другими игроками, чтобы пригласить их.',
  'lobby.room.id': 'ID комнаты',
  'lobby.players': 'Игроки',
  'lobby.players.joined': '{count}/{capacity} участников',
  'lobby.players.inProgress': ' — Тендер идёт',
  'lobby.player.label': 'Игрок {seat}',
  'lobby.player.host': '(Хост)',
  'lobby.player.waiting': 'Ожидание игрока...',
  'lobby.button.join': 'Войти в комнату',
  'lobby.button.joining': 'Входим...',
  'lobby.button.leave': 'Покинуть комнату',
  'lobby.button.leaving': 'Выходим...',
  'lobby.button.cancel': 'Отменить комнату',
  'lobby.button.cancelling': 'Отменяем...',
  'lobby.button.start': 'Начать Тендер',
  'lobby.button.starting': 'Запускаем...',
  'lobby.button.waiting': 'Ожидаем игроков...',
  'lobby.error.notFound': 'Комната не найдена',
  'lobby.error.notFound.description': 'Эта комната не существует или устарела.',
  'lobby.error.loadFailed': 'Не удалось загрузить комнату',
  'lobby.button.back': 'Назад к комнатам',
} as const

export type TranslationKey = keyof typeof ru

export const translations = { ru } as const
export const defaultLocale = 'ru' as const
export type Locale = keyof typeof translations
