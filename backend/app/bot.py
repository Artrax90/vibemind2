import asyncio
import logging
import traceback
import ast
import os
import uuid
import re
import json
import difflib
from typing import Dict, Any
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
from openai import AsyncOpenAI

# Настройка логирования
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# JWT Settings (must match main.py)
SECRET_KEY = os.getenv("ENCRYPTION_KEY", "fallback-zero-config-secret-key-change-in-production")
ALGORITHM = "HS256"

SYSTEM_PROMPT = """Ты — парсер команд для бота заметок. Переводи текст из STT в JSON.
Правила:
Игнорируй мусор: "заметку", "в неё", "туда", "неё", "с названием".

Форматы:
Создание: {"type": "CREATE", "title": "...", "content": "..."}
Обновление: {"type": "UPDATE", "search_query": "Название", "append": "Текст"}
Поиск: {"type": "SEARCH", "query": "..."}

Если команда неясна, верни {"type": "UNKNOWN"}.
Всегда возвращай только JSON."""

async def parse_commands_llm(text: str, notes: list[dict] = None) -> list[dict]:
    if notes is None:
        notes = []
        
    try:
        # 1. Получаем активного провайдера из БД
        from .main import SessionLocal
        from .models import Config
        
        db = SessionLocal()
        config = db.query(Config).first()
        db.close()
        
        provider = config.llm_provider if config else None
        api_key = config.api_key if config else os.getenv("OPENAI_API_KEY")
        base_url = config.base_url if config else None
        model_name = config.model_name if config else "gpt-4o-mini"
        
        if not provider and not api_key:
            logger.warning("No LLM provider or API key found, falling back to regex parser")
            return parse_commands(text)
            
        # 2. Инициализация клиента
        if provider == "ollama":
            client = AsyncOpenAI(api_key="ollama", base_url=base_url or "http://localhost:11434/v1")
        else:
            if not api_key:
                logger.warning("OpenAI API key missing, falling back to regex parser")
                return parse_commands(text)
            client = AsyncOpenAI(api_key=api_key, base_url=base_url)
            
        user_content = f"notes:\n{json.dumps(notes, ensure_ascii=False)}\n\n\"{text}\""
        
        response = await client.chat.completions.create(
            model=model_name or "gpt-4o-mini",
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
        
        # Final cleaning of "stubborn" words
        stubborn_words = ["в неё", "в нее", "туда", "неё", "нее", "заметку", "заметка", "с названием"]
        
        def clean_field(val: Any) -> Any:
            if isinstance(val, str):
                v = val.strip()
                for word in stubborn_words:
                    v = re.sub(rf'\b{word}\b', '', v, flags=re.IGNORECASE)
                return re.sub(r'\s+', ' ', v).strip()
            return val

        if isinstance(parsed, dict):
            parsed["title"] = clean_field(parsed.get("title", ""))
            parsed["append"] = clean_field(parsed.get("append", ""))
            parsed["search_query"] = clean_field(parsed.get("search_query", ""))
            parsed["query"] = clean_field(parsed.get("query", ""))
            return [parsed]
        elif isinstance(parsed, list):
            for item in parsed:
                if isinstance(item, dict):
                    item["title"] = clean_field(item.get("title", ""))
                    item["append"] = clean_field(item.get("append", ""))
                    item["search_query"] = clean_field(item.get("search_query", ""))
                    item["query"] = clean_field(item.get("query", ""))
            return parsed
        return parse_commands(text)
    except Exception as e:
        logger.error(f"LLM Parsing error: {e}")
        return parse_commands(text)

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
    
    # 1. Pipeline очистки (стоп-слова) - НЕ удаляем "добавь" здесь, чтобы не сломать логику
    stop_words = ["пожалуйста", "мне", "сделай", "хочу", "можешь", "заметку", "заметка", "с названием", "в неё", "в нее", "туда", "по названию"]
    for word in stop_words:
        text = re.sub(rf'\b{word}\b', '', text)
    text = re.sub(r'\s+', ' ', text).strip()
    
    commands = []
    
    # Глаголы действий для проверки
    action_verbs = ["добавь", "создай", "найди", "удали", "сделай", "напиши", "купи", "скажи", "покажи"]
    
    def clean_stubborn(val: str) -> str:
        stubborn = ["в неё", "в нее", "туда", "неё", "нее", "заметку", "заметка", "с названием", "добавь"]
        v = val.strip()
        for word in stubborn:
            v = re.sub(rf'\b{word}\b', '', v, flags=re.IGNORECASE)
        return re.sub(r'\s+', ' ', v).strip()

    def is_valid_title(title: str) -> bool:
        if len(title) > 30:
            return False
        for verb in action_verbs:
            if re.search(rf'\b{verb}\b', title):
                return False
        return True

    # Проверяем конструкцию CREATE + UPDATE
    create_update_match = re.search(r'^(создай.*?|создать.*?|новая.*?)\s+(?:и\s+)?(добавь\s+.*)$', text)
    if create_update_match:
        parts = [create_update_match.group(1), create_update_match.group(2)]
    else:
        parts = [text]
        
    for i, part in enumerate(parts):
        part = part.strip()
        if not part:
            continue
            
        if part.startswith("создай") or part.startswith("создать") or part.startswith("новая"):
            title = re.sub(r'^(создай|создать|новую|новая)\s*', '', part).strip()
            title = clean_stubborn(title)
            
            if not is_valid_title(title):
                commands.append({"type": "SEARCH", "query": part})
            else:
                commands.append({
                    "type": "CREATE",
                    "title": title,
                    "content": ""
                })
        elif part.startswith("добавь"):
            if i > 0 and commands and commands[-1]["type"] == "CREATE":
                append_text = re.sub(r'^добавь\s+(в\s+)?', '', part).strip()
                append_text = clean_stubborn(append_text)
                commands.append({
                    "type": "UPDATE",
                    "append": append_text
                })
            else:
                cleaned = re.sub(r'^добавь\s+(в\s+)?', '', part).strip()
                subparts = cleaned.split(maxsplit=1)
                
                if len(subparts) == 2:
                    search_query = clean_stubborn(subparts[0])
                    append_text = clean_stubborn(subparts[1])
                    
                    if not is_valid_title(search_query):
                        commands.append({"type": "SEARCH", "query": part})
                    else:
                        commands.append({
                            "type": "UPDATE",
                            "search_query": search_query,
                            "append": append_text
                        })
                else:
                    commands.append({
                        "type": "UPDATE",
                        "search_query": clean_stubborn(cleaned),
                        "append": clean_stubborn(cleaned)
                    })
        elif part.startswith("найди") or part.startswith("покажи") or part.startswith("что есть про"):
            query = re.sub(r'^(найди|покажи|что есть про)\s*', '', part).strip()
            commands.append({
                "type": "SEARCH",
                "query": clean_stubborn(query)
            })
        else:
            commands.append({
                "type": "SEARCH",
                "query": clean_stubborn(part)
            })
            
    return commands

STT_HOST = "192.168.1.196"
STT_PORT = 10300

async def speech_to_text(audio_path: str) -> str:
    """Транскрибация аудио через Wyoming (Vosk)"""
    raw_path = audio_path.replace(".ogg", ".raw")
    logger.info(f"STT: Начинаю обработку. OGG: {audio_path}, RAW: {raw_path}")
    
    try:
        # 1. Конвертация через FFmpeg (строго s16le, 16kHz, Mono)
        try:
            logger.info(f"STT: Конвертация OGG -> RAW (s16le, 16kHz, Mono) через FFmpeg...")
            # Команда: ffmpeg -y -i input.ogg -ar 16000 -ac 1 -f s16le output.raw
            cmd = [
                "ffmpeg", "-y", "-i", audio_path,
                "-ar", "16000", "-ac", "1", "-f", "s16le", raw_path
            ]
            subprocess.run(cmd, check=True, capture_output=True)
            logger.info("STT: Конвертация успешно завершена.")
        except subprocess.CalledProcessError as e:
            logger.error(f"STT: Ошибка FFmpeg: {e.stderr.decode()}")
            return ""
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
            # ПЕРВЫМ: Намерение транскрибации
            await async_write_event(Transcribe(language="ru").event(), writer)
            await writer.drain()
            logger.info("STT: Событие Transcribe(ru) отправлено.")
            
            # ВТОРЫМ: Параметры аудио
            await async_write_event(
                AudioStart(rate=16000, width=2, channels=1).event(),
                writer,
            )
            await writer.drain()
            logger.info("STT: Событие AudioStart отправлено.")
            
            # ТРЕТЬИМ: Аудио данные
            logger.info("STT: Отправка аудио данных чанками по 4096 байт...")
            with open(raw_path, "rb") as f:
                while True:
                    chunk = f.read(4096)
                    if not chunk:
                        break
                    await async_write_event(
                        AudioChunk(audio=chunk, rate=16000, width=2, channels=1).event(), 
                        writer
                    )
                    await writer.drain()
            
            # ПОСЛЕДНИМ: Остановка
            await async_write_event(AudioStop().event(), writer)
            await writer.drain()  # Сброс буфера в сеть
            logger.info("STT: Событие AudioStop отправлено и буфер сброшен.")
            logger.info("STT: Ожидаю результат от сервера...")
            
            # 4. Ожидание результата
            transcript_text = ""
            while True:
                try:
                    event = await asyncio.wait_for(async_read_event(reader), timeout=20.0)
                except asyncio.TimeoutError:
                    logger.error("STT: Тайм-аут ожидания ответа от Vosk (20s)")
                    break

                if event is None:
                    logger.warning("STT: Соединение закрыто сервером до получения результата.")
                    break
                
                logger.info(f"STT: Получено событие {event.type}")
                
                if Transcript.is_type(event.type):
                    transcript = Transcript.from_event(event)
                    transcript_text = transcript.text
                    logger.info(f"STT: Получен Transcript: «{transcript_text}»")
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
        for p in [audio_path, raw_path]:
            if os.path.exists(p):
                try:
                    os.remove(p)
                except:
                    pass

dp = Dispatcher()
bot_task = None
current_bot = None
current_admin_id = None

async def save_note_to_api(title: str, content: str, note_id: str = None) -> Dict[str, Any]:
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
    
    logger.info(f"Final Payload: {payload}")
    logger.info(f"Отправка заметки на URL: {url} для пользователя: {current_admin_id}")
    
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(url, json=payload, headers=headers) as response:
                resp_text = await response.text()
                logger.info(f"Ответ API: {response.status}, Тело: {resp_text}")
                if response.status in [200, 201]:
                    data = await response.json()
                    return {"status": "success", "note_id": data.get("id"), "data": data}
                else:
                    return {"status": "error", "message": f"Ошибка при сохранении: {response.status}"}
    except Exception as e:
        logger.error(f"Ошибка при обращении к API: {e}")
        return {"status": "error", "message": f"Ошибка при обращении к API: {str(e)}"}

async def search_note_by_title(title: str) -> Dict[str, Any]:
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
                    return {"status": "success", "data": data}
                return {"status": "error", "message": f"Ошибка: {response.status}"}
    except Exception as e:
        logger.error(f"Ошибка при поиске заметки: {e}")
        return {"status": "error", "message": str(e)}

async def semantic_search_api(query: str) -> Dict[str, Any]:
    """Семантический поиск через API"""
    import urllib.parse
    encoded_query = urllib.parse.quote(query)
    url = f"http://localhost:3344/api/notes/semantic-search?query={encoded_query}"
    
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
                    return {"status": "success", "data": data}
                return {"status": "error", "message": f"Ошибка: {response.status}"}
    except Exception as e:
        logger.error(f"Ошибка при семантическом поиске: {e}")
        return {"status": "error", "message": str(e)}



@dp.callback_query(F.data.startswith("open_note_"))
async def handle_open_note(callback: types.CallbackQuery):
    note_id = callback.data.replace("open_note_", "")
    # В идеале здесь нужно сходить в БД и достать полную заметку,
    # но для простоты покажем сообщение
    await callback.answer(f"Открытие заметки {note_id}...")
    await callback.message.answer(f"Вы выбрали заметку с ID: {note_id}. (Здесь можно вывести полный текст)")

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
        logger.info(f"Перенаправляю распознанный текст в обработчик команд: {text}")
        fake_msg = message.model_copy(update={"text": text})
        await handle_text(fake_msg)
        
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
        
        result = await save_note_to_api(title, content)
        if isinstance(result, dict) and result.get("status") == "success":
            await message.answer(f"📸 Изображение сохранено!\n✅ Заметка успешно сохранена!")
        else:
            error_msg = result.get("message", "Неизвестная ошибка") if isinstance(result, dict) else str(result)
            await message.answer(error_msg)
            
    except Exception as e:
        logger.error(f"Error handling photo: {e}")
        await message.answer("❌ Ошибка при сохранении изображения.")

async def patch_note_api(note_id: str, content: str) -> Dict[str, Any]:
    """Обновление контента заметки через API"""
    url = f"http://localhost:3344/api/notes/{note_id}"
    
    # Генерируем токен
    expire = datetime.utcnow() + timedelta(minutes=60)
    to_encode = {"sub": "admin", "exp": expire}
    token = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    
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
        logger.error(f"Ошибка при обновлении заметки: {e}")
        return {"status": "error", "message": str(e)}

async def get_all_notes_api() -> list[dict]:
    """Получение всех заметок пользователя через API"""
    url = "http://localhost:3344/api/notes"
    
    # Генерируем токен
    expire = datetime.utcnow() + timedelta(minutes=60)
    to_encode = {"sub": "admin", "exp": expire}
    token = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    
    headers = {"Authorization": f"Bearer {token}"}
    
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(url, headers=headers) as response:
                if response.status == 200:
                    return await response.json()
                return []
    except Exception as e:
        logger.error(f"Ошибка при получении заметок: {e}")
        return []

@dp.message(F.text)
async def handle_text(message: types.Message):
    """Единый обработчик текстовых сообщений с системой интентов"""
    # Проверка admin_id
    if current_admin_id and str(message.from_user.id) != str(current_admin_id):
        logger.warning(f"Unauthorized access attempt from {message.from_user.id}")
        return

    if message.text.startswith('/'):
        return
        
    normalized_text = normalize_intent(message.text)
        
    # Получаем список заметок для контекста LLM
    notes = await get_all_notes_api()
    notes_context = [{"id": n.get("id"), "title": n.get("title"), "content": n.get("content")} for n in notes]
        
    commands = await parse_commands_llm(normalized_text, notes_context)
    
    chain_note_id = None
    
    for cmd in commands:
        intent = cmd.get("type")
        
        if intent == "UNKNOWN":
            await message.answer("Извините, я не совсем понял команду. Попробуйте переформулировать. 🤔")
            continue
            
        if intent == "CREATE":
            title = cmd.get("title", "Без названия")
            content = cmd.get("content", "")
            if not title:
                title = "Без названия"
                
            logger.info(f"DEBUG: parsed_command={cmd}")
            
            result = await save_note_to_api(title, content)
            logger.info(f"DEBUG: result_type={type(result)} result_value={result}")
            
            if isinstance(result, dict) and result.get("status") == "success":
                chain_note_id = result.get("note_id")
                await message.answer(f"Создал новую заметку «{title}»! 📝")
            else:
                chain_note_id = None
                error_msg = result.get("message", "Неизвестная ошибка") if isinstance(result, dict) else str(result)
                await message.answer(f"❌ Ошибка при создании заметки: {error_msg}")
                
        elif intent == "UPDATE":
            search_query = cmd.get("search_query")
            note_id = cmd.get("note_id")
            append_text = cmd.get("append", "")
            logger.info(f"DEBUG: parsed_command={cmd}")
            
            target_note_id = note_id or chain_note_id
            
            if not target_note_id and search_query:
                result = await semantic_search_api(search_query)
                logger.info(f"DEBUG: result_type={type(result)} result_value={result}")
                if isinstance(result, dict) and result.get("status") == "success":
                    data = result.get("data", [])
                    if data and isinstance(data, list) and len(data) > 0:
                        target_note_id = data[0].get('id')
                    
            if target_note_id:
                # Если append_text это список, объединяем его в строку
                if isinstance(append_text, list):
                    append_text = "\n- " + "\n- ".join(append_text)
                    
                result = await patch_note_api(target_note_id, append_text)
                logger.info(f"DEBUG: result_type={type(result)} result_value={result}")
                if isinstance(result, dict) and result.get("status") == "success":
                    data = result.get("data", {})
                    title = data.get('title', 'Без названия')
                    await message.answer(f"✅ Добавил текст в заметку «{title}»!")
                    chain_note_id = target_note_id
                else:
                    error_msg = result.get("message", "Неизвестная ошибка") if isinstance(result, dict) else str(result)
                    await message.answer(f"❌ Ошибка при обновлении заметки: {error_msg}")
            else:
                await message.answer("Ничего не найдено. 😔")
                
        elif intent == "SEARCH":
            search_query = cmd.get("query", "")
            logger.info(f"DEBUG: parsed_command={cmd}")
            
            if not search_query:
                await message.answer("Что именно нужно найти?")
                continue
                
            await message.answer(f"🔍 Ищу заметки по запросу: «{search_query}»...")
            result = await semantic_search_api(search_query)
            logger.info(f"DEBUG: result_type={type(result)} result_value={result}")
            
            if isinstance(result, dict) and result.get("status") == "success":
                results = result.get("data", [])
                if not results:
                    await message.answer("К сожалению, ничего не найдено. 😔")
                    continue
                    
                from aiogram.utils.keyboard import InlineKeyboardBuilder
                response_text = f"Вот что я нашел по запросу «{search_query}»:\n\n"
                builder = InlineKeyboardBuilder()
                
                for i, note in enumerate(results, 1):
                    title = note.get('title', 'Без названия')
                    content = note.get('content', '')
                    preview = content[:100] + "..." if len(content) > 100 else content
                    preview = preview.replace('\n', ' ')
                    response_text += f"{i}. *{title}*\n_{preview}_\n\n"
                    builder.button(text=f"Открыть {i}", callback_data=f"open_note_{note['id']}")
                    
                builder.adjust(1)
                await message.answer(response_text, parse_mode="Markdown", reply_markup=builder.as_markup())
            else:
                error_msg = result.get("message", "Неизвестная ошибка") if isinstance(result, dict) else str(result)
                await message.answer(f"❌ Ошибка при поиске: {error_msg}")

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
