from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
import asyncio
import os
import logging
from passlib.context import CryptContext
from jose import jwt
from datetime import datetime, timedelta

from .models import Base, Config, User, Note, Folder
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

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="api/auth/login")

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

async def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise credentials_exception
    except Exception:
        raise credentials_exception
    
    user = db.query(User).filter(User.username == username).first()
    if user is None:
        raise credentials_exception
    return user

from pydantic import BaseModel, EmailStr
from typing import List

class UserCreate(BaseModel):
    username: str
    email: EmailStr
    password: str

class UserResponse(BaseModel):
    id: int
    username: str
    email: EmailStr | None = None
    is_active: bool

    class Config:
        from_attributes = True

def get_password_hash(password: str) -> str:
    return pwd_context.hash(password)

@app.post("/api/users", response_model=UserResponse, status_code=201)
async def create_user(user: UserCreate, db: Session = Depends(get_db)):
    existing_user = db.query(User).filter(User.email == user.email).first()
    if existing_user:
        raise HTTPException(status_code=400, detail="Email already registered")
    
    hashed_password = get_password_hash(user.password)
    new_user = User(
        username=user.username, 
        email=user.email, 
        hashed_password=hashed_password,
        is_active=1
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    return new_user

@app.get("/api/users", response_model=List[UserResponse])
async def get_users(db: Session = Depends(get_db)):
    users = db.query(User).all()
    return users

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

class BotTestRequest(BaseModel):
    tg_token: str
    proxy_url: str | None = None
    proxy_config: dict | None = None

class ProxyTestRequest(BaseModel):
    proxy_config: dict | None = None

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
async def test_bot(req: BotTestRequest):
    if not req.tg_token:
        raise HTTPException(status_code=400, detail="Bot token not configured")
    
    success, message = await test_bot_connection(req.tg_token, req.proxy_url, req.proxy_config)
    if success:
        return {"status": "success", "message": message}
    else:
        raise HTTPException(status_code=500, detail=message)

@app.post("/api/proxy/test")
async def test_proxy(req: ProxyTestRequest):
    import aiohttp
    from aiohttp_socks import ProxyConnector
    
    if not req.proxy_config or not req.proxy_config.get('host'):
        raise HTTPException(status_code=400, detail="Proxy host not configured")
        
    pc = req.proxy_config
    protocol = pc.get('protocol', 'HTTP').lower()
    host = pc.get('host')
    port = pc.get('port')
    username = pc.get('username')
    password = pc.get('password')
    
    if protocol in ['socks4', 'socks5']:
        auth = f"{username}:{password}@" if username and password else ""
        proxy_url = f"{protocol}://{auth}{host}"
        if port:
            proxy_url += f":{port}"
        connector = ProxyConnector.from_url(proxy_url)
    else:
        auth = f"{username}:{password}@" if username and password else ""
        proxy_url = f"http://{auth}{host}"
        if port:
            proxy_url += f":{port}"
        connector = None # aiohttp handles http proxy directly via proxy param
        
    try:
        async with aiohttp.ClientSession(connector=connector) as session:
            kwargs = {}
            if protocol not in ['socks4', 'socks5']:
                kwargs['proxy'] = proxy_url
            async with session.get('https://api.telegram.org', timeout=10, **kwargs) as resp:
                if resp.status == 200:
                    return {"status": "success", "message": "Proxy connection successful!"}
                else:
                    raise HTTPException(status_code=500, detail=f"Proxy returned status {resp.status}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Proxy connection failed: {str(e)}")

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

class NoteCreate(BaseModel):
    id: str
    title: str
    content: str | None = None
    folderId: str | None = None

class FolderCreate(BaseModel):
    id: str
    name: str
    parentId: str | None = None

@app.get("/api/notes")
async def get_notes(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    notes = db.query(Note).filter(Note.user_id == current_user.id).all()
    return [{"id": n.id, "title": n.title, "content": n.content, "folderId": n.folderId} for n in notes]

@app.post("/api/notes")
async def create_or_update_note(note: NoteCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    db_note = db.query(Note).filter(Note.id == note.id, Note.user_id == current_user.id).first()
    if db_note:
        db_note.title = note.title
        db_note.content = note.content
        db_note.folderId = note.folderId
    else:
        db_note = Note(
            id=note.id,
            title=note.title,
            content=note.content,
            folderId=note.folderId,
            user_id=current_user.id
        )
        db.add(db_note)
    db.commit()
    return note.dict()

@app.delete("/api/notes/{note_id}")
async def delete_note(note_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    db.query(Note).filter(Note.id == note_id, Note.user_id == current_user.id).delete()
    db.commit()
    return {"status": "success"}

@app.get("/api/folders")
async def get_folders(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    folders = db.query(Folder).filter(Folder.user_id == current_user.id).all()
    return [{"id": f.id, "name": f.name, "parentId": f.parentId} for f in folders]

@app.post("/api/folders")
async def create_or_update_folder(folder: FolderCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    db_folder = db.query(Folder).filter(Folder.id == folder.id, Folder.user_id == current_user.id).first()
    if db_folder:
        db_folder.name = folder.name
        db_folder.parentId = folder.parentId
    else:
        db_folder = Folder(
            id=folder.id,
            name=folder.name,
            parentId=folder.parentId,
            user_id=current_user.id
        )
        db.add(db_folder)
    db.commit()
    return folder.dict()

@app.delete("/api/folders/{folder_id}")
async def delete_folder(folder_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    db.query(Folder).filter(Folder.id == folder_id, Folder.user_id == current_user.id).delete()
    db.query(Note).filter(Note.folderId == folder_id, Note.user_id == current_user.id).delete()
    db.commit()
    return {"status": "success"}

@app.get("/api/bot/status")
async def get_bot_status():
    """Проверка статуса фонового процесса бота"""
    is_running = current_bot is not None
    return {"status": "connected" if is_running else "disconnected"}
    
@app.on_event("startup")
async def startup_event():
    """При старте FastAPI сервера поднимаем бота, если есть токен, и создаем админа"""
    # Ensure all tables are created (useful if models were added after initial create_all)
    Base.metadata.create_all(bind=engine)
    
    db = SessionLocal()
    try:
        # Schema Migration: Check and add proxy_config if missing
        try:
            db.execute(text("SELECT proxy_config FROM configs LIMIT 1"))
        except Exception:
            db.rollback()
            logger.info("Adding proxy_config column to configs table...")
            try:
                db.execute(text("ALTER TABLE configs ADD COLUMN proxy_config JSON"))
                db.commit()
            except Exception as e:
                logger.error(f"Failed to add proxy_config column: {e}")
                db.rollback()

        # Миграция схемы: добавляем email и is_active в users, если их нет
        try:
            db.execute(text("SELECT email FROM users LIMIT 1"))
        except Exception:
            db.rollback()
            try:
                db.execute(text("ALTER TABLE users ADD COLUMN email VARCHAR"))
                db.commit()
            except Exception as e:
                logger.error(f"Failed to add email column: {e}")
                db.rollback()
                
        try:
            db.execute(text("SELECT is_active FROM users LIMIT 1"))
        except Exception:
            db.rollback()
            try:
                db.execute(text("ALTER TABLE users ADD COLUMN is_active INTEGER DEFAULT 1"))
                db.commit()
            except Exception as e:
                logger.error(f"Failed to add is_active column: {e}")
                db.rollback()

        # Migration: Add user_id to notes and folders
        for table in ["notes", "folders"]:
            try:
                db.execute(text(f"SELECT user_id FROM {table} LIMIT 1"))
            except Exception:
                db.rollback()
                try:
                    db.execute(text(f"ALTER TABLE {table} ADD COLUMN user_id INTEGER"))
                    db.commit()
                except Exception as e:
                    logger.error(f"Failed to add user_id column to {table}: {e}")
                    db.rollback()

        # 1. Создание дефолтного админа, если таблица пуста
        try:
            user_count = db.query(User).count()
            if user_count == 0:
                logger.info("Таблица пользователей пуста. Создаем дефолтного администратора...")
                # 2. TRUE ZERO-CONFIG: Default Admin Fix
                hashed_admin = pwd_context.hash("admin")
                default_admin = User(username="admin", hashed_password=hashed_admin)
                db.add(default_admin)
                db.commit()
                logger.info("Дефолтный администратор создан (admin / admin).")
        except Exception as e:
            logger.error(f"Ошибка при проверке/создании пользователей: {e}")
            db.rollback()

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
