import React, { useState, useEffect, useRef } from 'react';
import { Note } from '../App';
import { FileText, Eye, Edit3, Wand2, Share2 } from 'lucide-react';
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

  return (
    <div className="flex flex-col h-full bg-background relative">
      <div className="pl-16 md:pl-8 pr-[140px] md:pr-[280px] py-4 flex items-center justify-between border-b border-border/50">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="text-2xl font-bold text-foreground bg-transparent outline-none flex-1"
          placeholder="Note Title"
        />
        <div className="flex items-center space-x-4 ml-4">
          <div className="text-xs text-muted-foreground">
            {isSaving ? (
              <span className="text-primary animate-pulse">Saving...</span>
            ) : (
              <span>Saved</span>
            )}
          </div>

          <button 
            onClick={handleSummarize}
            disabled={isSummarizing}
            className="flex items-center px-3 py-1.5 bg-secondary hover:bg-secondary/80 text-primary text-sm rounded-lg border border-border/50 transition-colors disabled:opacity-50 hover:glow-primary"
          >
            <Wand2 size={14} className={`mr-2 ${isSummarizing ? 'animate-spin' : ''}`} />
            {isSummarizing ? 'Summarizing...' : t('editor.summarize')}
          </button>
          
          {onShare && (
            <button 
              onClick={onShare}
              className="flex items-center px-3 py-1.5 bg-secondary hover:bg-secondary/80 text-primary text-sm rounded-lg border border-border/50 transition-colors hover:glow-primary"
            >
              <Share2 size={14} className="mr-2" />
              Share
            </button>
          )}
        </div>
      </div>
      
      <div className="flex-1 overflow-y-auto p-8 scrollbar-thin">
        {isPreview ? (
          <div className="prose prose-invert max-w-none text-foreground" onClick={handleContentClick}>
            <ReactMarkdown 
              remarkPlugins={[remarkGfm]}
              components={{
                code({node, inline, className, children, ...props}: any) {
                  const match = /language-(\w+)/.exec(className || '')
                  return !inline && match ? (
                    <SyntaxHighlighter
                      style={vscDarkPlus as any}
                      language={match[1]}
                      PreTag="div"
                      {...props}
                    >
                      {String(children).replace(/\n$/, '')}
                    </SyntaxHighlighter>
                  ) : (
                    <code className="bg-secondary px-1.5 py-0.5 rounded text-primary" {...props}>
                      {children}
                    </code>
                  )
                },
                p({children}) {
                  // We need to dangerously set inner HTML to render the tags and wikilinks properly
                  // In a real app, we'd use a custom remark plugin for this
                  if (typeof children === 'string') {
                    return <p dangerouslySetInnerHTML={{ __html: renderContent(children) }} />;
                  }
                  // Handle mixed content (arrays of strings/elements)
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
            className="w-full h-full bg-transparent text-foreground resize-none outline-none font-mono text-sm leading-relaxed"
            placeholder="Start typing..."
          />
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
