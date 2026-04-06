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
from passlib.context import CryptContext
from jose import jwt
from datetime import datetime, timedelta

from .models import Base, Config, User
from .bot import restart_bot, current_bot, test_bot_connection

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# JWT Settings
SECRET_KEY = os.getenv("ENCRYPTION_KEY", "fallback-zero-config-secret-key-change-in-production")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 # 24 hours

# Password Hashing Fix (Avoids bcrypt version conflict)
pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")

# 4. DIRECTORY AUTO-PROVISIONING
directories = ['/storage/notes', '/storage/logs', '/storage/backups']
for d in directories:
    os.makedirs(d, exist_ok=True)

# 2. TRUE ZERO-CONFIG (Fallback Encryption)
ENCRYPTION_KEY = os.getenv("ENCRYPTION_KEY")
if not ENCRYPTION_KEY:
    logger.warning("ENCRYPTION_KEY not provided via Docker. Using fallback derived key. The app will start.")
    ENCRYPTION_KEY = "fallback-zero-config-secret-key-change-in-production"

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
    base_url: str | None = None
    model_name: str | None = None
    proxy_config: dict | None = None

class LoginRequest(BaseModel):
    username: str
    password: str

class ExternalDBRequest(BaseModel):
    db_type: str
    display_name: str
    connection_string: str

@app.post("/api/auth/login")
async def login(req: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == req.username).first()
    if not user or not pwd_context.verify(req.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    
    expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode = {"sub": user.username, "exp": expire}
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    
    return {"access_token": encoded_jwt, "token_type": "bearer"}

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
    if settings.base_url is not None: config.base_url = settings.base_url
    if settings.model_name is not None: config.model_name = settings.model_name
    if settings.proxy_config is not None: config.proxy_config = settings.proxy_config
    
    db.commit()
    
    # Динамически перезапускаем бота с новыми настройками
    if config.tg_token:
        # Запускаем перезапуск как фоновую задачу, чтобы не блокировать HTTP ответ
        asyncio.create_task(restart_bot(config.tg_token, config.proxy_url, config.proxy_config))
        
    return {"status": "success", "message": "Настройки сохранены, бот перезапускается"}

@app.post("/api/bot/test")
async def test_bot(db: Session = Depends(get_db)):
    config = db.query(Config).first()
    if not config or not config.tg_token:
        raise HTTPException(status_code=400, detail="Bot token not configured")
    
    success, message = await test_bot_connection(config.tg_token, config.proxy_url, config.proxy_config)
    if success:
        return {"status": "success", "message": message}
    else:
        raise HTTPException(status_code=500, detail=message)

@app.post("/api/external-db")
async def add_external_db(req: ExternalDBRequest, db: Session = Depends(get_db)):
    config = db.query(Config).first()
    if not config:
        config = Config()
        db.add(config)
    
    if not config.external_dbs:
        config.external_dbs = []
    
    # Create a copy to trigger SQLAlchemy change detection for JSON column
    new_dbs = list(config.external_dbs)
    new_dbs.append({
        "type": req.db_type,
        "name": req.display_name,
        "connection_string": req.connection_string
    })
    config.external_dbs = new_dbs
    
    db.commit()
    return {"status": "success", "message": "External DB added", "dbs": config.external_dbs}

@app.get("/api/external-db")
async def get_external_dbs(db: Session = Depends(get_db)):
    config = db.query(Config).first()
    return {"dbs": config.external_dbs if config and config.external_dbs else []}

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
            # 2. TRUE ZERO-CONFIG: Default Admin Fix
            hashed_admin = pwd_context.hash("admin")
            default_admin = User(username="admin", hashed_password=hashed_admin)
            db.add(default_admin)
            db.commit()
            logger.info("Дефолтный администратор создан (admin / admin).")

        # 2. Проверка конфига и запуск бота
        config = db.query(Config).first()
        if not config or not config.tg_token:
            logger.info("Токен Telegram не найден в БД. Бот находится в статусе 'Idle'. Пожалуйста, настройте его через Web UI.")
        else:
            logger.info("Найден токен Telegram. Запускаем бота...")
            asyncio.create_task(restart_bot(config.tg_token, config.proxy_url, config.proxy_config))
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
