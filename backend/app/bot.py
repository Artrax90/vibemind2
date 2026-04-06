import asyncio
import logging
import traceback
import ast
import os
import uuid
import re
from datetime import datetime, timedelta
from jose import jwt
from aiogram import Bot, Dispatcher, types, F
from aiogram.filters import Command
from aiogram.client.session.aiohttp import AiohttpSession
from aiohttp_socks import ProxyConnector
import aiohttp

# Настройка логирования
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# JWT Settings (must match main.py)
SECRET_KEY = os.getenv("ENCRYPTION_KEY", "fallback-zero-config-secret-key-change-in-production")
ALGORITHM = "HS256"

dp = Dispatcher()
bot_task = None
current_bot = None
current_admin_id = None

async def save_note_to_api(title: str, content: str, note_id: str = None):
    """Отправка заметки в API FastAPI (создание или обновление)"""
    url = "http://localhost:3344/api/notes"
    
    # Генерируем токен для пользователя 'admin'
    expire = datetime.utcnow() + timedelta(minutes=60)
    to_encode = {"sub": "admin", "exp": expire}
    token = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }
    
    payload = {
        "id": note_id or str(uuid.uuid4()),
        "title": title,
        "content": content
    }
    
    logger.info(f"Отправка заметки на URL: {url} для пользователя: {current_admin_id}")
    
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(url, json=payload, headers=headers) as response:
                resp_text = await response.text()
                logger.info(f"Ответ API: {response.status}, Тело: {resp_text}")
                if response.status in [200, 201]:
                    return True, "✅ Заметка успешно сохранена!"
                else:
                    return False, f"❌ Ошибка при сохранении: {response.status}"
    except Exception as e:
        logger.error(f"Ошибка при обращении к API: {e}")
        return False, f"❌ Ошибка при обращении к API: {str(e)}"

async def search_note_by_title(title: str):
    """Поиск заметки по заголовку через API"""
    url = f"http://localhost:3344/api/notes/search?query={title}"
    
    # Генерируем токен
    expire = datetime.utcnow() + timedelta(minutes=60)
    to_encode = {"sub": "admin", "exp": expire}
    token = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    
    headers = {"Authorization": f"Bearer {token}"}
    
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(url, headers=headers) as response:
                if response.status == 200:
                    data = await response.json()
                    return data
                return None
    except Exception as e:
        logger.error(f"Ошибка при поиске заметки: {e}")
        return None

@dp.message(Command("start"))
async def handle_start(message: types.Message):
    """Приветствие пользователя"""
    await message.answer("Привет! Я твой личный помощник VibeMind. Присылай мне любые мысли, ссылки или картинки, и я сохраню их в твои заметки.")

@dp.message(Command("ask"))
async def handle_ask(message: types.Message):
    """Поиск по базе знаний (pgvector)"""
    query = message.text.replace("/ask", "").strip()
    if not query:
        await message.answer("Пожалуйста, напишите ваш вопрос после команды /ask")
        return
        
    # TODO: Здесь логика векторизации запроса через LLM и поиск в PostgreSQL (pgvector)
    await message.answer(f"🔍 Ищу ответ на вопрос: '{query}' в вашей базе знаний...")

@dp.message(F.voice)
async def handle_voice(message: types.Message):
    """Обработка голосовых сообщений (ffmpeg + Whisper)"""
    await message.answer("🎙 Голосовое сообщение получено. Запускаю транскрибацию через Whisper...")
    # TODO: 
    # 1. Скачать файл: await current_bot.download(message.voice, destination="temp.ogg")
    # 2. Конвертировать через ffmpeg (subprocess)
    # 3. Отправить в Whisper API (используя httpx with proxy_url)
    # 4. Сохранить текст как заметку в БД

@dp.message(F.photo)
async def handle_photo(message: types.Message):
    """Обработка изображений"""
    # Проверка admin_id
    if current_admin_id and str(message.from_user.id) != str(current_admin_id):
        logger.warning(f"Unauthorized access attempt from {message.from_user.id}")
        return

    try:
        photo = message.photo[-1]
        file_id = photo.file_id
        
        # Генерируем имя файла
        filename = f"{uuid.uuid4()}.jpg"
        upload_dir = '/app/storage/uploads'
        os.makedirs(upload_dir, exist_ok=True)
        filepath = os.path.join(upload_dir, filename)
        
        # Скачиваем файл
        file = await message.bot.get_file(file_id)
        await message.bot.download_file(file.file_path, filepath)
        
        # Сохраняем в API
        img_url = f"/api/uploads/{filename}"
        title = f"Photo from Telegram {datetime.now().strftime('%Y-%m-%d %H:%M')}"
        content = f"![image]({img_url})"
        
        success, result_msg = await save_note_to_api(title, content)
        if success:
            await message.answer(f"📸 Изображение сохранено!\n{result_msg}")
        else:
            await message.answer(result_msg)
            
    except Exception as e:
        logger.error(f"Error handling photo: {e}")
        await message.answer("❌ Ошибка при сохранении изображения.")

@dp.message(F.text)
async def handle_text(message: types.Message):
    """Сохранение текстовых сообщений как .md заметок или обновление существующих"""
    # Проверка admin_id
    if current_admin_id and str(message.from_user.id) != str(current_admin_id):
        logger.warning(f"Unauthorized access attempt from {message.from_user.id}")
        return

    if message.text.startswith('/'):
        return
        
    text = message.text.strip()
    
    # 1. Режим "Smart Creation": "создай новую заметку под названием [Название] и добавь в неё [Текст]"
    smart_match = re.match(r"^создай новую заметку под названием\s+(.+?)\s+(?:и\s+)?добавь в неё\s+(.+)$", text, re.IGNORECASE | re.DOTALL)
    
    # 2. Режим "Добавления" (Append Mode): "добавь в [название] [текст]"
    append_match = re.match(r"^добавь в (?:заметку )?(\S+)\s+(.+)$", text, re.IGNORECASE | re.DOTALL)
    
    target_title = None
    new_content = None
    
    if smart_match:
        target_title = smart_match.group(1).strip()
        new_content = smart_match.group(2).strip()
    elif append_match:
        target_title = append_match.group(1).strip()
        new_content = append_match.group(2).strip()
        # Очистка контента от лишних союзов и знаков в начале
        new_content = re.sub(r"^\s*(?::|и|текст)\s*", "", new_content, flags=re.IGNORECASE)

    if target_title and new_content:
        # 1. Ищем заметку
        existing_note = await search_note_by_title(target_title)
        
        if existing_note:
            # 2. Обновляем существующую (с переносом строки)
            updated_content = f"{existing_note['content']}\n{new_content}"
            success, result_msg = await save_note_to_api(existing_note['title'], updated_content, existing_note['id'])
            if success:
                await message.answer(f"Обновил заметку «{existing_note['title']}»! ✅")
            else:
                await message.answer(result_msg)
        else:
            # 3. Создаем новую
            success, result_msg = await save_note_to_api(target_title, new_content)
            if success:
                await message.answer(f"Создал новую заметку «{target_title}»! 📝")
            else:
                await message.answer(result_msg)
        return

    # Обычный режим сохранения
    title = text[:30] + "..." if len(text) > 30 else text
    success, result_msg = await save_note_to_api(title, text)
    await message.answer(result_msg)

async def start_bot(token: str, proxy_url: str = None, proxy_config: dict = None, admin_id: str = None):
    """Запуск бота с поддержкой прокси (HTTP, SOCKS4, SOCKS5)"""
    global current_bot, current_admin_id
    current_admin_id = admin_id

    # Унифицируй входные данные
    if isinstance(proxy_url, str) and proxy_url.strip().startswith("{"):
        try:
            proxy_url = ast.literal_eval(proxy_url)
        except:
            pass

    try:
        session = None
        final_proxy_url = None
        
        # Приоритет 1: proxy_url как готовая строка
        if isinstance(proxy_url, str) and (proxy_url.startswith("http") or proxy_url.startswith("socks")):
            final_proxy_url = proxy_url
        # Приоритет 2: proxy_url как словарь
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
        # Приоритет 3: proxy_config как словарь
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

        logger.debug(f"Final Proxy URL for start_bot: {final_proxy_url}")

        # 2. Create session
        session = AiohttpSession(proxy=final_proxy_url) if final_proxy_url else AiohttpSession()
            
        async with Bot(token=token, session=session) as bot:
            current_bot = bot
            logger.info(f"Запуск Telegram бота... Прокси: {final_proxy_url or 'Direct'}")
            await dp.start_polling(bot)
    except Exception as e:
        logger.error(f"Ошибка при запуске бота: {e}")
        current_bot = None

async def test_bot_connection(token: str, admin_id: str = None, proxy_url: str = None, proxy_config: dict = None):
    """Тестирование соединения бота и отправка сообщения"""
    # Унифицируй входные данные
    if isinstance(proxy_url, str) and proxy_url.strip().startswith("{"):
        try:
            proxy_url = ast.literal_eval(proxy_url)
        except:
            pass

    session = None
    final_proxy_url = None
    protocol_name = "Direct"
    host = "unknown"
    port = "unknown"
    
    # Приоритет 1: proxy_url как готовая строка
    if isinstance(proxy_url, str) and (proxy_url.startswith("http") or proxy_url.startswith("socks")):
        final_proxy_url = proxy_url
        protocol_name = proxy_url.split("://")[0].upper() if "://" in proxy_url else "Proxy"
    # Приоритет 2: proxy_url как словарь
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
        protocol_name = protocol.upper()
    # Приоритет 3: proxy_config как словарь
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
        protocol_name = protocol.upper()

    logger.debug(f"Final Proxy URL: {final_proxy_url}")

    try:
        # 2. Create session and test
        session = AiohttpSession(proxy=final_proxy_url) if final_proxy_url else AiohttpSession()
            
        async with Bot(token=token, session=session) as test_bot:
            try:
                # Use a longer timeout for get_me as proxies can be slow
                me = await asyncio.wait_for(test_bot.get_me(), timeout=30.0)
                
                # Send message to admin if ID is provided
                if admin_id:
                    try:
                        await test_bot.send_message(chat_id=admin_id, text=f"✅ VibeMind: Connection Successful! Protocol: {protocol_name}")
                    except Exception as msg_err:
                        logger.warning(f"Failed to send test message to admin {admin_id}: {msg_err}")
                
                return True, f"✅ VibeMind: Connection Successful! Protocol: {protocol_name}"
                
            except asyncio.TimeoutError:
                error_msg = f"Тайм-аут при попытке подключения через прокси: {host}:{port}"
                print(f"[DEBUG] {error_msg}")
                return False, "TIMEOUT_ERROR: ❌ Превышено время ожидания. Прокси недоступен или блокирует Telegram."
            finally:
                # Bot session is managed by async with context manager
                pass
            
    except Exception as e:
        print(f"DEBUG ERROR: {str(e)}")
        traceback.print_exc()
        return False, f"❌ Connection Failed: {str(e)}"
    finally:
        if session:
            await session.close()

async def stop_bot():
    """Остановка текущего инстанса бота"""
    global current_bot
    if current_bot:
        logger.info("Остановка Telegram бота...")
        await current_bot.session.close()
        current_bot = None

async def restart_bot(token: str, proxy_url: str = None, proxy_config: dict = None, admin_id: str = None):
    """Динамический перезапуск бота (вызывается из FastAPI)"""
    global bot_task
    
    # Останавливаем текущего бота
    await stop_bot()
    
    # Отменяем текущую фоновую задачу
    if bot_task and not bot_task.done():
        bot_task.cancel()
        try:
            await bot_task
        except asyncio.CancelledError:
            pass
            
    # Запускаем новую задачу, если передан токен
    if token:
        bot_task = asyncio.create_task(start_bot(token, proxy_url, proxy_config, admin_id))
