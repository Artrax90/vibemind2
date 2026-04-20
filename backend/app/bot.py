import asyncio
import logging
import traceback
import ast
import os
import uuid
import re
import json
import difflib
import html
import io
import base64
from typing import Dict, Any, List, Optional
from datetime import datetime, timedelta
from jose import jwt
from aiogram import Bot, Dispatcher, types, F
from aiogram.filters import Command
from aiogram.types import FSInputFile
from aiogram.client.session.aiohttp import AiohttpSession
import aiohttp
import subprocess
from wyoming.asr import Transcribe, Transcript
from wyoming.audio import AudioChunk, AudioStart, AudioStop
from wyoming.event import async_read_event, async_write_event
from openai import AsyncOpenAI
from sqlalchemy.orm import Session
from ..database import SessionLocal
from .models import Config, User
from .utils.numbers import words_to_digits

# Настройка логирования
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# JWT Settings (must match main.py)
SECRET_KEY = os.getenv("ENCRYPTION_KEY", "fallback-zero-config-secret-key-change-in-production")
ALGORITHM = "HS256"

SYSTEM_PROMPT = """Ты — интеллектуальный парсер голосовых команд для заметок.
Возвращаешь только JSON.

---
# 📌 ТИПЫ
* CREATE
* UPDATE
* SEARCH

---
# 🧠 ВХОД
* text (команда пользователя)
* notes (массив заметок)

---
# ❗ КРИТИЧЕСКИЕ ПРАВИЛА
## 1. 🚫 ЗАПРЕЩЕНО ДУБЛИРОВАТЬ TITLE В CONTENT
При CREATE:
❌ НЕЛЬЗЯ:
"content": "фильмы"
✅ ВСЕГДА:
"content": ""

## 2. 🔥 SEARCH — ТОЛЬКО ЛУЧШИЕ РЕЗУЛЬТАТЫ
Ты НЕ возвращаешь всё подряд.
Правила:
* максимум 3 результата
* только реально релевантные
* если найден 1 идеальный → вернуть только 1
* если слабое совпадение → НЕ возвращать

---
# 🧠 ШАГ 1. НОРМАЛИЗАЦИЯ
## УДАЛИ МУСОР:
* заметку, заметка
* в неё, неё, нее, не неё, не нее
* добавь в, добавь туда
* что-то, что то, про, пожалуйста

## ОЧИСТИ append:
"неё форсаж" → "форсаж"
"в шашлык маринад мясо" → "маринад мясо"

## ИСПРАВЬ ПАДЕЖИ:
* покупке → покупки
* машиной → машины

## УДАЛИ ДУБЛИ:
"покупки молоко" → "молоко"

---
# 🧠 ШАГ 2. ТИП
* создай → CREATE
* добавь → UPDATE
* найди → SEARCH

---
# 🧠 ШАГ 3. CREATE
Название = очищенная сущность
{
  "type": "CREATE",
  "title": "<title>",
  "content": ""
}

---
# 🧠 ШАГ 4. UPDATE
1. Найди заметку по:
* точному совпадению
* затем по смыслу

## ЕСЛИ НАШЁЛ:
{
  "type": "UPDATE",
  "note_id": "<id>",
  "append": "<чистый текст>"
}

## ЕСЛИ НЕ НАШЁЛ:
👉 ОБЯЗАТЕЛЬНО СОЗДАЙ
[
  {
    "type": "CREATE",
    "title": "<title>",
    "content": ""
  },
  {
    "type": "UPDATE",
    "append": "<текст>"
  }
]

❗ ВАЖНО: НИКОГДА НЕ СОЗДАВАЙ ЗАМЕТКУ, ЕСЛИ ОНА УЖЕ СУЩЕСТВУЕТ В МАССИВЕ NOTES! 
Если пользователь говорит "добавь заметку фильмы рубли" (или "создай заметку фильмы рубли"), и в `notes` УЖЕ есть заметка с названием "фильмы" — ты ОБЯЗАН вернуть ТОЛЬКО один `UPDATE` с `note_id` этой заметки. Никаких `CREATE` для существующих названий!

---
# 🧠 ШАГ 5. SEARCH
1. Очисти запрос:
"найди что-то про шашлык" → "шашлык"

2. Отфильтруй заметки:
* оставь только релевантные
* максимум 3
* сортируй по релевантности

## ФОРМАТ:
{
  "type": "SEARCH",
  "query": "<запрос>"
}

---
# 🧪 ПРИМЕРЫ
## CREATE
"создай заметку фильмы"
→
{
  "type": "CREATE",
  "title": "фильмы",
  "content": ""
}

## UPDATE
"добавь фильмы форсаж"
→
{
  "type": "UPDATE",
  "note_id": "1",
  "append": "форсаж"
}

## CREATE + UPDATE
"добавь музыка рок"
→
[
  {
    "type": "CREATE",
    "title": "музыка",
    "content": ""
  },
  {
    "type": "UPDATE",
    "append": "рок"
  }
]

## SEARCH (важно)
notes:
* кисель рецепт
* фильмы
* покупки
"найди что-то про кисель"
→
{
  "type": "SEARCH",
  "query": "кисель"
}
(вернётся только релевантное, не всё подряд)

Всегда возвращай только JSON."""

# Глобальные переменные для управления ботами
current_bots: Dict[int, Bot] = {}
bot_tasks: Dict[int, asyncio.Task] = {}
token_to_user: Dict[str, int] = {} # token -> user_id
user_usernames: Dict[int, str] = {}
bot_locks: Dict[int, asyncio.Lock] = {} # Lock per user
awaiting_passwords: Dict[str, Dict[str, Any]] = {} # chat_id -> {user_id: int, note_id: str}
dp = Dispatcher()

def get_user_lock(user_id: int) -> asyncio.Lock:
    if user_id not in bot_locks:
        bot_locks[user_id] = asyncio.Lock()
    return bot_locks[user_id]

async def get_user_token(user_id: int) -> str:
    """Генерация JWT токена для пользователя"""
    username = user_usernames.get(user_id, "admin")
    expire = datetime.utcnow() + timedelta(minutes=60)
    to_encode = {"sub": username, "exp": expire}
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

async def parse_commands_llm(user_id: int, text: str, notes: list[dict] = None) -> list[dict]:
    if notes is None:
        notes = []
        
    db = SessionLocal()
    try:
        config = db.query(Config).filter(Config.user_id == user_id).first()
        api_key = config.api_key if config else os.getenv("OPENAI_API_KEY")
        provider = config.llm_provider if config else "openai"
        model = config.model_name or ("gemini-1.5-flash" if provider == "gemini" else "gpt-4o-mini")
        
        # If provider is openai but no key, or if we want to force gemini in this environment
        if provider == "openai" and not api_key:
            gemini_key = os.getenv("GEMINI_API_KEY")
            if gemini_key:
                provider = "gemini"
                api_key = gemini_key
                model = "gemini-1.5-flash"
        
        if not api_key and provider != "gemini": # Gemini might use env key
            logger.warning("API key not found, falling back to regex parser")
            return parse_commands(text)
            
        user_content = f"notes:\n{json.dumps(notes, ensure_ascii=False)}\n\n\"{text}\""
        content = ""

        async def try_parse(p, k, m, base_url=None, proxy_url=None):
            if p == "gemini":
                url = f"https://generativelanguage.googleapis.com/v1beta/models/{m}:generateContent?key={k}"
                async with aiohttp.ClientSession() as session:
                    payload = {
                        "contents": [{"parts": [{"text": f"{SYSTEM_PROMPT}\n\n{user_content}"}]}],
                        "generationConfig": {"temperature": 0.0}
                    }
                    async with session.post(url, json=payload, timeout=30) as resp:
                        if resp.status == 200:
                            data = await resp.json()
                            return data['candidates'][0]['content']['parts'][0]['text']
                        else:
                            resp_text = await resp.text()
                            raise Exception(f"Gemini error: {resp_text}")
            else:
                kwargs = {"api_key": k}
                if base_url:
                    kwargs["base_url"] = base_url
                
                http_client = None
                if proxy_url:
                    import httpx
                    http_client = httpx.AsyncClient(proxy=proxy_url)
                    kwargs["http_client"] = http_client
                
                try:
                    async with AsyncOpenAI(**kwargs) as client:
                        response = await client.chat.completions.create(
                            model=m,
                            messages=[
                                {"role": "system", "content": SYSTEM_PROMPT},
                                {"role": "user", "content": user_content}
                            ],
                            temperature=0.0
                        )
                        return response.choices[0].message.content.strip()
                finally:
                    if http_client:
                        await http_client.aclose()

        try:
            final_proxy_url = None
            if config:
                if config.proxy_url and (config.proxy_url.startswith("http") or config.proxy_url.startswith("socks")):
                    final_proxy_url = config.proxy_url
                elif config.proxy_config and isinstance(config.proxy_config, dict) and config.proxy_config.get("host"):
                    p = config.proxy_config
                    final_proxy_url = f"{p.get('protocol', 'http').lower()}://{p.get('username')}:{p.get('password')}@{p['host']}:{p['port']}" if p.get('username') else f"{p.get('protocol', 'http').lower()}://{p['host']}:{p['port']}"

            content = await try_parse(provider, api_key, model, config.base_url if config else None, final_proxy_url)
        except Exception as e:
            if provider == "openai" and ("403" in str(e) or "unsupported_country" in str(e)):
                gemini_key = os.getenv("GEMINI_API_KEY")
                if gemini_key:
                    logger.info("OpenAI failed with 403, trying Gemini fallback")
                    content = await try_parse("gemini", gemini_key, "gemini-1.5-flash")
                else:
                    raise e
            else:
                raise e
        
        if content.startswith("```json"):
            content = content[7:-3].strip()
        elif content.startswith("```"):
            content = content[3:-3].strip()
            
        parsed = json.loads(content)
        if isinstance(parsed, dict):
            return [parsed]
        elif isinstance(parsed, list):
            return parsed
        return []
    except Exception as e:
        logger.error(f"LLM Parsing error: {e}")
        return parse_commands(text)
    finally:
        db.close()

def normalize_intent(text: str) -> str:
    if not text:
        return text
    words = text.split()
    if not words:
        return text
        
    first_word = words[0].lower()
    intents = {
        "создай": "создай", "создать": "создай", 
        "добавь": "добавь", "добавить": "добавь", 
        "удали": "удали", "удалить": "удали", 
        "найди": "найди", "найти": "найди", "поиск": "найди"
    }
    
    best_match = None
    best_ratio = 0
    
    for intent in intents.keys():
        ratio = difflib.SequenceMatcher(None, first_word, intent).ratio()
        if ratio > best_ratio:
            best_ratio = ratio
            best_match = intents[intent]
            
    if best_ratio > 0.8:
        words[0] = best_match
        return " ".join(words)
    return text

def parse_commands(text: str) -> list[dict]:
    text = text.lower()
    text = normalize_intent(text)
    
    commands = []
    action_verbs = ["добавь", "создай", "найди", "удали", "сделай", "напиши", "купи", "скажи", "покажи"]
    
    def is_valid_title(title: str) -> bool:
        if not title: return False
        if len(title) > 40: return False
        if title in action_verbs: return False
        return True

    def clean_garbage(t: str) -> str:
        garbage = [
            "пожалуйста", "мне", "сделай", "хочу", "можешь", 
            "заметку", "заметка", "заметки", "с названием", 
            "в неё", "в нее", "туда", "по названию", 
            "что-то", "что то", "что-нибудь", "что нибудь",
            "какую-то", "какую то", "какую-нибудь", "какую нибудь",
            "про", "о", "об", "расскажи", "покажи"
        ]
        # Sort by length descending to match longer phrases first
        garbage.sort(key=len, reverse=True)
        for word in garbage:
            pattern = rf'\b{re.escape(word)}\b'
            t = re.sub(pattern, '', t, flags=re.IGNORECASE)
        return re.sub(r'\s+', ' ', t).strip()

    create_update_match = re.search(r'^(создай.*?|создать.*?|новая.*?)\s+(?:и\s+)?(добавь\s+.*)$', text)
    if create_update_match:
        parts = [create_update_match.group(1), create_update_match.group(2)]
    else:
        parts = [text]
        
    for i, part in enumerate(parts):
        part = part.strip()
        if not part: continue
            
        if part.startswith("создай") or part.startswith("создать") or part.startswith("новая"):
            title = re.sub(r'^(создай|создать|новую|новая)\s*', '', part).strip()
            title = clean_garbage(title)
            if not is_valid_title(title):
                commands.append({"type": "SEARCH", "query": clean_garbage(part)})
            else:
                commands.append({"type": "CREATE", "title": title, "content": ""})
        elif part.startswith("добавь"):
            if i > 0 and commands and commands[-1]["type"] == "CREATE":
                append_text = re.sub(r'^добавь\s+(в\s+)?', '', part).strip()
                append_text = clean_garbage(append_text)
                commands.append({"type": "UPDATE", "append": append_text})
            else:
                cleaned = re.sub(r'^добавь\s+(в\s+)?', '', part).strip()
                cleaned = clean_garbage(cleaned)
                subparts = cleaned.split(maxsplit=1)
                if len(subparts) == 2:
                    search_query = subparts[0]
                    append_text = subparts[1]
                    if not is_valid_title(search_query):
                        commands.append({"type": "SEARCH", "query": clean_garbage(part)})
                    else:
                        commands.append({"type": "UPDATE", "search_query": search_query, "append": append_text})
                else:
                    commands.append({"type": "UPDATE", "search_query": cleaned, "append": cleaned})
        elif part.startswith("найди") or part.startswith("покажи") or part.startswith("что есть про"):
            query = re.sub(r'^(найди|покажи|что есть про)\s*', '', part).strip()
            query = clean_garbage(query)
            # Basic transliteration for common tech terms
            mapping = {"докер": "docker", "кубер": "kubernetes", "гит": "git", "питон": "python", "джава": "java", "нода": "node"}
            if query.lower() in mapping:
                query = mapping[query.lower()]
            commands.append({"type": "SEARCH", "query": query})
        else:
            query = clean_garbage(part)
            # Basic transliteration for common tech terms
            mapping = {"докер": "docker", "кубер": "kubernetes", "гит": "git", "питон": "python", "джава": "java", "нода": "node"}
            if query.lower() in mapping:
                query = mapping[query.lower()]
            commands.append({"type": "SEARCH", "query": query})
    return commands

STT_HOST = os.getenv("STT_HOST", "vosk")
STT_PORT = int(os.getenv("STT_PORT", 10300))

async def speech_to_text(audio_path: str) -> str:
    """Транскрибация аудио через Wyoming (Vosk)"""
    raw_path = audio_path.replace(".ogg", ".raw")
    logger.info(f"STT: Начинаю обработку. OGG: {audio_path}, RAW: {raw_path}")
    try:
        cmd = ["ffmpeg", "-y", "-i", audio_path, "-ar", "16000", "-ac", "1", "-f", "s16le", raw_path]
        subprocess.run(cmd, check=True, capture_output=True)
        
        reader, writer = await asyncio.wait_for(asyncio.open_connection(STT_HOST, STT_PORT), timeout=10.0)
        await async_write_event(Transcribe(language="ru").event(), writer)
        await async_write_event(AudioStart(rate=16000, width=2, channels=1).event(), writer)
        
        with open(raw_path, "rb") as f:
            while chunk := f.read(4096):
                await async_write_event(AudioChunk(audio=chunk, rate=16000, width=2, channels=1).event(), writer)
        
        await async_write_event(AudioStop().event(), writer)
        await writer.drain()
        
        transcript_text = ""
        while True:
            event = await asyncio.wait_for(async_read_event(reader), timeout=20.0)
            if event is None: break
            if Transcript.is_type(event.type):
                transcript_text = Transcript.from_event(event).text
                logger.info(f"STT: Результат транскрибации: «{transcript_text}»")
                break
        writer.close()
        await writer.wait_closed()
        return transcript_text
    except Exception as e:
        logger.error(f"STT Error: {e}")
        return ""
    finally:
        for p in [audio_path, raw_path]:
            if os.path.exists(p): os.remove(p)

# --- API Functions ---

async def save_note_to_api(user_id: int, title: str, content: str, note_id: str = None) -> Dict[str, Any]:
    url = "http://localhost:3344/api/notes"
    token = await get_user_token(user_id)
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    payload = {"id": note_id or str(uuid.uuid4()), "title": title, "content": content}
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(url, json=payload, headers=headers) as response:
                if response.status in [200, 201]:
                    data = await response.json()
                    return {"status": "success", "note_id": data.get("id"), "data": data}
                return {"status": "error", "message": f"Ошибка: {response.status}"}
    except Exception as e:
        return {"status": "error", "message": str(e)}

async def get_note_api(user_id: int, note_id: str) -> Dict[str, Any]:
    url = f"http://localhost:3344/api/notes/{note_id}"
    token = await get_user_token(user_id)
    headers = {"Authorization": f"Bearer {token}"}
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(url, headers=headers) as response:
                if response.status == 200:
                    data = await response.json()
                    return {"status": "success", "data": data}
                return {"status": "error", "message": f"Ошибка: {response.status}"}
    except Exception as e:
        return {"status": "error", "message": str(e)}

async def patch_note_api(user_id: int, note_id: str, content: str) -> Dict[str, Any]:
    # Fetch current note first to append
    current = await get_note_api(user_id, note_id)
    if current.get("status") == "success":
        old_content = current["data"].get("content", "")
        new_content = f"{old_content}\n\n{content}" if old_content else content
        
        url = f"http://localhost:3344/api/notes/{note_id}"
        token = await get_user_token(user_id)
        headers = {"Authorization": f"Bearer {token}"}
        payload = {"content": new_content}
        try:
            async with aiohttp.ClientSession() as session:
                async with session.patch(url, json=payload, headers=headers) as response:
                    if response.status == 200:
                        return {"status": "success", "note_id": note_id, "data": current["data"]}
                    return {"status": "error", "message": f"Ошибка: {response.status}"}
        except Exception as e:
            return {"status": "error", "message": str(e)}
    return current

async def get_all_notes_api(user_id: int) -> list[dict]:
    url = "http://localhost:3344/api/notes"
    token = await get_user_token(user_id)
    headers = {"Authorization": f"Bearer {token}"}
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(url, headers=headers) as response:
                if response.status == 200: return await response.json()
                return []
    except Exception as e:
        return []

async def search_api(user_id: int, query: str) -> Dict[str, Any]:
    import urllib.parse
    encoded_query = urllib.parse.quote(query)
    url = f"http://localhost:3344/api/notes/search?query={encoded_query}"
    token = await get_user_token(user_id)
    headers = {"Authorization": f"Bearer {token}"}
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(url, headers=headers) as response:
                if response.status == 200:
                    data = await response.json()
                    return {"status": "success", "data": data if isinstance(data, list) else [data] if data else []}
                return {"status": "error", "message": f"Ошибка: {response.status}"}
    except Exception as e:
        return {"status": "error", "message": str(e)}

async def semantic_search_api(user_id: int, query: str) -> Dict[str, Any]:
    import urllib.parse
    encoded_query = urllib.parse.quote(query)
    url = f"http://localhost:3344/api/notes/semantic-search?query={encoded_query}"
    token = await get_user_token(user_id)
    headers = {"Authorization": f"Bearer {token}"}
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(url, headers=headers) as response:
                if response.status == 200:
                    data = await response.json()
                    return {"status": "success", "data": data}
                return {"status": "error", "message": f"Ошибка: {response.status}"}
    except Exception as e:
        return {"status": "error", "message": str(e)}

async def send_long_message(message: types.Message, text: str, parse_mode: str = "HTML", **kwargs):
    """Sends a long message in multiple parts if it exceeds Telegram's limit."""
    if len(text) <= 4096:
        return await message.answer(text, parse_mode=parse_mode, **kwargs)
    
    # Simple chunking
    limit = 4000
    chunks = [text[i:i+limit] for i in range(0, len(text), limit)]
    
    for i, chunk in enumerate(chunks):
        # Only add reply_markup to the last chunk
        current_kwargs = kwargs.copy()
        if i < len(chunks) - 1:
            current_kwargs.pop("reply_markup", None)
            
        try:
            await message.answer(chunk, parse_mode=parse_mode, **current_kwargs)
        except Exception as e:
            logger.error(f"Error sending chunk: {e}")
            # Fallback: send without parse_mode if HTML is broken by split
            await message.answer(chunk, **current_kwargs)

# --- Bot Handlers ---

@dp.callback_query(F.data.startswith("open_note_"))
async def handle_open_note(callback: types.CallbackQuery, user_id: int):
    note_id = callback.data.replace("open_note_", "")
    await callback.answer()
    result = await get_note_api(user_id, note_id)
    if result.get("status") == "success":
        note = result.get("data", {})
        
        # Check for folder protection
        if note.get("folderIsProtected"):
            chat_id = str(callback.message.chat.id)
            awaiting_passwords[chat_id] = {"user_id": user_id, "note_id": note_id}
            await callback.message.answer("🔒 Эта заметка находится в защищенной папке. Пожалуйста, введите пароль доступа:")
            return

        title_esc = html.escape(note.get("title", "Без названия"))
        content = note.get("content", "Пусто")
        content_esc = html.escape(content)
        
        full_text = f"📝 <b>{html.escape(note.get('title', ''))}</b>\n\n{content_esc}"
        
        if len(full_text) <= 4096:
            await callback.message.answer(full_text, parse_mode="HTML")
        else:
            # Send header first
            header = f"📝 <b>{title_esc}</b>\n\n"
            await callback.message.answer(header, parse_mode="HTML")
            
            # Send content in chunks
            limit = 4000
            for i in range(0, len(content_esc), limit):
                await callback.message.answer(content_esc[i:i+limit], parse_mode="HTML")
                
        image_matches = re.findall(r'!\[.*?\]\((/api/uploads/.*?)\)', note.get("content", ""))
        for img_path in image_matches:
            local_path = os.path.join('/app/storage/uploads', os.path.basename(img_path))
            if os.path.exists(local_path):
                try: await callback.message.answer_photo(FSInputFile(local_path))
                except Exception as e: logger.error(f"Error sending photo: {e}")
    else:
        await callback.message.answer("❌ Не удалось загрузить содержимое заметки.")

@dp.message(Command("start"))
async def handle_start(message: types.Message):
    await message.answer("Привет! Я твой личный помощник VibeMind. Присылай мне любые мысли, ссылки или картинки, и я сохраню их в твои заметки.")

@dp.message(F.voice)
async def handle_voice(message: types.Message, user_id: int, admin_id: str = None):
    if admin_id and str(message.from_user.id) != str(admin_id): return
    await message.answer("🎙 Голосовое сообщение получено. Запускаю транскрибацию...")
    try:
        file = await message.bot.get_file(message.voice.file_id)
        ogg_path = os.path.join('/app/storage/temp', f"{uuid.uuid4()}.ogg")
        os.makedirs('/app/storage/temp', exist_ok=True)
        await message.bot.download_file(file.file_path, ogg_path)
        text = await speech_to_text(ogg_path)
        if not text:
            await message.answer("❌ Не удалось распознать речь.")
            return
            
        # Convert words to digits for better processing
        text = words_to_digits(text)
        
        await send_long_message(message, f"📝 Распознанный текст: «{text}»\nЗапускаю обработку...")
        fake_msg = message.model_copy(update={"text": text})
        await handle_text(fake_msg, user_id, admin_id)
    except Exception as e:
        await message.answer(f"❌ Ошибка при обработке голоса: {str(e)}")

@dp.message(F.photo)
async def handle_photo(message: types.Message, user_id: int, admin_id: str = None):
    if admin_id and str(message.from_user.id) != str(admin_id): return
    try:
        caption = message.caption or ""
        filename = f"{uuid.uuid4()}.jpg"
        filepath = os.path.join('/app/storage/uploads', filename)
        os.makedirs('/app/storage/uploads', exist_ok=True)
        file = await message.bot.get_file(message.photo[-1].file_id)
        await message.bot.download_file(file.file_path, filepath)
        
        image_markdown = f"![image](/api/uploads/{filename})"
        
        if caption:
            logger.info(f"Обработка фото с подписью: «{caption}»")
            notes = await get_all_notes_api(user_id)
            notes_context = [{"id": n.get("id"), "title": n.get("title"), "content": n.get("content")} for n in notes]
            commands = await parse_commands_llm(user_id, caption, notes_context)
            logger.info(f"Распознанные команды для фото: {commands}")
            
            if commands:
                cmd = commands[0]
                intent = cmd.get("type")
                
                if intent == "UPDATE":
                    target_id = cmd.get("note_id")
                    if not target_id and cmd.get("search_query"):
                        res = await search_api(user_id, cmd.get("search_query"))
                        if res.get("status") == "success" and res.get("data"):
                            target_id = res["data"][0].get('id')
                    
                    if target_id:
                        res = await patch_note_api(user_id, target_id, image_markdown)
                        if res.get("status") == "success":
                            await message.answer(f"📸 Изображение добавлено в заметку «{res['data'].get('title')}»!")
                            return
                
                elif intent == "CREATE":
                    title = cmd.get("title", "Без названия")
                    result = await save_note_to_api(user_id, title, image_markdown)
                    if result.get("status") == "success":
                        await message.answer(f"📸 Создал новую заметку «{title}» с изображением!")
                        return

        # Fallback if no caption or parsing failed to find a target
        result = await save_note_to_api(user_id, f"Photo from Telegram {datetime.now().strftime('%Y-%m-%d %H:%M')}", image_markdown)
        if result.get("status") == "success": 
            await message.answer("📸 Изображение сохранено в новую заметку!")
        else: 
            await message.answer(f"❌ Ошибка: {result.get('message')}")
            
    except Exception as e: 
        logger.error(f"Error in handle_photo: {e}")
        await message.answer(f"❌ Ошибка: {str(e)}")

@dp.message(F.text)
async def handle_text(message: types.Message, user_id: int, admin_id: str = None):
    if admin_id and str(message.from_user.id) != str(admin_id): return
    if message.text.startswith('/'): return
    
    chat_id = str(message.chat.id)
    if chat_id in awaiting_passwords:
        state = awaiting_passwords.pop(chat_id)
        # Verify password
        note_id = state["note_id"]
        # We need an endpoint to verify folder password
        # For now, we can try to fetch the note with a password param if we implemented it, 
        # but we decided on a verify endpoint.
        
        url = f"http://localhost:3344/api/folders/verify-by-note/{note_id}"
        token = await get_user_token(user_id)
        headers = {"Authorization": f"Bearer {token}"}
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(url, json={"password": message.text}, headers=headers) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        if data.get("success"):
                            # Success! Load note
                            res = await get_note_api(user_id, note_id)
                            if res.get("status") == "success":
                                note = res["data"]
                                title_esc = html.escape(note.get("title", ""))
                                content_esc = html.escape(note.get("content", ""))
                                await send_long_message(message, f"🔓 Доступ разрешен!\n\n📝 <b>{title_esc}</b>\n\n{content_esc}")
                                return
                        else:
                            await message.answer("❌ Неверный пароль. Попробуйте снова открыть заметку.")
                            return
        except Exception as e:
            logger.error(f"Error verifying password: {e}")
            await message.answer("❌ Ошибка при проверке пароля.")
            return

    logger.info(f"Обработка текста от пользователя {user_id}: «{message.text}»")
    
    # Convert words to digits
    processed_text = words_to_digits(message.text)
    if processed_text != message.text:
        logger.info(f"Текст после преобразования чисел: «{processed_text}»")
        
    normalized_text = normalize_intent(processed_text)
    notes = await get_all_notes_api(user_id)
    notes_context = [{"id": n.get("id"), "title": n.get("title"), "content": n.get("content")} for n in notes]
    commands = await parse_commands_llm(user_id, normalized_text, notes_context)
    logger.info(f"Распознанные команды: {commands}")
    
    chain_note_id = None
    for cmd in commands:
        intent = cmd.get("type")
        logger.info(f"Исполнение команды: {intent}, параметры: {cmd}")
        if intent == "CREATE":
            title = cmd.get("title", "Без названия")
            
            # Anti-duplicate fallback:
            existing_note_id = None
            for n in notes:
                if str(n.get("title", "")).strip().lower() == title.strip().lower():
                    existing_note_id = n.get("id")
                    break
            
            if existing_note_id:
                logger.info(f"Заметка '{title}' уже существует (ID: {existing_note_id}). Конвертируем CREATE в апдейт ID или просто переиспользуем.")
                chain_note_id = existing_note_id
                
                content_to_append = cmd.get("content", "")
                if content_to_append:
                    res = await patch_note_api(user_id, existing_note_id, content_to_append)
                    if res.get("status") == "success":
                        await message.answer(f"✅ Добавил текст в существующую заметку «{title}»!")
                    else:
                        await message.answer(f"❌ Ошибка при добавлении в '{title}': {res.get('message')}")
            else:
                result = await save_note_to_api(user_id, title, cmd.get("content", ""))
                if result.get("status") == "success":
                    chain_note_id = result.get("note_id")
                    logger.info(f"Успешно создана заметка: {title} (ID: {chain_note_id})")
                    await message.answer(f"Создал новую заметку «{title}»! 📝")
                else: await message.answer(f"❌ Ошибка: {result.get('message')}")
        elif intent == "UPDATE":
            target_id = cmd.get("note_id") or chain_note_id
            if not target_id and cmd.get("search_query"):
                res = await search_api(user_id, cmd.get("search_query"))
                if res.get("status") == "success" and res.get("data"): target_id = res["data"][0].get('id')
            if target_id:
                append = cmd.get("append", "")
                if isinstance(append, list): append = "\n- " + "\n- ".join(append)
                res = await patch_note_api(user_id, target_id, append)
                if res.get("status") == "success":
                    logger.info(f"Успешно обновлена заметка ID: {target_id}")
                    await message.answer(f"✅ Добавил текст в заметку «{res['data'].get('title')}»!")
                    chain_note_id = target_id
                else: await message.answer(f"❌ Ошибка: {res.get('message')}")
            else: await message.answer("Не нашёл подходящую заметку.")
        elif intent == "SEARCH":
            query = cmd.get("query", "")
            if not query: continue
            logger.info(f"Поиск заметок по запросу: «{query}»")
            await message.answer(f"🔍 Ищу заметки по запросу: «{query}»...")
            
            res_kw = await search_api(user_id, query)
            results_kw = res_kw.get("data", []) if res_kw.get("status") == "success" else []
            
            res_sem = await semantic_search_api(user_id, query)
            results_sem = res_sem.get("data", []) if res_sem.get("status") == "success" else []
            logger.info(f"SEMANTIC RESULTS RECEIVED: {len(results_sem)}")
            for r in results_sem:
                logger.info(f"Dist: {r.get('distance')} | Title: {r.get('title')}")
            
            # Combine logic
            combined = {r['id']: r for r in results_kw}
            for r in results_sem:
                if r['id'] not in combined:
                    combined[r['id']] = r
                    
            results = list(combined.values())

            if not results:
                await message.answer("Ничего не найдено. 😔")
                continue
            from aiogram.utils.keyboard import InlineKeyboardBuilder
            builder = InlineKeyboardBuilder()
            resp = f"Вот что я нашел по запросу «{html.escape(query)}»:\n\n"
            for i, note in enumerate(results[:15], 1):
                t_esc = html.escape(note.get('title', 'Без названия'))
                if note.get('folderIsProtected'):
                    p_esc = "<i>[Содержимое защищено паролем]</i>"
                else:
                    p_esc = html.escape(note.get('content', '')[:100].replace('\n', ' '))
                    p_esc = f"<i>{p_esc}</i>"
                resp += f"{i}. <b>{t_esc}</b>\n{p_esc}\n\n"
                builder.button(text=f"Открыть {i}", callback_data=f"open_note_{note['id']}")
            builder.adjust(1)
            await send_long_message(message, resp, parse_mode="HTML", reply_markup=builder.as_markup())

# --- Bot Management ---

async def start_bot(user_id: int, username: str, token: str, proxy_url: str = None, proxy_config: dict = None, admin_id: str = None):
    global current_bots, user_usernames, token_to_user, bot_tasks
    
    async with get_user_lock(user_id):
        # Проверяем, не запущен ли уже этот токен другим пользователем
        if token in token_to_user and token_to_user[token] != user_id:
            old_user_id = token_to_user[token]
            logger.warning(f"Token already in use by user {old_user_id}. Stopping old instance...")
            # Мы не можем вызвать stop_bot здесь напрямую из-за вложенного лока, 
            # но мы можем вызвать его логику или просто очистить.
            # На самом деле, лучше просто предупредить и продолжить, 
            # так как Telegram сам разорвет старое соединение при новом.
            # Но для чистоты - удалим из реестра.
            token_to_user.pop(token, None)
        
        # Если для этого пользователя УЖЕ есть запущенная задача - отменяем её
        if user_id in bot_tasks:
            logger.warning(f"Bot task already exists for user {user_id}. Cancelling before start...")
            task = bot_tasks[user_id]
            task.cancel()
            try: await asyncio.wait_for(task, timeout=2.0)
            except: pass
            bot_tasks.pop(user_id, None)

        token_to_user[token] = user_id
        user_usernames[user_id] = username
    if isinstance(proxy_url, str) and proxy_url.strip().startswith("{"):
        try: proxy_url = ast.literal_eval(proxy_url)
        except: pass
    try:
        final_proxy_url = None
        if isinstance(proxy_url, str) and (proxy_url.startswith("http") or proxy_url.startswith("socks")):
            final_proxy_url = proxy_url
        elif isinstance(proxy_url, dict) and proxy_url.get("host"):
            p = proxy_url
            final_proxy_url = f"{p.get('protocol', 'http')}://{p.get('username')}:{p.get('password')}@{p['host']}:{p['port']}" if p.get('username') else f"{p.get('protocol', 'http')}://{p['host']}:{p['port']}"
        elif isinstance(proxy_config, dict) and proxy_config.get("host"):
            p = proxy_config
            final_proxy_url = f"{p.get('protocol', 'http')}://{p.get('username')}:{p.get('password')}@{p['host']}:{p['port']}" if p.get('username') else f"{p.get('protocol', 'http')}://{p['host']}:{p['port']}"
        
        # Use float for timeout to avoid math errors in aiogram (+ buffer)
        session = AiohttpSession(proxy=final_proxy_url, timeout=60.0) if final_proxy_url else AiohttpSession(timeout=60.0)
        try:
            async with Bot(token=token, session=session) as bot:
                current_bots[user_id] = bot
                logger.info(f"Запуск бота для {username}. Прокси: {final_proxy_url or 'Direct'}")
                # Удаляем вебхук перед запуском поллинга, чтобы избежать ConflictError
                await bot.delete_webhook(drop_pending_updates=True)
                await dp.start_polling(bot, user_id=user_id, admin_id=admin_id, handle_signals=False)
        finally:
            await session.close()
    except Exception as e:
        logger.error(f"Ошибка бота {user_id}: {e}")

async def stop_bot(user_id: int):
    async with get_user_lock(user_id):
        global current_bots, bot_tasks, token_to_user
        logger.info(f"Stopping bot for user {user_id}...")
        
        # Находим токен, связанный с этим пользователем, чтобы очистить и его
        token_to_remove = None
        for token, uid in list(token_to_user.items()):
            if uid == user_id:
                token_to_remove = token
                break
        
        if token_to_remove:
            token_to_user.pop(token_to_remove, None)

        if bot := current_bots.get(user_id):
            try: 
                # Пытаемся закрыть сессию бота
                await bot.session.close()
                logger.info(f"Session closed for user {user_id}")
            except Exception as e: 
                logger.error(f"Error closing session for user {user_id}: {e}")
            finally:
                current_bots.pop(user_id, None)
            
        if task := bot_tasks.get(user_id):
            task.cancel()
            try: 
                # Ждем завершения задачи с таймаутом
                await asyncio.wait_for(task, timeout=5.0)
                logger.info(f"Task finished for user {user_id}")
            except asyncio.CancelledError: 
                logger.info(f"Task cancelled for user {user_id}")
            except asyncio.TimeoutError:
                logger.warning(f"Task cancellation timed out for user {user_id}")
            except Exception as e:
                logger.error(f"Error cancelling task for user {user_id}: {e}")
            finally:
                bot_tasks.pop(user_id, None)
        
        # Даем Telegram время "забыть" старое соединение
        await asyncio.sleep(1.0)
        logger.info(f"Bot for user {user_id} stopped.")
    
    # Даем небольшую паузу, чтобы Telegram успел закрыть соединение
    await asyncio.sleep(0.5)

async def restart_bot(user_id: int, username: str, token: str, proxy_url: str = None, proxy_config: dict = None, admin_id: str = None):
    await stop_bot(user_id)
    if token:
        bot_tasks[user_id] = asyncio.create_task(start_bot(user_id, username, token, proxy_url, proxy_config, admin_id))

async def test_bot_connection(token: str, admin_id: str = None, proxy_url: str = None, proxy_config: dict = None):
    if isinstance(proxy_url, str) and proxy_url.strip().startswith("{"):
        try: proxy_url = ast.literal_eval(proxy_url)
        except: pass
    try:
        final_proxy_url = None
        if isinstance(proxy_url, str) and (proxy_url.startswith("http") or proxy_url.startswith("socks")):
            final_proxy_url = proxy_url
        elif isinstance(proxy_url, dict) and proxy_url.get("host"):
            p = proxy_url
            final_proxy_url = f"{p.get('protocol', 'http')}://{p.get('username')}:{p.get('password')}@{p['host']}:{p['port']}" if p.get('username') else f"{p.get('protocol', 'http')}://{p['host']}:{p['port']}"
        elif isinstance(proxy_config, dict) and proxy_config.get("host"):
            p = proxy_config
            final_proxy_url = f"{p.get('protocol', 'http')}://{p.get('username')}:{p.get('password')}@{p['host']}:{p['port']}" if p.get('username') else f"{p.get('protocol', 'http')}://{p['host']}:{p['port']}"
        
        session = AiohttpSession(proxy=final_proxy_url, timeout=60.0) if final_proxy_url else AiohttpSession(timeout=60.0)
        try:
            async with Bot(token=token, session=session) as test_bot:
                me = await asyncio.wait_for(test_bot.get_me(), timeout=30.0)
                if admin_id: await test_bot.send_message(chat_id=admin_id, text="✅ VibeMind: Connection Successful!")
                return True, f"✅ Успешно: @{me.username}"
        finally:
            await session.close()
    except Exception as e:
        return False, f"❌ Ошибка: {str(e)}"