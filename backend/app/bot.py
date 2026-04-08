import os
import logging
import asyncio
import uuid
import json
import re
import html
import traceback
import aiohttp
from datetime import datetime, timedelta
from typing import Dict, Any, List, Optional
from aiogram import Bot, Dispatcher, types, F
from aiogram.filters import Command
from aiogram.client.session.aiohttp import AiohttpSession
from aiogram.types import FSInputFile
from jose import jwt
import ast
import httpx
import io
import base64
from sqlalchemy.orm import Session
from ..database import SessionLocal
from .models import Config, User

# Настройка логирования
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Конфигурация JWT (должна совпадать с FastAPI)
SECRET_KEY = os.getenv("ENCRYPTION_KEY", "fallback-zero-config-secret-key-change-in-production")
ALGORITHM = "HS256"

# Инициализация aiogram
# В aiogram 3.x Dispatcher может обслуживать несколько ботов
dp = Dispatcher()

# Глобальные переменные для управления ботами
current_bots: Dict[int, Bot] = {}
bot_tasks: Dict[int, asyncio.Task] = {}
user_usernames: Dict[int, str] = {}

async def get_user_token(user_id: int) -> str:
    """Генерация JWT токена для пользователя"""
    username = user_usernames.get(user_id, "admin")
    expire = datetime.utcnow() + timedelta(minutes=60)
    to_encode = {"sub": username, "exp": expire}
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

# --- API Functions ---

async def save_note_to_api(user_id: int, title: str, content: str, note_id: str = None) -> Dict[str, Any]:
    """Отправка заметки в API FastAPI (создание или обновление)"""
    url = "http://localhost:3344/api/notes"
    token = await get_user_token(user_id)
    
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }
    
    payload = {
        "id": note_id or str(uuid.uuid4()),
        "title": title,
        "content": content
    }
    
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(url, json=payload, headers=headers) as response:
                if response.status in [200, 201]:
                    data = await response.json()
                    return {"status": "success", "note_id": data.get("id"), "data": data}
                return {"status": "error", "message": f"Ошибка API: {response.status}"}
    except Exception as e:
        return {"status": "error", "message": str(e)}

async def search_api(user_id: int, query: str) -> Dict[str, Any]:
    """Поиск через API (по заголовку и содержимому)"""
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
                    if isinstance(data, list):
                        return {"status": "success", "data": data}
                    return {"status": "success", "data": [data] if data else []}
                return {"status": "error", "message": f"Ошибка API: {response.status}"}
    except Exception as e:
        return {"status": "error", "message": str(e)}

async def semantic_search_api(user_id: int, query: str) -> Dict[str, Any]:
    """Семантический поиск через API"""
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
                return {"status": "error", "message": f"Ошибка API: {response.status}"}
    except Exception as e:
        return {"status": "error", "message": str(e)}

async def get_note_api(user_id: int, note_id: str) -> Dict[str, Any]:
    """Получение заметки по ID через API"""
    url = f"http://localhost:3344/api/notes/{note_id}"
    token = await get_user_token(user_id)
    headers = {"Authorization": f"Bearer {token}"}
    
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(url, headers=headers) as response:
                if response.status == 200:
                    data = await response.json()
                    return {"status": "success", "data": data}
                return {"status": "error", "message": f"Ошибка API: {response.status}"}
    except Exception as e:
        return {"status": "error", "message": str(e)}

async def patch_note_api(user_id: int, note_id: str, content: str) -> Dict[str, Any]:
    """Обновление контента заметки через API"""
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
                return {"status": "error", "message": f"Ошибка API: {response.status}"}
    except Exception as e:
        return {"status": "error", "message": str(e)}

async def get_all_notes_api(user_id: int) -> list[dict]:
    """Получение всех заметок пользователя через API"""
    url = "http://localhost:3344/api/notes"
    token = await get_user_token(user_id)
    headers = {"Authorization": f"Bearer {token}"}
    
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(url, headers=headers) as response:
                if response.status == 200:
                    return await response.json()
                return []
    except Exception as e:
        return []

# --- Bot Handlers ---

@dp.callback_query(F.data.startswith("open_note_"))
async def handle_open_note(callback: types.CallbackQuery, user_id: int):
    note_id = callback.data.replace("open_note_", "")
    await callback.answer()
    
    result = await get_note_api(user_id, note_id)
    if result.get("status") == "success":
        note = result.get("data", {})
        title = note.get("title", "Без названия")
        content = note.get("content", "Пусто")
        
        title_esc = html.escape(title)
        content_esc = html.escape(content)
        
        response_text = f"📝 <b>{title_esc}</b>\n\n{content_esc}"
        await callback.message.answer(response_text, parse_mode="HTML")
    else:
        await callback.message.answer("❌ Не удалось загрузить содержимое заметки.")

@dp.message(Command("start"))
async def handle_start(message: types.Message):
    await message.answer("Привет! Я твой личный помощник VibeMind. Присылай мне любые мысли, ссылки или картинки, и я сохраню их в твои заметки.")

@dp.message(F.voice)
async def handle_voice(message: types.Message, user_id: int, admin_id: str = None):
    if admin_id and str(message.from_user.id) != str(admin_id):
        return

    status_msg = await message.answer("🎙 Голосовое сообщение получено. Запускаю транскрибацию...")
    
    try:
        voice = message.voice
        file_id = voice.file_id
        file = await message.bot.get_file(file_id)
        
        # Download to memory
        file_url = f"https://api.telegram.org/file/bot{message.bot.token}/{file.file_path}"
        
        db = SessionLocal()
        config = db.query(Config).filter(Config.user_id == user_id).first()
        db.close()
        
        if not config or not config.tg_token:
            await status_msg.edit_text("❌ Бот не настроен.")
            return

        # Transcription logic
        transcription = ""
        
        if config.llm_provider == "openai":
            from openai import AsyncOpenAI
            client = AsyncOpenAI(api_key=config.api_key)
            
            # Download file
            async with httpx.AsyncClient() as client_http:
                resp = await client_http.get(file_url)
                if resp.status_code == 200:
                    audio_data = io.BytesIO(resp.content)
                    audio_data.name = "voice.ogg"
                    
                    transcript = await client.audio.transcriptions.create(
                        model="whisper-1", 
                        file=audio_data
                    )
                    transcription = transcript.text
        
        elif config.llm_provider == "gemini":
            # Gemini 1.5 Flash supports audio
            api_key = config.api_key
            model = config.model_name or "gemini-1.5-flash"
            
            async with httpx.AsyncClient() as client_http:
                resp = await client_http.get(file_url)
                if resp.status_code == 200:
                    import base64
                    audio_b64 = base64.b64encode(resp.content).decode('utf-8')
                    
                    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
                    payload = {
                        "contents": [{
                            "parts": [
                                {"text": "Transcribe this audio to text. Output ONLY the transcription, nothing else."},
                                {"inline_data": {"mime_type": "audio/ogg", "data": audio_b64}}
                            ]
                        }]
                    }
                    resp_ai = await client_http.post(url, json=payload, timeout=60)
                    if resp_ai.status_code == 200:
                        transcription = resp_ai.json()['candidates'][0]['content']['parts'][0]['text']

        if transcription:
            await status_msg.edit_text(f"📝 <b>Транскрипция:</b>\n\n{transcription}", parse_mode="HTML")
            # Process the transcribed text as a normal message
            message.text = transcription
            await handle_text(message, user_id, admin_id)
        else:
            await status_msg.edit_text("❌ Не удалось выполнить транскрибацию. Попробуйте позже или проверьте настройки ИИ.")
            
    except Exception as e:
        logger.error(f"Voice Error: {e}")
        await status_msg.edit_text(f"❌ Ошибка при обработке голоса: {str(e)}")

@dp.message(F.photo)
async def handle_photo(message: types.Message, user_id: int, admin_id: str = None):
    if admin_id and str(message.from_user.id) != str(admin_id):
        return

    try:
        photo = message.photo[-1]
        file_id = photo.file_id
        filename = f"{uuid.uuid4()}.jpg"
        upload_dir = '/app/storage/uploads'
        os.makedirs(upload_dir, exist_ok=True)
        filepath = os.path.join(upload_dir, filename)
        
        file = await message.bot.get_file(file_id)
        await message.bot.download_file(file.file_path, filepath)
        
        img_url = f"/api/uploads/{filename}"
        title = f"Photo from Telegram {datetime.now().strftime('%Y-%m-%d %H:%M')}"
        content = f"![image]({img_url})"
        
        result = await save_note_to_api(user_id, title, content)
        if result.get("status") == "success":
            await message.answer(f"📸 Изображение сохранено!")
        else:
            await message.answer(f"❌ Ошибка: {result.get('message')}")
    except Exception as e:
        await message.answer(f"❌ Ошибка: {str(e)}")

async def call_llm(user_id: int, prompt: str, system_prompt: str = "You are a helpful assistant.") -> str:
    """Универсальный вызов LLM на основе настроек пользователя"""
    db = SessionLocal()
    try:
        config = db.query(Config).filter(Config.user_id == user_id).first()
        if not config or not config.llm_provider:
            return "AI provider not configured."

        if config.llm_provider in ["openai", "ollama", "openrouter"]:
            from openai import AsyncOpenAI
            base_url = config.base_url
            if config.llm_provider == "openrouter" and not base_url:
                base_url = "https://openrouter.ai/api/v1"
            client = AsyncOpenAI(api_key=config.api_key or "dummy", base_url=base_url)
            resp = await client.chat.completions.create(
                model=config.model_name or "gpt-4o-mini",
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": prompt}
                ],
                max_tokens=500
            )
            return resp.choices[0].message.content
        elif config.llm_provider == "gemini":
            api_key = config.api_key
            model = config.model_name or "gemini-1.5-flash"
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
            async with httpx.AsyncClient() as client:
                payload = {
                    "contents": [
                        {"role": "user", "parts": [{"text": f"System: {system_prompt}\n\nUser: {prompt}"}]}
                    ]
                }
                resp = await client.post(url, json=payload, timeout=30)
                if resp.status_code == 200:
                    return resp.json()['candidates'][0]['content']['parts'][0]['text']
                return f"Gemini Error: {resp.status_code}"
        return "Unsupported LLM provider."
    except Exception as e:
        logger.error(f"LLM Error: {e}")
        return f"Error: {str(e)}"
    finally:
        db.close()

async def search_notes_api(user_id: int, query: str) -> Dict[str, Any]:
    """Поиск по заметкам через API чата"""
    url = "http://localhost:3344/api/chat"
    token = await get_user_token(user_id)
    headers = {"Authorization": f"Bearer {token}"}
    payload = {"message": query}
    
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(url, json=payload, headers=headers) as response:
                if response.status == 200:
                    return await response.json()
                return {"answer": "Ошибка при поиске.", "citations": []}
    except Exception as e:
        return {"answer": f"Ошибка сети: {str(e)}", "citations": []}

@dp.message(F.text)
async def handle_text(message: types.Message, user_id: int, admin_id: str = None):
    if admin_id and str(message.from_user.id) != str(admin_id):
        return

    if message.text.startswith('/'):
        return

    # 1. Определяем намерение пользователя через LLM
    intent_prompt = f"""Проанализируй сообщение пользователя и определи его намерение.
Сообщение: "{message.text}"

Возможные намерения:
- SAVE: Пользователь хочет сохранить информацию, создать заметку, записать что-то. (Пример: "Запиши что я купил хлеб", "Новая заметка: рецепт блинов")
- SEARCH: Пользователь задает вопрос по своим знаниям или просит найти что-то в заметках. (Пример: "Найди заметку про компьютер", "Что я писал про проект?", "Когда у меня встреча?")
- CHAT: Просто общение или вопрос, не требующий поиска в базе.

Верни ответ СТРОГО в формате JSON:
{{"intent": "SAVE" | "SEARCH" | "CHAT", "title": "краткий заголовок если SAVE", "query": "очищенный запрос если SEARCH"}}
"""
    
    intent_json_raw = await call_llm(user_id, intent_prompt, "You are an intent classifier. Output only valid JSON.")
    try:
        # Очистка от markdown если есть
        clean_json = re.search(r'\{.*\}', intent_json_raw, re.DOTALL).group(0)
        intent_data = json.loads(clean_json)
    except:
        # Fallback если LLM ошиблась с форматом
        if any(word in message.text.lower() for word in ["найди", "что", "когда", "где", "вспомни"]):
            intent_data = {"intent": "SEARCH", "query": message.text}
        else:
            intent_data = {"intent": "SAVE", "title": message.text[:50], "query": message.text}

    intent = intent_data.get("intent", "SAVE")

    if intent == "SEARCH":
        status_msg = await message.answer("🔍 Ищу в ваших заметках...")
        search_result = await search_notes_api(user_id, intent_data.get("query", message.text))
        answer = search_result.get("answer", "Ничего не найдено.")
        citations = search_result.get("citations", [])
        
        response = answer
        if citations:
            response += "\n\n<b>Источники:</b>"
            for c in citations:
                response += f"\n• {c.get('title')}"
        
        await status_msg.edit_text(response, parse_mode="HTML")
        
    elif intent == "SAVE":
        title = intent_data.get("title") or message.text.split('\n')[0][:50]
        content = message.text
        
        result = await save_note_to_api(user_id, title, content)
        if result.get("status") == "success":
            await message.answer(f"✅ Заметка «{title}» сохранена!")
        else:
            await message.answer(f"❌ Ошибка сохранения: {result.get('message')}")
    else:
        # Просто чат
        response = await call_llm(user_id, message.text)
        await message.answer(response)

# --- Bot Management ---

async def start_bot(user_id: int, username: str, token: str, proxy_url: str = None, proxy_config: dict = None, admin_id: str = None):
    global current_bots, user_usernames
    user_usernames[user_id] = username
    
    try:
        final_proxy_url = None
        
        # Check proxy_url (string or dict)
        if isinstance(proxy_url, str) and proxy_url.strip().startswith("{"):
            try: proxy_url = ast.literal_eval(proxy_url)
            except: pass

        if isinstance(proxy_url, str) and proxy_url.strip() and (proxy_url.startswith("http") or proxy_url.startswith("socks")):
            final_proxy_url = proxy_url.strip()
        elif isinstance(proxy_url, dict) and proxy_url.get("host"):
            p = proxy_url
            protocol = str(p.get("protocol", "http")).lower()
            host = str(p.get("host")).strip()
            port = p.get("port")
            user = p.get("username")
            password = p.get("password")
            if host:
                if user and password:
                    final_proxy_url = f"{protocol}://{user}:{password}@{host}:{port}"
                else:
                    final_proxy_url = f"{protocol}://{host}:{port}"
        
        # Check proxy_config if final_proxy_url is still None
        if not final_proxy_url and isinstance(proxy_config, dict) and proxy_config.get("host"):
            p = proxy_config
            protocol = str(p.get("protocol", "http")).lower()
            host = str(p.get("host")).strip()
            port = p.get("port")
            user = p.get("username")
            password = p.get("password")
            if host:
                if user and password:
                    final_proxy_url = f"{protocol}://{user}:{password}@{host}:{port}"
                else:
                    final_proxy_url = f"{protocol}://{host}:{port}"

        if final_proxy_url:
            # Mask password in logs
            masked_proxy = re.sub(r':([^@/]+)@', ':****@', final_proxy_url)
            logger.info(f"Запуск бота для {username} (ID: {user_id}). Прокси: {masked_proxy}")
        else:
            logger.info(f"Запуск бота для {username} (ID: {user_id}). Прокси: Direct (No proxy configured)")
        
        while True:
            try:
                # Use float for timeout to avoid math errors in aiogram (+ buffer)
                timeout = 60.0
                session = AiohttpSession(proxy=final_proxy_url, timeout=timeout) if final_proxy_url else AiohttpSession(timeout=timeout)
                async with Bot(token=token, session=session) as bot:
                    current_bots[user_id] = bot
                    logger.info(f"Бот @{username} начал опрос (polling)...")
                    # polling_timeout is passed to getUpdates, aiogram adds a buffer to it
                    await dp.start_polling(bot, user_id=user_id, admin_id=admin_id, handle_signals=False)
            except asyncio.CancelledError:
                logger.info(f"Бот {user_id} остановлен (CancelledError)")
                break
            except Exception as e:
                logger.error(f"Ошибка бота {user_id}: {e}. Повторная попытка через 15 секунд...")
                if user_id in current_bots: del current_bots[user_id]
                await asyncio.sleep(15)
    except Exception as e:
        logger.error(f"Критическая ошибка в start_bot {user_id}: {e}")
    finally:
        if user_id in current_bots: del current_bots[user_id]

async def stop_bot(user_id: int):
    global current_bots, bot_tasks
    bot = current_bots.get(user_id)
    if bot:
        try: await bot.session.close()
        except: pass
        del current_bots[user_id]
    
    task = bot_tasks.get(user_id)
    if task:
        task.cancel()
        try: await task
        except asyncio.CancelledError: pass
        del bot_tasks[user_id]

async def restart_bot(user_id: int, username: str, token: str, proxy_url: str = None, proxy_config: dict = None, admin_id: str = None):
    await stop_bot(user_id)
    if token:
        bot_tasks[user_id] = asyncio.create_task(start_bot(user_id, username, token, proxy_url, proxy_config, admin_id))

async def test_bot_connection(token: str, admin_id: str = None, proxy_url: str = None, proxy_config: dict = None):
    try:
        final_proxy_url = None
        # Handle proxy_url if it's a string representation of a dict
        if isinstance(proxy_url, str) and proxy_url.strip().startswith("{"):
            try: proxy_url = ast.literal_eval(proxy_url)
            except: pass

        if isinstance(proxy_url, str) and (proxy_url.startswith("http") or proxy_url.startswith("socks")):
            final_proxy_url = proxy_url
        elif isinstance(proxy_url, dict) and proxy_url.get("host"):
            p = proxy_url
            protocol = str(p.get("protocol", "http")).lower()
            host = str(p.get("host"))
            port = p.get("port")
            user = p.get("username")
            password = p.get("password")
            if user and password:
                final_proxy_url = f"{protocol}://{user}:{password}@{host}:{port}"
            else:
                final_proxy_url = f"{protocol}://{host}:{port}"
        elif isinstance(proxy_config, dict) and proxy_config.get("host"):
            p = proxy_config
            protocol = str(p.get("protocol", "http")).lower()
            host = str(p.get("host"))
            port = p.get("port")
            user = p.get("username")
            password = p.get("password")
            if user and password:
                final_proxy_url = f"{protocol}://{user}:{password}@{host}:{port}"
            else:
                final_proxy_url = f"{protocol}://{host}:{port}"
        
        # Use float for timeout to avoid math errors in aiogram (+ buffer)
        timeout = 60.0
        session = AiohttpSession(proxy=final_proxy_url, timeout=timeout) if final_proxy_url else AiohttpSession(timeout=timeout)
        async with Bot(token=token, session=session) as test_bot:
            me = await asyncio.wait_for(test_bot.get_me(), timeout=30.0)
            if admin_id:
                try:
                    await test_bot.send_message(chat_id=admin_id, text="✅ Проверка связи VibeMind успешна!")
                except Exception as send_err:
                    logger.warning(f"Could not send test message to admin_id {admin_id}: {send_err}")
            return True, f"✅ Успешно: @{me.username}"
    except Exception as e:
        logger.error(f"Ошибка проверки бота: {e}")
        return False, f"❌ Ошибка: {str(e)}"
