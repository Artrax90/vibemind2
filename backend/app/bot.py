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
import jwt
import ast

# Настройка логирования
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Конфигурация JWT (должна совпадать с FastAPI)
SECRET_KEY = os.getenv("ENCRYPTION_KEY", "your-secret-key-here")
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

    await message.answer("🎙 Голосовое сообщение получено. Запускаю транскрибацию...")
    # Здесь должна быть логика speech_to_text, пока просто заглушка или вызов существующей
    await message.answer("❌ Транскрибация временно недоступна в этом режиме.")

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

@dp.message(F.text)
async def handle_text(message: types.Message, user_id: int, admin_id: str = None):
    if admin_id and str(message.from_user.id) != str(admin_id):
        return

    if message.text.startswith('/'):
        return
        
    # Простая логика создания заметки (без LLM для краткости, можно вернуть позже)
    title = message.text.split('\n')[0][:50]
    content = message.text
    
    result = await save_note_to_api(user_id, title, content)
    if result.get("status") == "success":
        await message.answer(f"✅ Заметка «{title}» сохранена!")
    else:
        await message.answer(f"❌ Ошибка: {result.get('message')}")

# --- Bot Management ---

async def start_bot(user_id: int, username: str, token: str, proxy_url: str = None, proxy_config: dict = None, admin_id: str = None):
    global current_bots, user_usernames
    user_usernames[user_id] = username
    
    try:
        final_proxy_url = None
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

        logger.info(f"Запуск бота для {username} (ID: {user_id}). Прокси: {final_proxy_url or 'Direct'}")
        
        session = AiohttpSession(proxy=final_proxy_url) if final_proxy_url else AiohttpSession()
        async with Bot(token=token, session=session) as bot:
            current_bots[user_id] = bot
            await dp.start_polling(bot, user_id=user_id, admin_id=admin_id)
    except Exception as e:
        logger.error(f"Ошибка бота {user_id}: {e}")
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
        # Аналогичная логика прокси как в start_bot
        final_proxy_url = None
        if isinstance(proxy_url, str) and (proxy_url.startswith("http") or proxy_url.startswith("socks")):
            final_proxy_url = proxy_url
        
        session = AiohttpSession(proxy=final_proxy_url) if final_proxy_url else AiohttpSession()
        async with Bot(token=token, session=session) as test_bot:
            me = await asyncio.wait_for(test_bot.get_me(), timeout=10.0)
            if admin_id:
                await test_bot.send_message(chat_id=admin_id, text="✅ Проверка связи VibeMind успешна!")
            return True, f"✅ Успешно: @{me.username}"
    except Exception as e:
        return False, f"❌ Ошибка: {str(e)}"
