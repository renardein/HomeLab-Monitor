const fs = require('fs');
const path = require('path');
const config = require('./config');

class I18n {
    constructor() {
        this.currentLanguage = config.defaultLanguage || 'ru';
        this.localesDir = path.join(__dirname, 'locales');
        this.locales = {};
        this.loadLocales();
    }

    // Загрузка всех языковых файлов из папки locales
    loadLocales() {
        try {
            const files = fs.readdirSync(this.localesDir);
            
            for (const file of files) {
                // Проверяем, что файл имеет расширение .json и имя соответствует коду языка
                if (file.endsWith('.json')) {
                    const langCode = path.basename(file, '.json');
                    
                    try {
                        const filePath = path.join(this.localesDir, file);
                        const content = fs.readFileSync(filePath, 'utf8');
                        this.locales[langCode] = JSON.parse(content);
                    } catch (parseError) {
                        console.error(`Ошибка парсинга файла ${file}:`, parseError.message);
                    }
                }
            }
            
            // Если ни один язык не загружен, используем fallback
            if (Object.keys(this.locales).length === 0) {
                console.warn('Предупреждение: языковые файлы не найдены в папке locales');
            }
        } catch (error) {
            console.error('Ошибка загрузки языковых файлов:', error.message);
        }
    }

    // Перезагрузить языковые файлы (полезно при добавлении новых)
    reloadLocales() {
        this.locales = {};
        this.loadLocales();
    }

    // Получить список доступных языков
    getAvailableLanguages() {
        return Object.keys(this.locales);
    }

    // Установить язык
    setLanguage(lang) {
        if (this.locales[lang]) {
            this.currentLanguage = lang;
            return true;
        }
        return false;
    }

    // Получить текущий язык
    getLanguage() {
        return this.currentLanguage;
    }

    // Получить перевод
    t(key, params = {}) {
        const lang = this.locales[this.currentLanguage] || this.locales.ru;
        
        // Поддержка вложенных ключей (например, 'storage.active_yes')
        let translation = key.split('.').reduce((obj, k) => obj && obj[k], lang);
        
        if (!translation) {
            // Если перевод не найден, пробуем на русском
            translation = key.split('.').reduce((obj, k) => obj && obj[k], this.locales.ru);
        }
        
        if (!translation) {
            return key; // Возвращаем ключ если перевод не найден
        }

        // Замена параметров
        return translation.replace(/\{(\w+)\}/g, (match, p1) => params[p1] || match);
    }

    // Получить перевод с учетом множественного числа
    tn(key, count, params = {}) {
        const forms = this.t(key).split('|');
        const pluralRules = new Intl.PluralRules(this.currentLanguage);
        const pluralForm = pluralRules.select(count);
        
        let translation;
        switch (pluralForm) {
            case 'zero':
                translation = forms[0] || forms[1] || forms[2];
                break;
            case 'one':
                translation = forms[1] || forms[0];
                break;
            case 'two':
                translation = forms[2] || forms[1] || forms[0];
                break;
            case 'few':
                translation = forms[2] || forms[1] || forms[0];
                break;
            case 'many':
                translation = forms[2] || forms[1] || forms[0];
                break;
            default:
                translation = forms[0];
        }
        
        return translation.replace(/\{count\}/g, count).replace(/\{(\w+)\}/g, (match, p1) => params[p1] || match);
    }
}

module.exports = new I18n();
