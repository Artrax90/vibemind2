from fastapi import FastAPI, Depends, HTTPException, status, File, UploadFile
from fastapi.security import OAuth2PasswordBearer
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import create_engine, text, or_, inspect
from sqlalchemy.orm import sessionmaker
import asyncio
import os
import logging
import httpx
from passlib.context import CryptContext
from jose import jwt
from datetime import datetime, timedelta

from .models import Base, Config, User, Note, Folder
from . import bot as bot_module
from .bot import restart_bot, test_bot_connection

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# JWT Settings
SECRET_KEY = os.getenv("ENCRYPTION_KEY", "fallback-zero-config-secret-key-change-in-production")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 # 24 hours

# Password Hashing Fix (Avoids bcrypt version conflict)
pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")

import uuid

# 4. DIRECTORY AUTO-PROVISIONING
directories = ['/app/storage/notes', '/app/storage/logs', '/app/storage/backups', '/app/storage/uploads']
for d in directories:
    os.makedirs(d, exist_ok=True)

# 2. TRUE ZERO-CONFIG (Fallback Encryption)
ENCRYPTION_KEY = os.getenv("ENCRYPTION_KEY")
if not ENCRYPTION_KEY:
    logger.warning("ENCRYPTION_KEY not provided via Docker. Using fallback derived key. The app will start.")
    ENCRYPTION_KEY = "fallback-zero-config-secret-key-change-in-production"

# Настройка БД (Берем из ENV или используем SQLite для локальной разработки)
SQLALCHEMY_DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:////app/storage/vibemind.db") 

engine = create_engine(SQLALCHEMY_DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Create vector extension before creating tables
try:
    with engine.connect() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector;"))
        conn.commit()
except Exception as e:
    logger.warning(f"Could not create vector extension (might be sqlite or already exists): {e}")

# Создаем таблицы (в проде лучше использовать Alembic)
Base.metadata.create_all(bind=engine)

# Добавляем недостающие колонки в configs (для миграции на лету)
try:
    inspector = inspect(engine)
    if 'configs' in inspector.get_table_names():
        columns = [c['name'] for c in inspector.get_columns('configs')]
        
        with engine.connect() as conn:
            if 'base_url' not in columns:
                conn.execute(text("ALTER TABLE configs ADD COLUMN base_url VARCHAR;"))
                logger.info("Added base_url column to configs table")
            
            if 'model_name' not in columns:
                conn.execute(text("ALTER TABLE configs ADD COLUMN model_name VARCHAR;"))
                logger.info("Added model_name column to configs table")

            if 'proxy_config' not in columns:
                conn.execute(text("ALTER TABLE configs ADD COLUMN proxy_config JSON;"))
                logger.info("Added proxy_config column to configs table")

            if 'external_dbs' not in columns:
                conn.execute(text("ALTER TABLE configs ADD COLUMN external_dbs JSON;"))
                logger.info("Added external_dbs column to configs table")
                
            conn.commit()
except Exception as e:
    logger.warning(f"Could not migrate configs table: {e}")

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

@app.post("/api/upload")
async def upload_file(file: UploadFile = File(...), current_user: User = Depends(get_current_user)):
    """Загрузка изображений на сервер"""
    try:
        # Create unique filename using UUID
        ext = os.path.splitext(file.filename)[1]
        filename = f"{uuid.uuid4()}{ext}"
        filepath = os.path.join('/app/storage/uploads', filename)
        
        with open(filepath, "wb") as buffer:
            buffer.write(await file.read())
            
        # Return the URL to access the file
        return {"url": f"/api/uploads/{filename}"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Upload failed: {str(e)}")

@app.get("/api/uploads/{filename}")
async def get_upload(filename: str):
    """Раздача загруженных файлов"""
    filepath = os.path.join('/app/storage/uploads', filename)
    if os.path.exists(filepath):
        return FileResponse(filepath)
    raise HTTPException(status_code=404, detail="File not found")

@app.post("/api/auth/login")
async def login(req: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == req.username).first()
    if not user or not pwd_context.verify(req.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    
    expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode = {"sub": user.username, "exp": expire}
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    
    return {"access_token": encoded_jwt, "token_type": "bearer"}

@app.get("/api/settings")
async def get_settings(db: Session = Depends(get_db)):
    config = db.query(Config).first()
    if not config:
        return {}
    return {
        "tg_token": config.tg_token,
        "tg_admin_id": config.tg_admin_id,
        "llm_provider": config.llm_provider,
        "api_key": config.api_key,
        "proxy_url": config.proxy_url,
        "base_url": config.base_url,
        "model_name": config.model_name,
        "proxy_config": config.proxy_config
    }

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
        asyncio.create_task(restart_bot(config.tg_token, config.proxy_url, config.proxy_config, config.tg_admin_id))
        
    return {"status": "success", "message": "Настройки сохранены, бот перезапускается"}

@app.post("/api/bot/test")
async def test_bot(req: BotTestRequest):
    if not req.tg_token:
        raise HTTPException(status_code=400, detail="Bot token not configured")
    
    success, message = await test_bot_connection(req.tg_token, req.proxy_url, req.proxy_config)
    if success:
        return {"ok": True, "message": "Bot is active"}
    else:
        if "TIMEOUT_ERROR" in message:
            raise HTTPException(status_code=408, detail=message.replace("TIMEOUT_ERROR: ", ""))
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
    
    # Sanitize host: remove any existing protocol prefix
    if host and isinstance(host, str) and "://" in host:
        host = host.split("://")[-1]
    
    if not host:
        return {"status": "error", "detail": "Proxy host is required"}
        
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

class TestIntegrationRequest(BaseModel):
    provider: str
    api_key: str | None = None
    base_url: str | None = None
    model_name: str

@app.post("/api/integrations/test")
async def test_integration(req: TestIntegrationRequest, current_user: User = Depends(get_current_user)):
    try:
        if req.provider in ["openai", "ollama", "openrouter"]:
            from openai import AsyncOpenAI
            base_url = req.base_url
            if req.provider == "openrouter" and not base_url:
                base_url = "https://openrouter.ai/api/v1"
            
            client = AsyncOpenAI(
                api_key=req.api_key or "dummy",
                base_url=base_url
            )
            # Make a minimal request
            response = await client.chat.completions.create(
                model=req.model_name,
                messages=[{"role": "user", "content": "ping"}],
                max_tokens=5
            )
            return {"status": "success", "message": "Connection successful"}
        elif req.provider == "gemini":
            # Gemini API test using httpx
            api_key = req.api_key
            if not api_key:
                raise HTTPException(status_code=400, detail="API key is required for Gemini")
            
            model = req.model_name or "gemini-1.5-flash"
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
            
            async with httpx.AsyncClient() as client:
                payload = {
                    "contents": [{"parts": [{"text": "ping"}]}],
                    "generationConfig": {"maxOutputTokens": 5}
                }
                response = await client.post(url, json=payload, timeout=10)
                
                if response.status_code == 200:
                    return {"status": "success", "message": "Gemini connection successful"}
                else:
                    error_data = response.json()
                    error_msg = error_data.get("error", {}).get("message", "Unknown Gemini error")
                    raise HTTPException(status_code=response.status_code, detail=f"Gemini error: {error_msg}")
        else:
            raise HTTPException(status_code=400, detail="Unsupported provider")
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/notes")
async def get_notes(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    notes = db.query(Note).filter(Note.user_id == current_user.id).all()
    return [{"id": n.id, "title": n.title, "content": n.content, "folderId": n.folderId} for n in notes]

@app.post("/api/notes")
async def create_or_update_note(note: NoteCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    from .utils.embeddings import embedding_manager
    
    # Generate embedding for title + content
    text_to_embed = f"{note.title}\n{note.content or ''}"
    vector = embedding_manager.get_vector(text_to_embed)
    
    db_note = db.query(Note).filter(Note.id == note.id, Note.user_id == current_user.id).first()
    if db_note:
        db_note.title = note.title
        db_note.content = note.content
        db_note.folderId = note.folderId
        db_note.embedding = vector
    else:
        db_note = Note(
            id=note.id,
            title=note.title,
            content=note.content,
            folderId=note.folderId,
            user_id=current_user.id,
            embedding=vector
        )
        db.add(db_note)
    db.commit()
    return note.dict()

class NoteUpdate(BaseModel):
    title: str | None = None
    content: str | None = None
    folderId: str | None = None

@app.get("/api/notes/search")
async def search_notes(query: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Поиск заметок по заголовку или содержимому (частичное совпадение)"""
    notes = db.query(Note).filter(
        Note.user_id == current_user.id,
        or_(
            Note.title.ilike(f"%{query}%"),
            Note.content.ilike(f"%{query}%")
        )
    ).limit(5).all()
    return [{"id": n.id, "title": n.title, "content": n.content} for n in notes]

@app.get("/api/notes/semantic-search")
async def semantic_search_notes(query: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Семантический поиск по заметкам"""
    from .utils.embeddings import embedding_manager
    
    # Generate vector for the query
    query_vector = embedding_manager.get_vector(query)
    
    # Search using cosine distance (<=>)
    # Cosine similarity threshold = 0.55 => Cosine distance threshold = 1 - 0.55 = 0.45
    distance_threshold = 0.45
    
    # Get top 5 results that meet the threshold
    results = db.query(
        Note, 
        Note.embedding.cosine_distance(query_vector).label("distance")
    ).filter(
        Note.user_id == current_user.id,
        Note.embedding.is_not(None)
    ).filter(
        Note.embedding.cosine_distance(query_vector) <= distance_threshold
    ).order_by(
        Note.embedding.cosine_distance(query_vector)
    ).limit(5).all()
    
    return [{"id": r[0].id, "title": r[0].title, "content": r[0].content, "distance": float(r[1])} for r in results]

@app.get("/api/notes/{note_id}")
async def get_note(note_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    note = db.query(Note).filter(Note.id == note_id, Note.user_id == current_user.id).first()
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")
    return {"id": note.id, "title": note.title, "content": note.content, "folderId": note.folderId}

@app.patch("/api/notes/{note_id}")
async def patch_note(note_id: str, note_update: NoteUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    from .utils.embeddings import embedding_manager
    
    db_note = db.query(Note).filter(Note.id == note_id, Note.user_id == current_user.id).first()
    if not db_note:
        raise HTTPException(status_code=404, detail="Note not found")
        
    # Update fields if provided
    if note_update.title is not None:
        db_note.title = note_update.title
    if note_update.content is not None:
        db_note.content = note_update.content
    if note_update.folderId is not None:
        # Allow clearing folderId by passing empty string or null
        db_note.folderId = note_update.folderId if note_update.folderId else None
        
    # Update embedding if title or content changed
    if note_update.title is not None or note_update.content is not None:
        text_to_embed = f"{db_note.title}\n{db_note.content or ''}"
        db_note.embedding = embedding_manager.get_vector(text_to_embed)
    
    db.commit()
    return {"id": db_note.id, "title": db_note.title, "content": db_note.content, "folderId": db_note.folderId}

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
    is_running = bot_module.current_bot is not None
    return {"status": "connected" if is_running else "disconnected"}

@app.on_event("startup")
async def startup_event():
    """При старте FastAPI сервера поднимаем бота, если есть токен, и создаем админа"""
    db = SessionLocal()
    try:
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
            asyncio.create_task(restart_bot(config.tg_token, config.proxy_url, config.proxy_config, config.tg_admin_id))
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
