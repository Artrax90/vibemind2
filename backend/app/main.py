from fastapi import FastAPI, Depends, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
import asyncio
import os
import logging

from .models import Base, Config, User
from .bot import restart_bot, current_bot

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Настройка БД (Берем из ENV или используем SQLite для локальной разработки)
SQLALCHEMY_DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./vibemind.db") 

engine = create_engine(SQLALCHEMY_DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Создаем таблицы (в проде лучше использовать Alembic)
Base.metadata.create_all(bind=engine)

app = FastAPI(title="VibeMind Backend")

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

class SettingsUpdate(BaseModel):
    tg_token: str | None = None
    tg_admin_id: str | None = None
    llm_provider: str | None = None
    api_key: str | None = None
    proxy_url: str | None = None

@app.post("/api/settings")
async def update_settings(settings: SettingsUpdate, db: Session = Depends(get_db)):
    """Сохранение настроек в БД и перезапуск бота"""
    config = db.query(Config).first()
    if not config:
        config = Config()
        db.add(config)
    
    # Обновляем поля
    if settings.tg_token is not None: config.tg_token = settings.tg_token
    if settings.tg_admin_id is not None: config.tg_admin_id = settings.tg_admin_id
    if settings.llm_provider is not None: config.llm_provider = settings.llm_provider
    if settings.api_key is not None: config.api_key = settings.api_key
    if settings.proxy_url is not None: config.proxy_url = settings.proxy_url
    
    db.commit()
    
    # Динамически перезапускаем бота с новыми настройками
    if config.tg_token:
        # Запускаем перезапуск как фоновую задачу, чтобы не блокировать HTTP ответ
        asyncio.create_task(restart_bot(config.tg_token, config.proxy_url))
        
    return {"status": "success", "message": "Настройки сохранены, бот перезапускается"}

@app.get("/api/bot/status")
async def get_bot_status():
    """Проверка статуса фонового процесса бота"""
    is_running = current_bot is not None
    return {"status": "connected" if is_running else "disconnected"}
    
@app.on_event("startup")
async def startup_event():
    """При старте FastAPI сервера поднимаем бота, если есть токен, и создаем админа"""
    db = SessionLocal()
    try:
        # 1. Создание дефолтного админа, если таблица пуста
        user_count = db.query(User).count()
        if user_count == 0:
            logger.info("Таблица пользователей пуста. Создаем дефолтного администратора...")
            # В реальном проекте пароль должен быть захеширован (например, через passlib)
            default_admin = User(username="admin", hashed_password="hashed_admin_password")
            db.add(default_admin)
            db.commit()
            logger.info("Дефолтный администратор создан (admin / admin).")

        # 2. Проверка конфига и запуск бота
        config = db.query(Config).first()
        if not config or not config.tg_token:
            logger.info("Токен Telegram не найден в БД. Бот находится в статусе 'Idle'. Пожалуйста, настройте его через Web UI.")
        else:
            logger.info("Найден токен Telegram. Запускаем бота...")
            asyncio.create_task(restart_bot(config.tg_token, config.proxy_url))
    except Exception as e:
        logger.error(f"Ошибка при запуске: {e}")
    finally:
        db.close()

# Раздача статических файлов фронтенда (React/Vite)
STATIC_DIR = "/app/static"
if os.path.exists(STATIC_DIR):
    app.mount("/assets", StaticFiles(directory=f"{STATIC_DIR}/assets"), name="assets")
    
    @app.get("/{full_path:path}")
    async def serve_frontend(full_path: str):
        path = os.path.join(STATIC_DIR, full_path)
        if os.path.isfile(path):
            return FileResponse(path)
        return FileResponse(os.path.join(STATIC_DIR, "index.html"))
