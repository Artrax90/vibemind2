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
    'sidebar.searchPlaceholder': 'Search notes...',
    'sidebar.settings': 'Settings',
    'sidebar.rename': 'Rename',
    'sidebar.delete': 'Delete',
    'sidebar.share': 'Share',
    'sidebar.moveTo': 'Move to...',
    'sidebar.root': 'Root (Workspace)',
    'sidebar.moveNoteTitle': 'Move Note',
    'sidebar.cancel': 'Cancel',
    'editor.summarize': 'Summarize',
    'editor.empty': 'Select a note or create a new one',
    'editor.noteTitlePlaceholder': 'Note Title',
    'editor.syncing': 'Syncing',
    'editor.saved': 'Saved',
    'editor.relatedNotes': 'Related Notes',
    'editor.linkToNote': 'Link to note',
    'editor.create': 'Create',
    'editor.startWriting': 'Start writing...',
    'editor.plainText': 'Plain Text',
    'chat.placeholder': 'Ask your notes...',
    'chat.welcome': 'I am VibeMind AI. I have indexed your notes. What would you like to know?',
    'chat.backlinks': 'Backlinks',
    'chat.outgoingLinks': 'Outgoing Links',
    'chat.noBacklinks': 'No backlinks found for this note.',
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
    'sidebar.searchPlaceholder': 'Поиск заметок...',
    'sidebar.settings': 'Настройки',
    'sidebar.rename': 'Переименовать',
    'sidebar.delete': 'Удалить',
    'sidebar.share': 'Поделиться',
    'sidebar.moveTo': 'Переместить в...',
    'sidebar.root': 'Корень (Рабочая область)',
    'sidebar.moveNoteTitle': 'Переместить заметку',
    'sidebar.cancel': 'Отмена',
    'editor.summarize': 'Суммаризировать',
    'editor.empty': 'Выберите заметку или создайте новую',
    'editor.noteTitlePlaceholder': 'Заголовок заметки',
    'editor.syncing': 'Синхронизация',
    'editor.saved': 'Сохранено',
    'editor.relatedNotes': 'Похожие заметки',
    'editor.linkToNote': 'Ссылка на заметку',
    'editor.create': 'Создать',
    'editor.startWriting': 'Начните писать...',
    'editor.plainText': 'Простой текст',
    'chat.placeholder': 'Спросите свои заметки...',
    'chat.welcome': 'Я VibeMind AI. Я проиндексировал ваши заметки. Что вы хотите узнать?',
    'chat.backlinks': 'Обратные ссылки',
    'chat.outgoingLinks': 'Исходящие ссылки',
    'chat.noBacklinks': 'Обратных ссылок не найдено.',
  }
};

type LanguageContextType = {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string) => string;
};

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export const LanguageProvider = ({ children }: { children: ReactNode }) => {
  const [language, setLanguage] = useState<Language>(() => {
    const saved = localStorage.getItem('app_language');
    return (saved as Language) || 'EN';
  });

  const handleSetLanguage = (lang: Language) => {
    setLanguage(lang);
    localStorage.setItem('app_language', lang);
  };

  const t = (key: string) => {
    return translations[language][key] || key;
  };

  return (
    <LanguageContext.Provider value={{ language, setLanguage: handleSetLanguage, t }}>
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
