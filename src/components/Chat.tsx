import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Send, Bot, Link as LinkIcon, FileText, Loader2, Lock } from 'lucide-react';
import { motion } from 'framer-motion';
import { Note, Folder } from '../types';
import { useLanguage } from '../contexts/LanguageContext';

type ChatProps = {
  notes: Note[];
  folders: Folder[];
  unlockedFolders: Set<string>;
  activeNoteId: string | null;
  onNoteClick: (id: string) => void;
  api: any;
};

export default function Chat({ notes, folders, unlockedFolders, activeNoteId, onNoteClick, api }: ChatProps) {
  const { t } = useLanguage();
  const [messages, setMessages] = useState([
    { 
      role: 'assistant', 
      content: t('chat.welcome'),
      citations: [] as {id: string, title: string, snippet: string}[]
    }
  ]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const isNoteLocked = (noteId: string) => {
    const note = notes.find(n => n.id === noteId);
    if (!note || !note.folderId) return false;
    const folder = folders.find(f => f.id === note.folderId);
    return folder?.isProtected && !unlockedFolders.has(folder.id);
  };

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isTyping]);

  const handleSend = async () => {
    if (!input.trim() || isTyping) return;
    
    const userMessage = input;
    setMessages(prev => [...prev, { role: 'user', content: userMessage, citations: [] }]);
    setInput('');
    setIsTyping(true);
    
    try {
      const notesWithLockStatus = notes.map(n => ({ ...n, isLocked: isNoteLocked(n.id) }));
      const response = await api.chat(userMessage, notesWithLockStatus, Array.from(unlockedFolders));
      setMessages(prev => [...prev, { 
        role: 'assistant', 
        content: response.answer,
        citations: response.citations || []
      }]);
    } catch (error) {
      setMessages(prev => [...prev, { 
        role: 'assistant', 
        content: 'Sorry, I encountered an error while processing your request.',
        citations: []
      }]);
    } finally {
      setIsTyping(false);
    }
  };

  // Calculate backlinks dynamically
  const backlinks = useMemo(() => {
    if (!activeNoteId) return [];
    const activeNote = notes.find(n => n.id === activeNoteId);
    if (!activeNote || !activeNote.title) return [];

    // Case-insensitive regex for [[Note Title]] with optional spaces
    // Escape special characters in title for regex
    const escapedTitle = activeNote.title.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const linkPattern = new RegExp(`\\[\\[\\s*${escapedTitle}\\s*\\]\\]`, 'i');
    
    return notes.filter(n => n.id !== activeNoteId && n.content && linkPattern.test(n.content));
  }, [notes, activeNoteId]);

  // Calculate outgoing links dynamically
  const outgoingLinks = useMemo(() => {
    if (!activeNoteId) return [];
    const activeNote = notes.find(n => n.id === activeNoteId);
    if (!activeNote || !activeNote.content) return [];

    // Find all [[Note Title]] in the current note's content
    const matches = Array.from(activeNote.content.matchAll(/\[\[(.*?)\]\]/g));
    const linkedTitles = matches.map(m => m[1].trim().toLowerCase());
    
    return notes.filter(n => n.id !== activeNoteId && n.title && linkedTitles.includes(n.title.toLowerCase()));
  }, [notes, activeNoteId]);

  return (
    <div className="w-80 h-full bg-background flex flex-col border-l border-border/50">
      <div className="p-4 border-b border-border/50">
        <h3 className="text-sm font-semibold text-primary flex items-center">
          <Bot size={16} className="mr-2" />
          AI Assistant (RAG)
        </h3>
      </div>
      
      <div 
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin scroll-smooth"
      >
        {messages.map((msg, i) => (
            <motion.div 
              key={i}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
            >
            <div className={`max-w-[85%] rounded-lg p-3 text-sm ${
              msg.role === 'user' 
                ? 'bg-primary text-primary-foreground' 
                : 'bg-secondary text-foreground border border-border/50'
            }`}>
              {msg.content}
            </div>
            
            {msg.citations && msg.citations.length > 0 && (
              <div className="mt-2 space-y-2 w-full pr-4">
                {msg.citations.map((cit, idx) => {
                  const locked = isNoteLocked(cit.id);
                  return (
                  <div 
                    key={idx} 
                    onClick={() => onNoteClick(cit.id)}
                    className="bg-card border border-border/50 rounded-lg p-2 text-xs cursor-pointer hover:border-primary transition-all relative"
                  >
                    <div className={locked ? 'blur-[4px] opacity-70 select-none' : ''}>
                      <div className="font-semibold text-primary flex items-center mb-1">
                        <span className="bg-primary text-primary-foreground rounded-full w-4 h-4 flex items-center justify-center mr-1 text-[10px]">{idx + 1}</span>
                        {cit.title || 'Untitled'}
                      </div>
                      <div className="text-muted-foreground italic line-clamp-2">"{cit.snippet || '...'}"</div>
                    </div>
                    {locked && (
                      <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
                         <Lock size={16} className="text-foreground/50 drop-shadow-md" />
                      </div>
                    )}
                  </div>
                )})}
              </div>
            )}
            </motion.div>
          ))}
          {isTyping && (
            <div className="flex items-center text-muted-foreground text-xs animate-pulse">
              <Loader2 size={14} className="mr-2 animate-spin" />
              VibeMind is thinking...
            </div>
          )}
        </div>

      <div className="p-4 border-t border-border/50 bg-secondary/30 shrink-0 max-h-[40%] overflow-y-auto">
        <div className="mb-6">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center">
            <LinkIcon size={12} className="mr-1" /> {t('chat.backlinks')}
          </h4>
          <div className="space-y-2">
            {backlinks.length > 0 ? (
              backlinks.map(note => {
                const locked = isNoteLocked(note.id);
                return (
                <div 
                  key={note.id}
                  onClick={() => onNoteClick(note.id)}
                  className="bg-card p-2 rounded-lg border border-border/50 cursor-pointer hover:border-primary transition-all relative"
                >
                  <div className={locked ? 'blur-[4px] opacity-70 select-none' : ''}>
                    <div className="text-xs font-medium text-primary mb-1 flex items-center">
                      <FileText size={12} className="mr-1" /> {note.title || 'Untitled'}
                    </div>
                    <div className="text-[10px] text-muted-foreground line-clamp-2">
                      {note.content?.substring(0, 100) || '...'}
                    </div>
                  </div>
                  {locked && (
                    <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
                       <Lock size={16} className="text-foreground/50 drop-shadow-md" />
                    </div>
                  )}
                </div>
              )})
            ) : (
              <div className="text-xs text-muted-foreground italic">
                {t('chat.noBacklinks')}
              </div>
            )}
          </div>
        </div>

        <div>
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center">
            <LinkIcon size={12} className="mr-1" /> {t('chat.outgoingLinks')}
          </h4>
          <div className="space-y-2">
            {outgoingLinks.length > 0 ? (
              outgoingLinks.map(note => {
                const locked = isNoteLocked(note.id);
                return (
                <div 
                  key={note.id}
                  onClick={() => onNoteClick(note.id)}
                  className="bg-card p-2 rounded-lg border border-border/50 cursor-pointer hover:border-primary transition-all relative"
                >
                  <div className={locked ? 'blur-[4px] opacity-70 select-none' : ''}>
                    <div className="text-xs font-medium text-primary mb-1 flex items-center">
                      <FileText size={12} className="mr-1" /> {note.title || 'Untitled'}
                    </div>
                    <div className="text-[10px] text-muted-foreground line-clamp-2">
                      {note.content?.substring(0, 100) || '...'}
                    </div>
                  </div>
                  {locked && (
                    <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
                       <Lock size={16} className="text-foreground/50 drop-shadow-md" />
                    </div>
                  )}
                </div>
              )})
            ) : (
              <div className="text-xs text-muted-foreground italic">
                No outgoing links found.
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="p-4 border-t border-border/50 shrink-0">
        <div className="relative">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder={t('chat.placeholder')}
            disabled={isTyping}
            className="w-full bg-background border border-border rounded-full py-2 pl-4 pr-10 text-sm text-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all disabled:opacity-50"
          />
          <button 
            onClick={handleSend}
            disabled={isTyping}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-muted-foreground hover:text-primary transition-colors disabled:opacity-50"
          >
            {isTyping ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
          </button>
        </div>
      </div>
    </div>
  );
}
