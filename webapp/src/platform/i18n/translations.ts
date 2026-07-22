// Russian translations — primary and default locale
const ru = {
  // Layout
  'app.logo': 'anomaly_detector',
  'nav.rooms': 'Комнаты',
  'nav.matches': 'Мои матчи',
  'button.logout': 'Выйти',
  'logout.failed': 'Не удалось выйти. Сессия всё ещё активна, попробуйте ещё раз.',

  // Auth page
  'auth.title': 'Вход',
  'auth.description': 'Войдите через один из сервисов или email.',
  'auth.login': 'Войти',
  'auth.register': 'Регистрация',
  'auth.switchToLogin': 'Уже есть аккаунт? Войти',
  'auth.switchToRegister': 'Нет аккаунта? Зарегистрироваться',
  'auth.email': 'Email',
  'auth.password': 'Пароль',
  'auth.displayName': 'Имя',
  'auth.errors.email': 'Введите корректный email',
  'auth.errors.password': 'Минимум 8 символов',
  'auth.errors.displayName': 'Минимум 1 символ',
  'auth.errors.registerFailed': 'Не удалось зарегистрироваться',
  'auth.errors.loginFailed': 'Не удалось войти',

  // OAuth
  'oauth.yandex': 'Яндекс ID',
  'oauth.vk': 'VK ID',
  'oauth.redirecting': 'Перенаправляем...',
  'oauth.error.network': 'Не удалось связаться с сервером. OAuth работает только с localhost.',
  'oauth.error.server': 'Ошибка сервера. Попробуйте позже.',

  // App page
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
  'rooms.create.title': 'Создать команду',
  'rooms.create.description': 'Выберите количество игроков для этого Тендера.',
  'rooms.create.capacity': 'Количество игроков',
  'rooms.create.capacity.2': '2 игрока',
  'rooms.create.capacity.3': '3 игрока',
  'rooms.create.capacity.4': '4 игрока',
  'rooms.create.submit': 'Создать команду',
  'rooms.create.submitting': 'Создаём...',
  'rooms.create.error.invalid': 'Некорректное количество игроков',
  'rooms.create.error.generic': 'Не удалось создать комнату',
  'rooms.join.title': 'Войти по коду',
  'rooms.join.description': 'Введите ID комнаты, чтобы присоединиться.',
  'rooms.join.placeholder': 'ID комнаты',
  'rooms.join.submit': 'Войти по коду',

  // Room lobby
  'lobby.title': 'Комната тендера',
  'lobby.description': 'Поделитесь ID комнаты с другими игроками, чтобы пригласить их.',
  'lobby.room.id': 'ID комнаты',
  'lobby.copyId': 'Скопировать ID',
  'lobby.copied': 'Скопировано!',
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
  'lobby.button.cancel': 'Выйти из комнаты',
  'lobby.button.cancelling': 'Отменяем...',
  'lobby.button.start': 'Начать Тендер',
  'lobby.button.starting': 'Запускаем...',
  'lobby.button.waiting': 'Ожидаем игроков...',
  'lobby.error.notFound': 'Комната не найдена',
  'lobby.error.notFound.description': 'Эта комната не существует или устарела.',
  'lobby.error.loadFailed': 'Не удалось загрузить комнату',
  'lobby.button.back': 'Назад к комнатам',

  // Tender: Access Slots
  'tender.access.title': 'Выбор слота доступа',
  'tender.access.description': 'Выберите один из шести слотов. Ранний доступ даёт приоритет в действиях, поздний — компенсацию.',
  'tender.access.confirm': 'Подтвердить выбор',
  'tender.access.confirmed.title': 'Выбор принят',
  'tender.access.confirmed.description': 'Слот {slot}: {name} зафиксирован и остаётся секретным. Ожидаем, пока остальные игроки выберут слот.',
  'tender.access.confirmed.button': 'Выбор принят — ожидаем игроков',
  'tender.access.aria': 'Слот доступа {slot}: {name}. Порядок действия: {order}. {terms}',
  'tender.access.order': 'Порядок: {order}',
  'tender.access.cost.emergency': 'Цена: −2 бюджета',
  'tender.access.cost.priority': 'Цена: −1 бюджет',
  'tender.access.neutral': 'Без цены и компенсации',
  'tender.access.compensation.sample': 'Компенсация: 1 образец сигнала',
  'tender.access.compensation.report': 'Компенсация: 1 аналитический отчёт',
  'tender.access.compensation.remote': 'Компенсация: 1 бюджет и 1 образец сигнала',
  'tender.access.slot.emergency': 'Аварийный',
  'tender.access.slot.priority': 'Приоритетный',
  'tender.access.slot.standard': 'Стандартный',
  'tender.access.slot.offPeak': 'Вне пика',
  'tender.access.slot.night': 'Ночной',
  'tender.access.slot.remote': 'Удалённый',
} as const

export type TranslationKey = keyof typeof ru

export const translations = { ru } as const
export const defaultLocale = 'ru' as const
export type Locale = keyof typeof translations
