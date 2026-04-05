import React, { createContext, useState, useContext, ReactNode } from 'react';

type Language = 'EN' | 'RU';

type Translations = {
  [key in Language]: {
    [key: string]: string;
  };
};

const translations: Translations = {
  EN: {
    'settings.title': 'Settings',
    'settings.general': 'General',
    'settings.integrations': 'Integrations',
    'settings.bots': 'My Bots',
    'settings.users': 'User Management',
    'settings.language': 'Language',
    'settings.proxy': 'Network Proxy',
    'settings.webhooks': 'Home Automation (Webhooks)',
    'settings.export': 'Export & Backup',
    'settings.save': 'Save Changes',
    'sidebar.newNote': 'New Note',
    'sidebar.newFolder': 'New Folder',
    'sidebar.search': 'Search',
    'sidebar.settings': 'Settings',
    'editor.summarize': 'Summarize',
    'editor.empty': 'Select a note or create a new one',
  },
  RU: {
    'settings.title': 'Настройки',
    'settings.general': 'Общие',
    'settings.integrations': 'Интеграции',
    'settings.bots': 'Мои боты',
    'settings.users': 'Пользователи',
    'settings.language': 'Язык',
    'settings.proxy': 'Сетевой прокси',
    'settings.webhooks': 'Умный дом (Webhooks)',
    'settings.export': 'Экспорт и резервное копирование',
    'settings.save': 'Сохранить',
    'sidebar.newNote': 'Новая заметка',
    'sidebar.newFolder': 'Новая папка',
    'sidebar.search': 'Поиск',
    'sidebar.settings': 'Настройки',
    'editor.summarize': 'Суммаризировать',
    'editor.empty': 'Выберите заметку или создайте новую',
  }
};

type LanguageContextType = {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string) => string;
};

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export const LanguageProvider = ({ children }: { children: ReactNode }) => {
  const [language, setLanguage] = useState<Language>('EN');

  const t = (key: string) => {
    return translations[language][key] || key;
  };

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = () => {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
};
