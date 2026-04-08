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
user_usernames: Dict[int, str] = {}
dp = Dispatcher()

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
        
        if not api_key:
            logger.warning("API key not found, falling back to regex parser")
            return parse_commands(text)
            
        user_content = f"notes:\n{json.dumps(notes, ensure_ascii=False)}\n\n\"{text}\""
        content = ""

        if provider == "gemini":
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
            async with aiohttp.ClientSession() as session:
                payload = {
                    "contents": [{"parts": [{"text": f"{SYSTEM_PROMPT}\n\n{user_content}"}]}],
                    "generationConfig": {"temperature": 0.0}
                }
                async with session.post(url, json=payload, timeout=30) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        content = data['candidates'][0]['content']['parts'][0]['text']
                    else:
                        resp_text = await resp.text()
                        raise Exception(f"Gemini error: {resp_text}")
        else:
            client = AsyncOpenAI(api_key=api_key)
            response = await client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": user_content}
                ],
                temperature=0.0
            )
            content = response.choices[0].message.content.strip()
        
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

STT_HOST = "192.168.1.196"
STT_PORT = 10300

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
    url = f"http://localhost:3344/api/notes/{note_id}"
    token = await get_user_token(user_id)
    headers = {"Authorization": f"Bearer {token}"}
    payload = {"content": content}
    try:
        async with aiohttp.ClientSession() as session:
            async with session.patch(url, json=payload, headers=headers) as response:
                if response.status == 200:
                    data = await response.json()
                    return {"status": "success", "note_id": data.get("id"), "data": data}
                return {"status": "error", "message": f"Ошибка: {response.status}"}
    except Exception as e:
        return {"status": "error", "message": str(e)}

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

# --- Bot Handlers ---

@dp.callback_query(F.data.startswith("open_note_"))
async def handle_open_note(callback: types.CallbackQuery, user_id: int):
    note_id = callback.data.replace("open_note_", "")
    await callback.answer()
    result = await get_note_api(user_id, note_id)
    if result.get("status") == "success":
        note = result.get("data", {})
        title_esc = html.escape(note.get("title", "Без названия"))
        content_esc = html.escape(note.get("content", "Пусто"))
        await callback.message.answer(f"📝 <b>{title_esc}</b>\n\n{content_esc}", parse_mode="HTML")
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
        await message.answer(f"📝 Распознанный текст: «{text}»\nЗапускаю обработку...")
        fake_msg = message.model_copy(update={"text": text})
        await handle_text(fake_msg, user_id, admin_id)
    except Exception as e:
        await message.answer(f"❌ Ошибка при обработке голоса: {str(e)}")

@dp.message(F.photo)
async def handle_photo(message: types.Message, user_id: int, admin_id: str = None):
    if admin_id and str(message.from_user.id) != str(admin_id): return
    try:
        filename = f"{uuid.uuid4()}.jpg"
        filepath = os.path.join('/app/storage/uploads', filename)
        os.makedirs('/app/storage/uploads', exist_ok=True)
        file = await message.bot.get_file(message.photo[-1].file_id)
        await message.bot.download_file(file.file_path, filepath)
        result = await save_note_to_api(user_id, f"Photo from Telegram {datetime.now().strftime('%Y-%m-%d %H:%M')}", f"![image](/api/uploads/{filename})")
        if result.get("status") == "success": await message.answer("📸 Изображение сохранено!")
        else: await message.answer(f"❌ Ошибка: {result.get('message')}")
    except Exception as e: await message.answer(f"❌ Ошибка: {str(e)}")

@dp.message(F.text)
async def handle_text(message: types.Message, user_id: int, admin_id: str = None):
    if admin_id and str(message.from_user.id) != str(admin_id): return
    if message.text.startswith('/'): return
    
    logger.info(f"Обработка текста от пользователя {user_id}: «{message.text}»")
    normalized_text = normalize_intent(message.text)
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
            res = await search_api(user_id, query)
            results = res.get("data", []) if res.get("status") == "success" else []
            if not results:
                res = await semantic_search_api(user_id, query)
                results = res.get("data", []) if res.get("status") == "success" else []
            if not results:
                await message.answer("Ничего не найдено. 😔")
                continue
            from aiogram.utils.keyboard import InlineKeyboardBuilder
            builder = InlineKeyboardBuilder()
            resp = f"Вот что я нашел по запросу «{html.escape(query)}»:\n\n"
            for i, note in enumerate(results[:5], 1):
                t_esc = html.escape(note.get('title', 'Без названия'))
                p_esc = html.escape(note.get('content', '')[:100].replace('\n', ' '))
                resp += f"{i}. <b>{t_esc}</b>\n<i>{p_esc}</i>\n\n"
                builder.button(text=f"Открыть {i}", callback_data=f"open_note_{note['id']}")
            builder.adjust(1)
            await message.answer(resp, parse_mode="HTML", reply_markup=builder.as_markup())

# --- Bot Management ---

async def start_bot(user_id: int, username: str, token: str, proxy_url: str = None, proxy_config: dict = None, admin_id: str = None):
    global current_bots, user_usernames
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
        async with Bot(token=token, session=session) as bot:
            current_bots[user_id] = bot
            logger.info(f"Запуск бота для {username}. Прокси: {final_proxy_url or 'Direct'}")
            await dp.start_polling(bot, user_id=user_id, admin_id=admin_id, handle_signals=False)
    except Exception as e:
        logger.error(f"Ошибка бота {user_id}: {e}")

async def stop_bot(user_id: int):
    global current_bots, bot_tasks
    if bot := current_bots.get(user_id):
        try: await bot.session.close()
        except: pass
        del current_bots[user_id]
    if task := bot_tasks.get(user_id):
        task.cancel()
        try: await task
        except asyncio.CancelledError: pass
        del bot_tasks[user_id]

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
        async with Bot(token=token, session=session) as test_bot:
            me = await asyncio.wait_for(test_bot.get_me(), timeout=30.0)
            if admin_id: await test_bot.send_message(chat_id=admin_id, text="✅ VibeMind: Connection Successful!")
            return True, f"✅ Успешно: @{me.username}"
    except Exception as e:
        return False, f"❌ Ошибка: {str(e)}"
