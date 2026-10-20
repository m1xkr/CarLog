// ClientID приложения, зарегистрированного на oauth.yandex.ru (он не секретный).
// Если оставить пустым, его можно ввести в приложении: «Ещё» → «Яндекс Диск».
export const YANDEX_CLIENT_ID = '7db79f4b5e5e48b2821e0acffed22ea3';

// Client ID веб-приложения из Google Cloud Console (он не секретный).
export const GOOGLE_CLIENT_ID = '';

// Адрес прокси для Яндекс Диска (см. папку proxy/). Нужен, если сервер файлов Яндекса
// не разрешает запросы со страниц (ошибка CORS). Можно задать и в приложении: «⚙» → «Яндекс Диск».
export const YANDEX_PROXY = '';

export const APP_VERSION = '1.4.0';
