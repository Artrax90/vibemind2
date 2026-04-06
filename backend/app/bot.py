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
import subprocess
from pydub import AudioSegment
from wyoming.asr import Transcribe, Transcript
from wyoming.audio import AudioChunk, AudioStart, AudioStop
from wyoming.event import async_read_event, async_write_event

# Настройка логирования
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# JWT Settings (must match main.py)
SECRET_KEY = os.getenv("ENCRYPTION_KEY", "fallback-zero-config-secret-key-change-in-production")
ALGORITHM = "HS256"

STT_STOP_WORDS = ["в неё", "в нее", "неё", "нее", "туда", "в заметку", "текст", "и", "в", "под названием"]

def clean_text_cyclic(text: str) -> str:
    """Циклическая очистка текста от стоп-слов в начале и в конце с использованием границ слов"""
    if not text:
        return text
    
    text = text.strip()
    changed = True
    while changed:
        changed = False
        old_text = text
        
        # Очистка от стоп-слов с использованием границ слов \b
        for word in STT_STOP_WORDS:
            # В начале строки
            text = re.sub(rf'^\b{re.escape(word)}\b\s*', '', text, flags=re.IGNORECASE | re.UNICODE)
            # В конце строки
            text = re.sub(rf'\s*\b{re.escape(word)}\b$', '', text, flags=re.IGNORECASE | re.UNICODE)
        
        # Убираем двоеточия и лишние пробелы в начале и конце (но не через strip("и")!)
        text = re.sub(r'^[:\s]+', '', text)
        text = re.sub(r'[:\s]+$', '', text)
        
        if text != old_text:
            changed = True
            
    return text.strip()

STT_HOST = "192.168.1.196"
STT_PORT = 10208

async def speech_to_text(audio_path: str) -> str:
    """Транскрибация аудио через Wyoming (Vosk)"""
    wav_path = audio_path.replace(".ogg", ".wav")
    logger.info(f"STT: Начинаю обработку. OGG: {audio_path}, WAV: {wav_path}")
    
    try:
        # 1. Конвертация
        try:
            logger.info("STT: Конвертация OGG -> WAV (16kHz, Mono)...")
            audio = AudioSegment.from_file(audio_path)
            audio = audio.set_frame_rate(16000).set_channels(1).set_sample_width(2)
            audio.export(wav_path, format="wav")
            logger.info("STT: Конвертация успешно завершена.")
        except Exception as conv_err:
            logger.error(f"STT: Ошибка при конвертации аудио: {conv_err}")
            logger.error(traceback.format_exc())
            return ""

        # 2. Подключение к Vosk
        logger.info(f"STT: Подключаюсь к Vosk на {STT_HOST}:{STT_PORT} (timeout 10s)...")
        try:
            reader, writer = await asyncio.wait_for(
                asyncio.open_connection(STT_HOST, STT_PORT), 
                timeout=10.0
            )
            logger.info("STT: Соединение с Vosk установлено.")
        except asyncio.TimeoutError:
            logger.error(f"STT: Тайм-аут при подключении к Vosk ({STT_HOST}:{STT_PORT})")
            return ""
        except Exception as conn_err:
            logger.error(f"STT: Ошибка подключения к Vosk: {conn_err}")
            return ""
        
        # 3. Wyoming handshake & streaming
        try:
            await async_write_event(Transcribe().event(), writer)
            await async_write_event(
                AudioStart(rate=16000, width=2, channels=1).event(),
                writer,
            )
            
            logger.info("STT: Отправка аудио данных...")
            with open(wav_path, "rb") as f:
                while True:
                    chunk = f.read(1024)
                    if not chunk:
                        break
                    await async_write_event(
                        AudioChunk(audio=chunk, rate=16000, width=2, channels=1).event(), 
                        writer
                    )
            
            await async_write_event(AudioStop().event(), writer)
            logger.info("STT: Аудио данные отправлены, ожидаю результат...")
            
            # 4. Ожидание результата
            transcript_text = ""
            while True:
                event = await async_read_event(reader)
                if event is None:
                    logger.warning("STT: Соединение закрыто сервером до получения результата.")
                    break
                if Transcript.is_type(event.type):
                    transcript = Transcript.from_event(event)
                    transcript_text = transcript.text
                    logger.info(f"STT: Получен результат: «{transcript_text}»")
                    break
                    
            writer.close()
            await writer.wait_closed()
            return transcript_text
            
        except Exception as stream_err:
            logger.error(f"STT: Ошибка при передаче/получении данных: {stream_err}")
            return ""
            
    except Exception as e:
        logger.error(f"STT: Непредвиденная ошибка: {e}")
        return ""
    finally:
        # Удаляем временные файлы
        for p in [audio_path, wav_path]:
            if os.path.exists(p):
                try:
                    os.remove(p)
                except:
                    pass

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
    """Обработка голосовых сообщений (Vosk + Wyoming)"""
    logger.info("Голосовое сообщение получено, начинаю скачивание...")
    
    # Проверка admin_id
    if current_admin_id and str(message.from_user.id) != str(current_admin_id):
        logger.warning(f"Unauthorized access attempt from {message.from_user.id}")
        return

    await message.answer("🎙 Голосовое сообщение получено. Запускаю транскрибацию...")
    
    try:
        # 1. Скачиваем файл
        file_id = message.voice.file_id
        file = await message.bot.get_file(file_id)
        
        temp_dir = '/app/storage/temp'
        os.makedirs(temp_dir, exist_ok=True)
        ogg_path = os.path.join(temp_dir, f"{uuid.uuid4()}.ogg")
        
        logger.info(f"Voice: Скачиваю файл в {ogg_path}")
        await message.bot.download_file(file.file_path, ogg_path)
        
        # 2. Транскрибируем (speech_to_text сам удалит файлы)
        text = await speech_to_text(ogg_path)
            
        if not text:
            await message.answer("❌ Не удалось распознать речь (проверьте логи сервера).")
            return
            
        await message.answer(f"📝 Распознанный текст: «{text}»\nЗапускаю обработку...")
        
        # 3. Передаем текст в основной обработчик
        # Создаем "фейковое" сообщение с текстом
        message.text = text
        await handle_text(message)
        
    except Exception as e:
        logger.error(f"Error handling voice: {e}")
        logger.error(traceback.format_exc())
        await message.answer(f"❌ Ошибка при обработке голоса: {str(e)}")

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
    lower_text = text.lower()
    
    target_title = None
    new_content = None
    mode = "none"

    # Позиционный парсинг
    # 1. Режим Добавления (Append): "добавь в [название] [текст]"
    if lower_text.startswith("добавь в"):
        mode = "append"
        # Ищем начало заголовка
        if lower_text.startswith("добавь в заметку"):
            start_idx = len("добавь в заметку")
        else:
            start_idx = len("добавь в")
        
        remaining = text[start_idx:].strip()
        parts = remaining.split(None, 1)
        if len(parts) == 2:
            target_title = parts[0]
            new_content = parts[1]
        elif len(parts) == 1:
            target_title = parts[0]
            new_content = ""

    # 2. Режим Создания (Create): "создай [что-то] [название] и добавь [текст]"
    if not target_title and "создай" in lower_text:
        mode = "create"
        # Ищем ключевые слова для заголовка
        idx_name = lower_text.find("названием")
        idx_note = lower_text.find("заметку")
        
        start_title_idx = -1
        if idx_name != -1:
            start_title_idx = idx_name + len("названием")
        elif idx_note != -1:
            start_title_idx = idx_note + len("заметку")
            
        if start_title_idx != -1:
            # Ищем "добавь" как основной разделитель между Title и Content
            idx_add = lower_text.find("добавь", start_title_idx)
            
            if idx_add != -1:
                # Title - всё между ключевым словом и "добавь"
                target_title = text[start_title_idx:idx_add].strip()
                # Content - всё после "добавь"
                new_content = text[idx_add + len("добавь"):].strip()
            else:
                # Если "добавь" не найдено, откатываемся к старому методу (первое слово после ключевого слова)
                after_pivot = text[start_title_idx:].strip()
                parts = after_pivot.split(None, 1)
                if len(parts) >= 1:
                    target_title = parts[0]
                    if len(parts) == 2:
                        new_content = parts[1]
                    else:
                        new_content = ""

    # Очистка
    if target_title:
        target_title = clean_text_cyclic(target_title)
    if new_content:
        new_content = clean_text_cyclic(new_content)

    if target_title and new_content:
        logger.info(f"DEBUG PARSE: mode={mode}, title='{target_title}', content='{new_content}'")
        
        # 1. Ищем заметку
        existing_note = await search_note_by_title(target_title)
        
        if existing_note:
            # 2. Обновляем существующую (с двойным переносом строки для Markdown)
            updated_content = f"{existing_note['content']}\n\n{new_content}"
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
    logger.info(f"DEBUG PARSE: mode=simple, title='{title}', content='{text}'")
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
