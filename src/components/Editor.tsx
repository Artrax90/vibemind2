import React, { useState, useEffect, useRef } from 'react';
import { Note } from '../types';
import { api } from '../api/client';
import { FileText, Eye, Edit3, Wand2, Share2, Bold, Italic, Link, Image, List, ListOrdered, Code, Table, CheckCircle, Cloud, CloudOff, Hash, Network } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
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
  const [showCodeDropdown, setShowCodeDropdown] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [showAutocomplete, setShowAutocomplete] = useState(false);
  const [autocompleteQuery, setAutocompleteQuery] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isReadOnly = isPreview || (note && note.permission === 'read');

  useEffect(() => {
    setContent(note.content);
    setTitle(note.title);
  }, [note.id, note.content, note.title]);

  useEffect(() => {
    if (isReadOnly || (content === note.content && title === note.title)) return;
    
    setIsSaving(true);
    const timer = setTimeout(() => {
      onUpdate(note.id, { content, title });
      setIsSaving(false);
    }, 1000);

    return () => clearTimeout(timer);
  }, [content, title, note.id, note.content, note.title, onUpdate]);

  const handleSummarize = async () => {
    if (!content.trim()) return;
    setIsSummarizing(true);
    try {
      const response = await api.summarize(content);
      if (response && response.summary) {
        const summary = `\n\n> **AI Summary:**\n${response.summary}`;
        const newContent = content + summary;
        setContent(newContent);
        onUpdate(note.id, { content: newContent });
      }
    } catch (error) {
      console.error('Summarization failed:', error);
    } finally {
      setIsSummarizing(false);
    }
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

  const handlePaste = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        const blob = items[i].getAsFile();
        if (!blob) continue;
        
        const formData = new FormData();
        formData.append('file', blob, 'pasted_image.png');

        try {
          const response = await api.uploadFile(formData);
          if (response.url) {
            insertMarkdown(`![pasted image](`, `${response.url})`);
          }
        } catch (error) {
          console.error('Paste upload failed:', error);
        }
      }
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (file.type.startsWith('image/')) {
          const formData = new FormData();
          formData.append('file', file);
          
          try {
            const response = await api.uploadFile(formData);
            if (response.url) {
              insertMarkdown(`![${file.name}](`, `${response.url})`);
            }
          } catch (error) {
            console.error('Drop upload failed:', error);
          }
        }
      }
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
      const hasClosing = textAfterCursor.startsWith(']]');
      const newContent = content.substring(0, startPos) + linkTitle + (hasClosing ? '' : ']]') + textAfterCursor;
      setContent(newContent);
      setShowAutocomplete(false);
      
      setTimeout(() => {
        if (textareaRef.current) {
          const newCursorPos = startPos + linkTitle.length + (hasClosing ? 0 : 2);
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

  const insertWikilinkBtn = () => {
    insertMarkdown('[[', ']]');
  };

  const insertCodeBlock = (lang: string = '') => {
    if (!textareaRef.current) return;
    const start = textareaRef.current.selectionStart;
    const end = textareaRef.current.selectionEnd;
    const selection = content.substring(start, end);
    
    const prefix = '```' + lang + '\n';
    const suffix = '\n```';
    
    const newContent = content.substring(0, start) + prefix + selection + suffix + content.substring(end);
    setContent(newContent);
    setShowCodeDropdown(false);
    
    setTimeout(() => {
      if (textareaRef.current) {
        // If no selection, put cursor inside the block
        // If selection, put cursor at the end of the block
        const newPos = selection.length === 0 
          ? start + prefix.length 
          : start + prefix.length + selection.length + suffix.length;
        textareaRef.current.setSelectionRange(newPos, newPos);
        textareaRef.current.focus();
      }
    }, 0);
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await api.uploadFile(formData);
      if (response.url) {
        insertMarkdown(`![${file.name}](`, `${response.url})`);
      }
    } catch (error) {
      console.error('Upload failed:', error);
      alert('Failed to upload image');
    }
    
    // Reset input
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const insertLink = () => {
    insertMarkdown('[', '](url)');
  };

  const insertImage = () => {
    insertMarkdown('![alt](', ')');
  };

  const insertList = () => {
    insertMarkdown('- ');
  };

  const insertOrderedList = () => {
    if (!textareaRef.current) return;
    const start = textareaRef.current.selectionStart;
    const end = textareaRef.current.selectionEnd;
    const selection = content.substring(start, end);
    
    if (selection.includes('\n')) {
      const lines = selection.split('\n');
      const numberedLines = lines.map((line, i) => `${i + 1}. ${line}`).join('\n');
      const newContent = content.substring(0, start) + numberedLines + content.substring(end);
      setContent(newContent);
      
      setTimeout(() => {
        if (textareaRef.current) {
          const newPos = start + numberedLines.length;
          textareaRef.current.setSelectionRange(newPos, newPos);
          textareaRef.current.focus();
        }
      }, 0);
    } else {
      insertMarkdown('1. ');
    }
  };

  const insertBold = () => {
    insertMarkdown('**', '**');
  };

  const insertItalic = () => {
    insertMarkdown('_', '_');
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
      <div className="pl-16 pr-4 md:px-8 py-6 flex items-center justify-between border-b border-border/50">
        <div className="flex items-center flex-1">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={isReadOnly}
            className={`text-2xl font-bold text-foreground bg-transparent outline-none flex-1 ${isReadOnly ? 'cursor-default' : ''}`}
            placeholder={t('editor.noteTitlePlaceholder')}
          />
          {!!note.isSharedByMe && (
            <div className="ml-2 px-2 py-1 bg-primary/10 rounded-md flex items-center text-primary" title="Shared">
              <Share2 size={14} className="mr-1" />
              <span className="text-[10px] font-bold uppercase tracking-wider">Shared</span>
            </div>
          )}
        </div>
        
        <div className="flex items-center space-x-4">
          {!isReadOnly && (
            <div className="flex items-center space-x-1 text-xs font-mono">
              {isSaving ? (
                <>
                  <Cloud className="w-4 h-4 text-primary animate-pulse" />
                  <span className="text-primary uppercase tracking-widest">{t('editor.syncing')}</span>
                </>
              ) : (
                <>
                  <CheckCircle className="w-4 h-4 text-emerald-500" />
                  <span className="text-emerald-500 uppercase tracking-widest">{t('editor.saved')}</span>
                </>
              )}
            </div>
          )}

          {!isReadOnly && (
            <button 
              onClick={handleSummarize}
              disabled={isSummarizing}
              className="p-2 text-primary hover:bg-primary/10 rounded-lg transition-all hover:scale-110 active:scale-95 disabled:opacity-50"
              title={t('editor.summarize')}
            >
              <Wand2 size={20} className={isSummarizing ? 'animate-spin' : ''} />
            </button>
          )}
          
          {onShare && note.permission === 'owner' && (
            <button 
              onClick={onShare}
              className="p-2 text-muted-foreground hover:text-primary rounded-lg transition-all hover:scale-110 active:scale-95"
              title="Share"
            >
              <Share2 size={20} />
            </button>
          )}
        </div>
      </div>

      {/* Toolbar */}
      {!isPreview && !isReadOnly && (
        <div className="pl-16 pr-4 md:px-8 py-2 flex items-center space-x-1 border-b border-border/30 bg-secondary/20 overflow-x-auto no-scrollbar">
          <button onClick={insertBold} className="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-primary transition-colors" title="Bold"><Bold size={16} /></button>
          <button onClick={insertItalic} className="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-primary transition-colors" title="Italic"><Italic size={16} /></button>
          <button onClick={insertLink} className="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-primary transition-colors" title="Link"><Link size={16} /></button>
          
          <div className="relative">
            <button 
              onClick={() => fileInputRef.current?.click()} 
              className="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-primary transition-colors" 
              title="Image"
            >
              <Image size={16} />
            </button>
            <input 
              type="file" 
              ref={fileInputRef} 
              onChange={handleImageUpload} 
              className="hidden" 
              accept="image/*"
            />
          </div>

          <button onClick={insertOrderedList} className="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-primary transition-colors" title="Numbered List"><ListOrdered size={16} /></button>
          
          <div className="w-px h-4 bg-border/50 mx-2"></div>
          
          <button onClick={insertList} className="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-primary transition-colors" title="List"><List size={16} /></button>
          
          <div className="relative">
            <button 
              onClick={() => setShowCodeDropdown(!showCodeDropdown)} 
              className={`p-1.5 rounded hover:bg-secondary transition-colors ${showCodeDropdown ? 'bg-secondary text-primary' : 'text-muted-foreground hover:text-primary'}`} 
              title="Code Block"
            >
              <Code size={16} />
            </button>
            
            {showCodeDropdown && (
              <div className="absolute left-0 top-full mt-1 z-50 bg-popover border border-border rounded-md shadow-lg p-1 w-32">
                {['python', 'javascript', 'bash', 'yaml', 'json', 'sql', 'markdown'].map(lang => (
                  <button
                    key={lang}
                    onClick={() => insertCodeBlock(lang)}
                    className="w-full text-left px-2 py-1 text-xs hover:bg-secondary rounded text-foreground capitalize"
                  >
                    {lang}
                  </button>
                ))}
                <button
                  onClick={() => insertCodeBlock('')}
                  className="w-full text-left px-2 py-1 text-xs hover:bg-secondary rounded text-muted-foreground border-t border-border/50 mt-1"
                >
                  {t('editor.plainText')}
                </button>
              </div>
            )}
          </div>

          <button onClick={insertWikilinkBtn} className="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-primary transition-colors font-bold text-xs" title="Wikilink">[[ ]]</button>
          <button onClick={insertTable} className="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-primary transition-colors" title="Table"><Table size={16} /></button>
        </div>
      )}
      
      <div className="flex-1 overflow-y-auto p-8 scrollbar-thin flex flex-col">
        <div className="flex-1">
          {isPreview || isReadOnly ? (
            <div className="prose prose-invert max-w-none text-foreground/80" onClick={handleContentClick}>
              <ReactMarkdown 
                remarkPlugins={[remarkGfm, remarkBreaks]}
                components={{
                  code({node, inline, className, children, ...props}: any) {
                    const match = /language-(\w+)/.exec(className || '')
                    return !inline && match ? (
                      <SyntaxHighlighter
                        style={vscDarkPlus as any}
                        language={match[1]}
                        PreTag="div"
                        className="rounded-lg border border-border/50"
                        {...props}
                      >
                        {String(children).replace(/\n$/, '')}
                      </SyntaxHighlighter>
                    ) : (
                      <code className="bg-secondary px-1 rounded" {...props}>
                        {children}
                      </code>
                    )
                  },
                  p({children}) {
                    const childrenArray = React.Children.toArray(children);
                    
                    // If it's just a single br, render an empty line
                    if (childrenArray.length === 1 && React.isValidElement(childrenArray[0]) && childrenArray[0].type === 'br') {
                        return <p className="min-h-[1.5em] m-0 leading-relaxed">&nbsp;</p>;
                    }

                    return (
                      <p className="mb-4 leading-relaxed">
                        {childrenArray.map((child, i) => {
                          if (typeof child === 'string') {
                            // If the string is entirely empty or just whitespace, and it's the only child
                            if (child.trim() === '' && childrenArray.length === 1) {
                                return <span key={i} className="inline-block min-h-[1.5em] w-full">&nbsp;</span>;
                            }
                            return <span key={i} dangerouslySetInnerHTML={{ __html: renderContent(child) }} />;
                          }
                          return <React.Fragment key={i}>{child}</React.Fragment>;
                        })}
                      </p>
                    );
                  },
                  ol({children}) {
                    return <ol className="list-decimal list-inside my-4 space-y-1">{children}</ol>;
                  },
                  ul({children}) {
                    return <ul className="list-disc list-inside my-4 space-y-1">{children}</ul>;
                  },
                  li({children}) {
                    // We need to apply renderContent to text inside li as well
                    return (
                      <li className="text-foreground/80">
                        {React.Children.map(children, child => {
                          if (typeof child === 'string') {
                            return <span dangerouslySetInnerHTML={{ __html: renderContent(child) }} />;
                          }
                          return child;
                        })}
                      </li>
                    );
                  },
                  table({children}) {
                    return (
                      <div className="overflow-x-auto my-4 border border-border/50 rounded-lg">
                        <table className="min-w-full divide-y divide-border/50">
                          {children}
                        </table>
                      </div>
                    )
                  },
                  th({children}) {
                    return <th className="px-4 py-2 bg-secondary/50 text-left text-xs font-bold uppercase tracking-wider text-primary">{children}</th>
                  },
                  td({children}) {
                    return <td className="px-4 py-2 border-t border-border/30 text-sm">{children}</td>
                  },
                  a({node, children, ...props}: any) {
                    return (
                      <a 
                        {...props} 
                        className="text-primary hover:underline decoration-primary/50 underline-offset-4 transition-all"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {children}
                      </a>
                    )
                  }
                }}
              >
                {content.replace(/\n{2,}/g, (match) => '\n\n' + '\u00A0\n\n'.repeat(match.length - 2))}
              </ReactMarkdown>
            </div>
          ) : (
            <textarea
              ref={textareaRef}
              value={content}
              onChange={handleContentChange}
              onPaste={handlePaste}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              className="w-full h-full bg-transparent text-foreground/80 resize-none outline-none font-mono text-sm leading-relaxed"
              placeholder={t('editor.startWriting')}
            />
          )}
        </div>

        {/* Related Notes Section */}
        {relatedNotes.length > 0 && (
          <div className="mt-12 pt-8 border-t border-border/30">
            <h3 className="text-sm font-bold uppercase tracking-widest text-muted-foreground mb-4 flex items-center">
              <Network size={14} className="mr-2 text-primary" /> {t('editor.relatedNotes')}
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {relatedNotes.map(rn => (
                <div 
                  key={rn.id}
                  onClick={() => onWikilinkClick && onWikilinkClick(rn.title)}
                  className="p-4 rounded-xl border border-border/50 bg-secondary/10 hover:bg-primary/5 hover:border-primary/30 transition-all cursor-pointer group"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-bold text-foreground group-hover:text-primary transition-colors truncate">{rn.title}</span>
                    <FileText size={14} className="text-muted-foreground group-hover:text-primary transition-colors" />
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                    {rn.content.replace(/[#*`[\]]/g, '')}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Autocomplete Dropdown */}
      {showAutocomplete && !isPreview && (
        <div className="absolute z-50 bg-popover border border-border rounded-md shadow-lg p-1 max-h-48 overflow-y-auto w-64 bottom-8 left-8">
          <div className="text-xs text-muted-foreground px-2 py-1 mb-1 border-b border-border/50">{t('editor.linkToNote')}</div>
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
              <span className="truncate text-muted-foreground">{t('editor.create')}: {autocompleteQuery}</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
