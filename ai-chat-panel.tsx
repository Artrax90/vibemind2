"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Bot, Copy, MoreVertical, Send, Sparkles, User, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { sendChat } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { ChatMessage } from "@/lib/types";

interface Message extends ChatMessage {
  id: string;
  timeLabel: string;
}

const MODELS = [
  { value: "ollama", label: "Ollama" },
  { value: "openai", label: "OpenAI" },
  { value: "gemini", label: "Gemini" },
  { value: "anthropic", label: "Anthropic" },
  { value: "mistral", label: "Mistral" },
  { value: "custom", label: "Custom" },
];

interface AIChatPanelProps {
  onClose: () => void;
}

export function AIChatPanel({ onClose }: AIChatPanelProps) {
  const { locale } = useI18n();
  const isRu = locale === "ru";
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [selectedModel, setSelectedModel] = useState("openai");
  const [isTyping, setIsTyping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const text = {
    title: isRu ? "AI-чат" : "AI Chat",
    chooseProvider: isRu ? "Выбери провайдера" : "Choose a provider",
    empty: isRu ? "Подключи провайдера в настройках и задавай вопросы по своим заметкам." : "Connect a provider in Settings, then ask the assistant about your notes.",
    copy: isRu ? "Скопировать" : "Copy",
    thinking: isRu ? "Думаю..." : "Thinking...",
    placeholder: isRu ? "Спроси что-нибудь по заметкам..." : "Ask about your notes...",
    footer: isRu ? "Enter для отправки, Shift+Enter для новой строки." : "Enter to send, Shift+Enter for a new line.",
    chatError: isRu ? "Не удалось отправить запрос в чат." : "Chat request failed.",
  };

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isTyping]);

  const formatTime = (date: Date) =>
    date.toLocaleTimeString(isRu ? "ru-RU" : "en-US", {
      hour: "2-digit",
      minute: "2-digit",
    });

  const handleSend = async () => {
    if (!input.trim() || isTyping) return;
    const nextMessages: Message[] = [...messages, { id: Date.now().toString(), role: "user", content: input.trim(), timeLabel: formatTime(new Date()) }];
    setMessages(nextMessages);
    setInput("");
    setIsTyping(true);
    setError(null);
    try {
      const response = await sendChat(nextMessages.map(({ role, content }) => ({ role, content })), selectedModel);
      setMessages((prev) => [...prev, { id: `${Date.now()}-assistant`, role: "assistant", content: response.message, timeLabel: formatTime(new Date()) }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : text.chatError);
    } finally {
      setIsTyping(false);
    }
  };

  return (
    <div className="flex h-full w-full flex-col glass-strong">
      <div className="flex items-center justify-between border-b border-border/50 px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-accent">
            <Sparkles className="h-4 w-4 text-white" />
          </div>
          <span className="font-semibold">{text.title}</span>
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7 hover:glow-primary" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="border-b border-border/50 px-4 py-2">
        <Select value={selectedModel} onValueChange={setSelectedModel}>
          <SelectTrigger className="w-full bg-secondary/50">
            <SelectValue placeholder={text.chooseProvider} />
          </SelectTrigger>
          <SelectContent>
            {MODELS.map((model) => (
              <SelectItem key={model.value} value={model.value}>
                {model.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <ScrollArea className="flex-1 px-4 py-4 scrollbar-thin" ref={scrollRef}>
        <div className="space-y-4">
          {messages.length === 0 ? <div className="rounded-2xl border border-dashed border-border/60 bg-secondary/30 p-4 text-sm text-muted-foreground">{text.empty}</div> : null}

          <AnimatePresence initial={false}>
            {messages.map((message, index) => (
              <motion.div key={message.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: index * 0.03 }} className={cn("flex gap-3", message.role === "user" ? "flex-row-reverse" : "")}>
                <div className={cn("flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full", message.role === "user" ? "bg-primary" : "bg-gradient-to-br from-primary/50 to-accent/50")}>
                  {message.role === "user" ? <User className="h-4 w-4 text-primary-foreground" /> : <Bot className="h-4 w-4 text-white" />}
                </div>
                <div className={cn("group relative max-w-[85%] rounded-2xl px-4 py-3", message.role === "user" ? "rounded-tr-sm bg-primary text-primary-foreground" : "rounded-tl-sm bg-secondary/50 text-foreground")}>
                  <p className="whitespace-pre-wrap text-sm leading-relaxed">{message.content}</p>
                  <p className="mt-1 text-[10px] opacity-60">{message.timeLabel}</p>
                  <div className={cn("absolute top-2 opacity-0 transition-opacity group-hover:opacity-100", message.role === "user" ? "-left-8" : "-right-8")}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-6 w-6">
                          <MoreVertical className="h-3 w-3" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align={message.role === "user" ? "start" : "end"}>
                        <DropdownMenuItem onClick={() => navigator.clipboard.writeText(message.content)}>
                          <Copy className="mr-2 h-3.5 w-3.5" />
                          {text.copy}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>

          {isTyping ? (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-primary/50 to-accent/50">
                <Bot className="h-4 w-4 text-white" />
              </div>
              <div className="rounded-2xl rounded-tl-sm bg-secondary/50 px-4 py-3 text-sm text-muted-foreground">{text.thinking}</div>
            </motion.div>
          ) : null}
        </div>
      </ScrollArea>

      <div className="border-t border-border/50 p-4">
        {error ? <p className="mb-2 text-xs text-destructive">{error}</p> : null}
        <div className="flex gap-2">
          <Textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                handleSend();
              }
            }}
            placeholder={text.placeholder}
            className="min-h-[44px] max-h-32 resize-none bg-secondary/50"
            rows={1}
          />
          <Button onClick={handleSend} disabled={!input.trim() || isTyping} className="h-11 w-11 shrink-0 glow-primary">
            <Send className="h-4 w-4" />
          </Button>
        </div>
        <p className="mt-2 text-center text-[10px] text-muted-foreground">{text.footer}</p>
      </div>
    </div>
  );
}

