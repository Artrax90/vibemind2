import React, { useState, useMemo } from 'react';
import { Send, Bot, Link as LinkIcon, FileText } from 'lucide-react';
import { Note } from '../App';

type ChatProps = {
  notes: Note[];
  activeNoteId: string | null;
  onNoteClick: (id: string) => void;
};

export default function Chat({ notes, activeNoteId, onNoteClick }: ChatProps) {
  const [messages, setMessages] = useState([
    { 
      role: 'assistant', 
      content: 'I am VibeMind AI. I have indexed your notes. What would you like to know?',
      citations: [] as {id: string, title: string, snippet: string}[]
    }
  ]);
  const [input, setInput] = useState('');

  const handleSend = () => {
    if (!input.trim()) return;
    setMessages([...messages, { role: 'user', content: input, citations: [] }]);
    setInput('');
    
    // Mock AI response with citations
    setTimeout(() => {
      setMessages(prev => [...prev, { 
        role: 'assistant', 
        content: 'Based on your notes, you are building a cyberpunk note-taking app. [1] It also includes ideas for the project. [2]',
        citations: [
          { id: '1', title: 'Welcome to VibeMind', snippet: 'Your cyberpunk AI note-taking ecosystem.' },
          { id: '2', title: 'Ideas', snippet: 'Some ideas for the project.' }
        ]
      }]);
    }, 1000);
  };

  // Calculate backlinks dynamically
  const backlinks = useMemo(() => {
    if (!activeNoteId) return [];
    const activeNote = notes.find(n => n.id === activeNoteId);
    if (!activeNote) return [];

    // Case-insensitive regex for [[Note Title]] with optional spaces
    // Escape special characters in title for regex
    const escapedTitle = activeNote.title.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const linkPattern = new RegExp(`\\[\\[\\s*${escapedTitle}\\s*\\]\\]`, 'i');
    
    return notes.filter(n => n.id !== activeNoteId && linkPattern.test(n.content));
  }, [notes, activeNoteId]);

  // Calculate outgoing links dynamically
  const outgoingLinks = useMemo(() => {
    if (!activeNoteId) return [];
    const activeNote = notes.find(n => n.id === activeNoteId);
    if (!activeNote) return [];

    // Find all [[Note Title]] in the current note's content
    const matches = Array.from(activeNote.content.matchAll(/\[\[(.*?)\]\]/g));
    const linkedTitles = matches.map(m => m[1].trim().toLowerCase());
    
    return notes.filter(n => n.id !== activeNoteId && linkedTitles.includes(n.title.toLowerCase()));
  }, [notes, activeNoteId]);

  return (
    <div className="w-80 bg-background flex flex-col border-l border-border/50">
      <div className="p-4 border-b border-border/50">
        <h3 className="text-sm font-semibold text-primary flex items-center">
          <Bot size={16} className="mr-2" />
          AI Assistant (RAG)
        </h3>
      </div>
      
      <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin">
        {messages.map((msg, i) => (
          <div key={i} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
            <div className={`max-w-[85%] rounded-lg p-3 text-sm ${
              msg.role === 'user' 
                ? 'bg-primary text-primary-foreground' 
                : 'bg-secondary text-foreground border border-border/50'
            }`}>
              {msg.content}
            </div>
            
            {msg.citations && msg.citations.length > 0 && (
              <div className="mt-2 space-y-2 w-full pr-4">
                {msg.citations.map((cit, idx) => (
                  <div key={idx} className="bg-card border border-border/50 rounded-lg p-2 text-xs cursor-pointer hover:border-primary transition-all">
                    <div className="font-semibold text-primary flex items-center mb-1">
                      <span className="bg-primary text-primary-foreground rounded-full w-4 h-4 flex items-center justify-center mr-1 text-[10px]">{idx + 1}</span>
                      {cit.title}
                    </div>
                    <div className="text-muted-foreground italic line-clamp-2">"{cit.snippet}"</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="p-4 border-t border-border/50 bg-secondary/30 shrink-0 max-h-[40%] overflow-y-auto">
        <div className="mb-6">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center">
            <LinkIcon size={12} className="mr-1" /> Backlinks
          </h4>
          <div className="space-y-2">
            {backlinks.length > 0 ? (
              backlinks.map(note => (
                <div 
                  key={note.id}
                  onClick={() => onNoteClick(note.id)}
                  className="bg-card p-2 rounded-lg border border-border/50 cursor-pointer hover:border-primary transition-all"
                >
                  <div className="text-xs font-medium text-primary mb-1 flex items-center">
                    <FileText size={12} className="mr-1" /> {note.title}
                  </div>
                  <div className="text-[10px] text-muted-foreground line-clamp-2">
                    {note.content.substring(0, 100)}...
                  </div>
                </div>
              ))
            ) : (
              <div className="text-xs text-muted-foreground italic">
                No backlinks found for this note.
              </div>
            )}
          </div>
        </div>

        <div>
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center">
            <LinkIcon size={12} className="mr-1" /> Outgoing Links
          </h4>
          <div className="space-y-2">
            {outgoingLinks.length > 0 ? (
              outgoingLinks.map(note => (
                <div 
                  key={note.id}
                  onClick={() => onNoteClick(note.id)}
                  className="bg-card p-2 rounded-lg border border-border/50 cursor-pointer hover:border-primary transition-all"
                >
                  <div className="text-xs font-medium text-primary mb-1 flex items-center">
                    <FileText size={12} className="mr-1" /> {note.title}
                  </div>
                  <div className="text-[10px] text-muted-foreground line-clamp-2">
                    {note.content.substring(0, 100)}...
                  </div>
                </div>
              ))
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
            placeholder="Ask your notes..."
            className="w-full bg-background border border-border rounded-full py-2 pl-4 pr-10 text-sm text-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
          />
          <button 
            onClick={handleSend}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-muted-foreground hover:text-primary transition-colors"
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
