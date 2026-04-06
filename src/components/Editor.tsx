import React, { useState, useEffect, useRef } from 'react';
import { Note } from '../App';
import { FileText, Eye, Edit3, Wand2, Share2, Bold, Italic, List, Link, Code, Table, Link2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { useLanguage } from '../contexts/LanguageContext';

type EditorProps = {
  note: Note;
  onUpdate: (id: string, updates: Partial<Note>) => void;
  onWikilinkClick?: (title: string) => void;
  onTagClick?: (tag: string) => void;
  isPreview?: boolean;
  onShare?: () => void;
  allNotes?: Note[];
};

export default function Editor({ note, onUpdate, onWikilinkClick, onTagClick, isPreview = false, onShare, allNotes = [] }: EditorProps) {
  const { t } = useLanguage();
  const [content, setContent] = useState(note.content);
  const [title, setTitle] = useState(note.title);
  const [isSaving, setIsSaving] = useState(false);
  const [isSummarizing, setIsSummarizing] = useState(false);
  
  const [showAutocomplete, setShowAutocomplete] = useState(false);
  const [autocompleteQuery, setAutocompleteQuery] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setContent(note.content);
    setTitle(note.title);
  }, [note.id]);

  useEffect(() => {
    if (content === note.content && title === note.title) return;
    
    setIsSaving(true);
    const timer = setTimeout(() => {
      onUpdate(note.id, { content, title });
      setIsSaving(false);
    }, 1000);

    return () => clearTimeout(timer);
  }, [content, title, note.id, note.content, note.title, onUpdate]);

  const handleSummarize = () => {
    setIsSummarizing(true);
    // Mock AI Summarization
    setTimeout(() => {
      const summary = "\n\n> **TL;DR:** This is an AI-generated summary of the note.";
      const newContent = content + summary;
      setContent(newContent);
      onUpdate(note.id, { content: newContent });
      setIsSummarizing(false);
    }, 1500);
  };

  // Custom renderer for tags and wikilinks
  const renderContent = (text: string) => {
    // Replace [[wikilinks]]
    let parsed = text.replace(/\[\[(.*?)\]\]/g, '<span class="wikilink text-primary cursor-pointer hover:underline" data-title="$1">[[$1]]</span>');
    // Replace #tags
    parsed = parsed.replace(/(^|\s)#([^\s#]+)/g, '$1<span class="tag text-primary bg-primary/10 px-1.5 py-0.5 rounded text-sm cursor-pointer hover:bg-primary/20" data-tag="$2">#$2</span>');
    return parsed;
  };

  const handleContentClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.classList.contains('wikilink')) {
      const title = target.getAttribute('data-title');
      if (title && onWikilinkClick) onWikilinkClick(title);
    } else if (target.classList.contains('tag')) {
      const tag = target.getAttribute('data-tag');
      if (tag && onTagClick) onTagClick(tag);
    }
  };

  const handleContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setContent(val);
    
    const cursor = e.target.selectionStart;
    const textBeforeCursor = val.substring(0, cursor);
    const match = textBeforeCursor.match(/\[\[([^\]]*)$/);
    
    if (match) {
      setAutocompleteQuery(match[1]);
      setShowAutocomplete(true);
    } else {
      setShowAutocomplete(false);
    }
  };

  const insertWikilink = (linkTitle: string) => {
    if (!textareaRef.current) return;
    const cursor = textareaRef.current.selectionStart;
    const textBeforeCursor = content.substring(0, cursor);
    const textAfterCursor = content.substring(cursor);
    
    const match = textBeforeCursor.match(/\[\[([^\]]*)$/);
    if (match) {
      const startPos = cursor - match[1].length;
      const newContent = content.substring(0, startPos) + linkTitle + ']]' + textAfterCursor;
      setContent(newContent);
      setShowAutocomplete(false);
      
      setTimeout(() => {
        if (textareaRef.current) {
          const newCursorPos = startPos + linkTitle.length + 2;
          textareaRef.current.setSelectionRange(newCursorPos, newCursorPos);
          textareaRef.current.focus();
        }
      }, 0);
    }
  };

  const filteredNotes = allNotes.filter(n => 
    n.title.toLowerCase().includes(autocompleteQuery.toLowerCase()) && n.id !== note.id
  );

  const insertMarkdown = (prefix: string, suffix: string = '') => {
    if (!textareaRef.current) return;
    const start = textareaRef.current.selectionStart;
    const end = textareaRef.current.selectionEnd;
    const selection = content.substring(start, end);
    const newContent = content.substring(0, start) + prefix + selection + suffix + content.substring(end);
    setContent(newContent);
    
    setTimeout(() => {
      if (textareaRef.current) {
        const newPos = start + prefix.length + selection.length + suffix.length;
        textareaRef.current.setSelectionRange(newPos, newPos);
        textareaRef.current.focus();
      }
    }, 0);
  };

  const insertTable = () => {
    const tableTemplate = "\n| Header 1 | Header 2 |\n| -------- | -------- |\n| Cell 1   | Cell 2   |\n";
    insertMarkdown(tableTemplate);
  };

  // Simple logic to find related notes (by tags or common words in title)
  const relatedNotes = allNotes.filter(n => 
    n.id !== note.id && 
    (n.title.split(' ').some(word => word.length > 3 && note.title.includes(word)) || 
     n.content.includes(`[[${note.title}]]`) ||
     note.content.includes(`[[${n.title}]]`))
  ).slice(0, 3);

  return (
    <div className="flex flex-col h-full bg-background relative overflow-hidden">
      {/* Header */}
      <div className="px-8 py-4 flex items-center justify-between border-b border-border/30 bg-background/50 backdrop-blur-md z-10">
        <div className="flex items-center flex-1">
          <div className="p-2 bg-primary/10 rounded-lg mr-3">
            <FileText size={18} className="text-primary" />
          </div>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="text-xl font-bold text-foreground bg-transparent outline-none flex-1 tracking-tight"
            placeholder="Note Title"
          />
        </div>
        
        <div className="flex items-center space-x-3">
          <div className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground/50 mr-2">
            {isSaving ? (
              <span className="text-primary animate-pulse">Syncing...</span>
            ) : (
              <span>Synced</span>
            )}
          </div>

          <button 
            onClick={handleSummarize}
            disabled={isSummarizing}
            className="p-2 bg-secondary/50 hover:bg-primary/10 text-primary rounded-lg border border-border/50 transition-all hover:glow-primary disabled:opacity-50"
            title={t('editor.summarize')}
          >
            <Wand2 size={16} className={isSummarizing ? 'animate-spin' : ''} />
          </button>
          
          {onShare && (
            <button 
              onClick={onShare}
              className="p-2 bg-secondary/50 hover:bg-primary/10 text-primary rounded-lg border border-border/50 transition-all hover:glow-primary"
              title="Share"
            >
              <Share2 size={16} />
            </button>
          )}
        </div>
      </div>

      {/* Toolbar */}
      {!isPreview && (
        <div className="px-8 py-2 border-b border-border/20 flex items-center space-x-1 bg-background/30">
          <button onClick={() => insertMarkdown('**', '**')} className="p-1.5 hover:bg-secondary rounded text-muted-foreground hover:text-foreground transition-colors" title="Bold"><Bold size={16} /></button>
          <button onClick={() => insertMarkdown('_', '_')} className="p-1.5 hover:bg-secondary rounded text-muted-foreground hover:text-foreground transition-colors" title="Italic"><Italic size={16} /></button>
          <div className="w-px h-4 bg-border/50 mx-1" />
          <button onClick={() => insertMarkdown('[[', ']]')} className="p-1.5 hover:bg-secondary rounded text-primary hover:bg-primary/10 transition-colors" title="Wiki-link"><Link2 size={16} /></button>
          <button onClick={() => insertMarkdown('```\n', '\n```')} className="p-1.5 hover:bg-secondary rounded text-muted-foreground hover:text-foreground transition-colors" title="Code Block"><Code size={16} /></button>
          <button onClick={() => insertMarkdown('- ')} className="p-1.5 hover:bg-secondary rounded text-muted-foreground hover:text-foreground transition-colors" title="List"><List size={16} /></button>
          <button onClick={() => insertMarkdown('[', '](url)')} className="p-1.5 hover:bg-secondary rounded text-muted-foreground hover:text-foreground transition-colors" title="Link"><Link size={16} /></button>
          <button onClick={insertTable} className="p-1.5 hover:bg-secondary rounded text-muted-foreground hover:text-foreground transition-colors" title="Table"><Table size={16} /></button>
        </div>
      )}
      
      <div className="flex-1 overflow-y-auto p-8 md:p-12 scrollbar-thin flex flex-col">
        <div className="flex-1 min-h-[400px]">
          {isPreview ? (
            <div className="prose prose-invert max-w-none text-foreground/90 leading-relaxed" onClick={handleContentClick}>
              <ReactMarkdown 
                remarkPlugins={[remarkGfm]}
                components={{
                  code({node, inline, className, children, ...props}: any) {
                    const match = /language-(\w+)/.exec(className || '')
                    return !inline && match ? (
                      <div className="relative group">
                        <div className="absolute right-2 top-2 text-[10px] font-bold text-muted-foreground/50 uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-opacity">{match[1]}</div>
                        <SyntaxHighlighter
                          style={vscDarkPlus as any}
                          language={match[1]}
                          PreTag="div"
                          className="rounded-xl border border-border/30 !bg-black/40 !p-4"
                          {...props}
                        >
                          {String(children).replace(/\n$/, '')}
                        </SyntaxHighlighter>
                      </div>
                    ) : (
                      <code className="bg-primary/10 px-1.5 py-0.5 rounded text-primary border border-primary/20" {...props}>
                        {children}
                      </code>
                    )
                  },
                  table({children}) {
                    return (
                      <div className="overflow-x-auto my-6 rounded-xl border border-border/30">
                        <table className="w-full border-collapse text-sm">
                          {children}
                        </table>
                      </div>
                    )
                  },
                  th({children}) {
                    return <th className="border-b border-border/30 bg-secondary/30 px-4 py-2 text-left font-bold text-primary">{children}</th>
                  },
                  td({children}) {
                    return <td className="border-b border-border/10 px-4 py-2">{children}</td>
                  },
                  p({children}) {
                    if (typeof children === 'string') {
                      return <p dangerouslySetInnerHTML={{ __html: renderContent(children) }} />;
                    }
                    if (Array.isArray(children)) {
                      return <p>{children.map((child, i) => {
                        if (typeof child === 'string') {
                          return <span key={i} dangerouslySetInnerHTML={{ __html: renderContent(child) }} />;
                        }
                        return <React.Fragment key={i}>{child}</React.Fragment>;
                      })}</p>;
                    }
                    return <p>{children}</p>;
                  }
                }}
              >
                {content}
              </ReactMarkdown>
            </div>
          ) : (
            <textarea
              ref={textareaRef}
              value={content}
              onChange={handleContentChange}
              className="w-full h-full bg-transparent text-foreground/80 resize-none outline-none font-mono text-sm leading-relaxed placeholder:text-muted-foreground/20"
              placeholder="Start your digital journey..."
            />
          )}
        </div>

        {/* Related Notes Section */}
        {relatedNotes.length > 0 && (
          <div className="mt-16 pt-8 border-t border-border/20">
            <h3 className="text-[10px] font-bold text-muted-foreground/50 uppercase tracking-widest mb-4">Related Notes</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {relatedNotes.map(rn => (
                <button 
                  key={rn.id}
                  onClick={() => onWikilinkClick && onWikilinkClick(rn.title)}
                  className="flex flex-col p-4 bg-secondary/20 border border-border/30 rounded-xl hover:border-primary/50 hover:bg-primary/5 transition-all group text-left"
                >
                  <div className="flex items-center mb-2">
                    <FileText size={14} className="text-primary/70 mr-2 group-hover:text-primary" />
                    <span className="text-sm font-medium text-foreground truncate">{rn.title}</span>
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-2">{rn.content.substring(0, 100)}</p>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Autocomplete Dropdown */}
      {showAutocomplete && !isPreview && (
        <div className="absolute z-50 bg-popover border border-border rounded-md shadow-lg p-1 max-h-48 overflow-y-auto w-64 bottom-8 left-8 glass-strong">
          <div className="text-xs text-muted-foreground px-2 py-1 mb-1 border-b border-border/50">Link to note</div>
          {filteredNotes.length > 0 ? (
            filteredNotes.map(n => (
              <button
                key={n.id}
                onClick={() => insertWikilink(n.title)}
                className="w-full text-left px-2 py-1.5 text-sm hover:bg-secondary rounded text-foreground flex items-center"
              >
                <FileText size={12} className="mr-2 text-primary" />
                <span className="truncate">{n.title}</span>
              </button>
            ))
          ) : (
            <button
              onClick={() => insertWikilink(autocompleteQuery)}
              className="w-full text-left px-2 py-1.5 text-sm hover:bg-secondary rounded text-foreground flex items-center"
            >
              <Edit3 size={12} className="mr-2 text-muted-foreground" />
              <span className="truncate text-muted-foreground">Create: {autocompleteQuery}</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
