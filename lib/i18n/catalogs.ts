// Open Backup UI v1.0.2
import en from './messages/en.json'
import es from './messages/es.json'
import de from './messages/de.json'
import ru from './messages/ru.json'
import fr from './messages/fr.json'
import ptBR from './messages/pt-BR.json'
import zhCN from './messages/zh-CN.json'
import ja from './messages/ja.json'
import it from './messages/it.json'
import ko from './messages/ko.json'
import hi from './messages/hi.json'
import type { Locale, Messages } from './model'

// Keep region-specific catalogs explicit; the locale selector uses these exact codes.
export const catalogs: Record<Locale, Messages> = { en, es, de, ru, fr, 'pt-BR': ptBR, 'zh-CN': zhCN, ja, it, ko, hi }
