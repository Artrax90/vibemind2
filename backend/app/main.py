from fastapi import FastAPI, Depends, HTTPException, status, File, UploadFile
from fastapi.security import OAuth2PasswordBearer
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session
from sqlalchemy import create_engine, text, or_, inspect
from sqlalchemy.orm import sessionmaker
import asyncio
import os
import logging
import httpx
import uuid
from openai import AsyncOpenAI
from passlib.context import CryptContext
from jose import jwt
from datetime import datetime, timedelta
from typing import List, Optional

from .models import Base, Config, User, Note, Folder, Share
from . import bot as bot_module
from .bot import restart_bot, test_bot_connection

# Logging setup
BASE_DIR = os.getcwd()
STORAGE_DIR = os.path.join(BASE_DIR, "storage")
LOG_DIR = os.path.join(STORAGE_DIR, "logs")
LOG_FILE = os.path.join(LOG_DIR, "vibemind.log")

os.makedirs(LOG_DIR, exist_ok=True)
os.makedirs(os.path.join(STORAGE_DIR, 'uploads'), exist_ok=True)

root_logger = logging.getLogger()
root_logger.setLevel(logging.INFO)
formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
file_handler = logging.FileHandler(LOG_FILE)
file_handler.setFormatter(formatter)
root_logger.addHandler(file_handler)
stream_handler = logging.StreamHandler()
stream_handler.setFormatter(formatter)
root_logger.addHandler(stream_handler)
logger = logging.getLogger(__name__)

# JWT Settings
SECRET_KEY = os.getenv("ENCRYPTION_KEY", "fallback-secret-key")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24

pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")

SQLALCHEMY_DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:////app/storage/vibemind.db") 
engine = create_engine(SQLALCHEMY_DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Migration and Table Creation
try:
    with engine.connect() as conn:
        if "sqlite" not in SQLALCHEMY_DATABASE_URL:
            conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector;"))
        conn.commit()
except Exception as e:
    logger.warning(f"Vector extension error: {e}")

Base.metadata.create_all(bind=engine)

try:
    inspector = inspect(engine)
    if 'notes' in inspector.get_table_names():
        actual_columns = [c['name'] for c in inspector.get_columns('notes')]
        with engine.connect() as conn:
            if 'isPinned' not in actual_columns:
                if 'ispinned' in actual_columns:
                    conn.execute(text('ALTER TABLE notes RENAME COLUMN ispinned TO "isPinned";'))
                    logger.info("Renamed ispinned to isPinned")
                else:
                    conn.execute(text('ALTER TABLE notes ADD COLUMN "isPinned" INTEGER DEFAULT 0;'))
                    logger.info("Added isPinned to notes")
            conn.commit()
except Exception as e:
    logger.warning(f"Migration error: {e}")

app = FastAPI(title="VibeMind Backend")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="api/auth/login")

@app.on_event("startup")
async def startup_event():
    db = SessionLocal()
    try:
        from .bot import start_bot
        configs = db.query(Config).filter(Config.tg_token != None).all()
        for c in configs:
            if c.tg_token:
                user = db.query(User).filter(User.id == c.user_id).first()
                if user:
                    asyncio.create_task(start_bot(c.user_id, user.username, c.tg_token, c.proxy_url, c.proxy_config, c.tg_admin_id))
    except Exception as e:
        logger.error(f"Error starting bots on startup: {e}")
    finally:
        db.close()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

async def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None: raise HTTPException(status_code=401)
    except Exception: raise HTTPException(status_code=401)
    user = db.query(User).filter(User.username == username).first()
    if user is None: raise HTTPException(status_code=401)
    return user

# Models
class UserCreate(BaseModel):
    username: str
    email: EmailStr
    password: str
    role: Optional[str] = "user"

class UserResponse(BaseModel):
    id: int
    username: str
    email: EmailStr | None = None
    role: str
    is_active: bool
    class Config: from_attributes = True

class NoteCreate(BaseModel):
    id: str
    title: str
    content: str | None = None
    folderId: str | None = None
    isPinned: bool | None = False

class NoteUpdate(BaseModel):
    title: str | None = None
    content: str | None = None
    folderId: str | None = None
    isPinned: bool | None = None

class FolderCreate(BaseModel):
    id: str
    name: str
    parentId: str | None = None

class FolderUpdate(BaseModel):
    name: str | None = None
    parentId: str | None = None

class ShareCreate(BaseModel):
    target_username: str | None = None
    permission: str
    is_public: int = 0

class ShareResponse(BaseModel):
    id: str
    resource_id: str
    resource_type: str
    owner_id: int
    target_username: str | None = None
    permission: str
    is_public: int

# Auth Endpoints
@app.post("/api/auth/login")
async def login(req: dict, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == req.get("username")).first()
    if not user or not pwd_context.verify(req.get("password"), user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    token = jwt.encode({"sub": user.username, "exp": expire}, SECRET_KEY, algorithm=ALGORITHM)
    return {"access_token": token, "token_type": "bearer"}

@app.get("/api/users/me", response_model=UserResponse)
async def get_me(current_user: User = Depends(get_current_user)):
    return current_user

# Note Endpoints
@app.get("/api/notes")
async def get_notes(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    notes = db.query(Note).filter(Note.user_id == current_user.id).all()
    shared = db.query(Share).filter(Share.target_user_id == current_user.id, Share.resource_type == "note").all()
    for s in shared:
        n = db.query(Note).filter(Note.id == s.resource_id).first()
        if n and n not in notes: notes.append(n)
    
    res = []
    for n in notes:
        is_shared = n.user_id != current_user.id
        owner_name = None
        permission = "owner"
        if is_shared:
            owner = db.query(User).filter(User.id == n.user_id).first()
            owner_name = owner.username if owner else "Unknown"
            s = db.query(Share).filter(Share.resource_id == n.id, Share.target_user_id == current_user.id).first()
            if s: permission = s.permission
        res.append({
            "id": n.id, "title": n.title, "content": n.content, "folderId": n.folderId,
            "isPinned": bool(n.isPinned), "isShared": is_shared, "ownerUsername": owner_name, "permission": permission
        })
    return res

@app.post("/api/notes")
async def create_note(note: NoteCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    from .utils.embeddings import embedding_manager
    vector = embedding_manager.get_vector(f"{note.title}\n{note.content or ''}")
    db_note = db.query(Note).filter(Note.id == note.id).first()
    if db_note:
        if db_note.user_id != current_user.id:
            s = db.query(Share).filter(Share.resource_id == note.id, Share.target_user_id == current_user.id, Share.permission == "write").first()
            if not s: raise HTTPException(status_code=403)
        db_note.title = note.title
        db_note.content = note.content
        db_note.folderId = note.folderId
        db_note.isPinned = 1 if note.isPinned else 0
        db_note.embedding = vector
    else:
        db_note = Note(id=note.id, title=note.title, content=note.content, folderId=note.folderId, user_id=current_user.id, isPinned=1 if note.isPinned else 0, embedding=vector)
        db.add(db_note)
    db.commit()
    return note

@app.post("/api/notes/import")
async def import_notes(file: UploadFile = File(...), db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    import io, zipfile
    content = await file.read()
    count = 0
    if file.filename.endswith('.zip'):
        with zipfile.ZipFile(io.BytesIO(content)) as z:
            for name in z.namelist():
                if name.endswith(('.md', '.txt')):
                    text = z.read(name).decode('utf-8')
                    title = name.rsplit('.', 1)[0]
                    db.add(Note(id=str(uuid.uuid4()), title=title, content=text, user_id=current_user.id))
                    count += 1
    db.commit()
    return {"status": "success", "count": count}

@app.get("/api/notes/search")
async def search(query: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    notes = db.query(Note).filter(Note.user_id == current_user.id, or_(Note.title.ilike(f"%{query}%"), Note.content.ilike(f"%{query}%"))).limit(10).all()
    return [{"id": n.id, "title": n.title, "content": n.content} for n in notes]

@app.get("/api/notes/semantic-search")
async def semantic_search(query: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    from .utils.embeddings import embedding_manager
    v = embedding_manager.get_vector(query)
    res = db.query(Note, Note.embedding.cosine_distance(v).label("d")).filter(Note.user_id == current_user.id, Note.embedding.is_not(None)).order_by("d").limit(5).all()
    return [{"id": n.Note.id, "title": n.Note.title, "content": n.Note.content, "distance": float(n.d)} for n in res]

@app.post("/api/notes/reindex")
async def reindex_notes(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    from .utils.embeddings import embedding_manager
    notes = db.query(Note).filter(Note.user_id == current_user.id).all()
    for n in notes:
        n.embedding = embedding_manager.get_vector(f"{n.title}\n{n.content or ''}")
    db.commit()
    return {"status": "success"}

@app.get("/api/notes/{note_id}")
async def get_note(note_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    n = db.query(Note).filter(Note.id == note_id).first()
    if not n: raise HTTPException(status_code=404)
    if n.user_id != current_user.id:
        s = db.query(Share).filter(Share.resource_id == note_id, Share.target_user_id == current_user.id).first()
        if not s: raise HTTPException(status_code=403)
    
    is_shared = n.user_id != current_user.id
    owner_name = None
    if is_shared:
        owner = db.query(User).filter(User.id == n.user_id).first()
        owner_name = owner.username if owner else "Unknown"
        
    return {
        "id": n.id, "title": n.title, "content": n.content, "folderId": n.folderId,
        "isPinned": bool(n.isPinned), "isShared": is_shared, "ownerUsername": owner_name
    }

@app.get("/api/notes/export")
async def export_notes(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    import io, zipfile
    notes = db.query(Note).filter(Note.user_id == current_user.id).all()
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "a", zipfile.ZIP_DEFLATED, False) as z:
        for n in notes:
            safe_title = "".join([c for c in n.title if c.isalnum() or c==' ']).strip() or f"note_{n.id}"
            z.writestr(f"{safe_title}.md", f"# {n.title}\n\n{n.content or ''}")
    buf.seek(0)
    from fastapi.responses import Response
    return Response(content=buf.getvalue(), media_type="application/x-zip-compressed", headers={"Content-Disposition": f"attachment; filename=notes_export.zip"})

@app.patch("/api/notes/{note_id}")
async def patch_note(note_id: str, update: NoteUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    from .utils.embeddings import embedding_manager
    n = db.query(Note).filter(Note.id == note_id).first()
    if not n: raise HTTPException(status_code=404)
    if n.user_id != current_user.id:
        s = db.query(Share).filter(Share.resource_id == note_id, Share.target_user_id == current_user.id, Share.permission == "write").first()
        if not s: raise HTTPException(status_code=403)
    
    if update.title is not None: n.title = update.title
    if update.content is not None: n.content = update.content
    if update.folderId is not None: n.folderId = update.folderId if update.folderId else None
    if update.isPinned is not None: n.isPinned = 1 if update.isPinned else 0
    
    if update.title is not None or update.content is not None:
        n.embedding = embedding_manager.get_vector(f"{n.title}\n{n.content or ''}")
    db.commit()
    return {"status": "success"}

@app.delete("/api/notes/{note_id}")
async def delete_note(note_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    n = db.query(Note).filter(Note.id == note_id, Note.user_id == current_user.id).first()
    if not n: raise HTTPException(status_code=404)
    db.delete(n)
    db.commit()
    return {"status": "success"}

@app.get("/api/users", response_model=List[UserResponse])
async def get_users(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Not authorized")
    return db.query(User).all()

@app.post("/api/users", response_model=UserResponse)
async def create_user(user: UserCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Not authorized")
    db_user = User(
        username=user.username,
        email=user.email,
        hashed_password=pwd_context.hash(user.password),
        role=user.role or "user"
    )
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    return db_user

@app.patch("/api/users/{user_id}", response_model=UserResponse)
async def update_user(user_id: int, update: dict, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Not authorized")
    db_user = db.query(User).filter(User.id == user_id).first()
    if not db_user: raise HTTPException(status_code=404)
    for k, v in update.items():
        if k == "password" and v:
            db_user.hashed_password = pwd_context.hash(v)
        elif hasattr(db_user, k):
            setattr(db_user, k, v)
    db.commit()
    db.refresh(db_user)
    return db_user

@app.delete("/api/users/{user_id}")
async def delete_user(user_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Not authorized")
    db_user = db.query(User).filter(User.id == user_id).first()
    if not db_user: raise HTTPException(status_code=404)
    db.delete(db_user)
    db.commit()
    return {"status": "success"}

# Folder Endpoints
@app.get("/api/folders")
async def get_folders(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    folders = db.query(Folder).filter(Folder.user_id == current_user.id).all()
    return [{"id": f.id, "name": f.name, "parentId": f.parentId} for f in folders]

@app.post("/api/folders")
async def create_folder(f: FolderCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    db_f = Folder(id=f.id, name=f.name, parentId=f.parentId, user_id=current_user.id)
    db.add(db_f)
    db.commit()
    return f

@app.patch("/api/folders/{id}")
async def patch_folder(id: str, u: FolderUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    f = db.query(Folder).filter(Folder.id == id, Folder.user_id == current_user.id).first()
    if not f: raise HTTPException(status_code=404)
    if u.name is not None: f.name = u.name
    if u.parentId is not None: f.parentId = u.parentId if u.parentId else None
    db.commit()
    return {"status": "success"}

@app.delete("/api/folders/{id}")
async def delete_folder(id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    f = db.query(Folder).filter(Folder.id == id, Folder.user_id == current_user.id).first()
    if not f: raise HTTPException(status_code=404)
    db.delete(f)
    db.commit()
    return {"status": "success"}

# Sharing Endpoints
@app.get("/api/shares")
async def get_shares(resource_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    shares = db.query(Share).filter(Share.resource_id == resource_id, Share.owner_id == current_user.id).all()
    res = []
    for s in shares:
        target_username = None
        if s.target_user_id:
            u = db.query(User).filter(User.id == s.target_user_id).first()
            target_username = u.username if u else "Unknown"
        res.append({
            "id": s.id, "resource_id": s.resource_id, "resource_type": s.resource_type,
            "target_username": target_username, "permission": s.permission, "is_public": s.is_public
        })
    return res

@app.post("/api/shares")
async def create_share(s: ShareCreate, resource_id: str, resource_type: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    target_user_id = None
    if s.target_username:
        u = db.query(User).filter(User.username == s.target_username).first()
        if not u: raise HTTPException(status_code=404, detail="User not found")
        target_user_id = u.id
    
    share_id = str(uuid.uuid4())
    db_share = Share(id=share_id, resource_id=resource_id, resource_type=resource_type, owner_id=current_user.id, target_user_id=target_user_id, permission=s.permission, is_public=s.is_public)
    db.add(db_share)
    db.commit()
    return {"id": share_id}

@app.delete("/api/shares/{share_id}")
async def delete_share(share_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    s = db.query(Share).filter(Share.id == share_id, Share.owner_id == current_user.id).first()
    if not s: raise HTTPException(status_code=404)
    db.delete(s)
    db.commit()
    return {"status": "success"}

# Settings & Bot
@app.get("/api/settings")
async def get_settings(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    c = db.query(Config).filter(Config.user_id == current_user.id).first()
    if not c: return {}
    return {"tg_token": c.tg_token, "tg_admin_id": c.tg_admin_id, "llm_provider": c.llm_provider, "api_key": c.api_key, "proxy_url": c.proxy_url, "base_url": c.base_url, "model_name": c.model_name, "proxy_config": c.proxy_config}

@app.post("/api/settings")
async def update_settings(s: dict, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    c = db.query(Config).filter(Config.user_id == current_user.id).first()
    if not c:
        c = Config(user_id=current_user.id)
        db.add(c)
    for k, v in s.items():
        if hasattr(c, k): setattr(c, k, v)
    db.commit()
    if c.tg_token:
        asyncio.create_task(restart_bot(current_user.id, current_user.username, c.tg_token, c.proxy_url, c.proxy_config, c.tg_admin_id))
    return {"status": "success"}

@app.get("/api/bot/status")
async def bot_status(current_user: User = Depends(get_current_user)):
    from .bot import current_bots
    is_running = current_user.id in current_bots
    return {"status": "running" if is_running else "stopped"}

@app.post("/api/bot/test")
async def test_bot(req: dict, current_user: User = Depends(get_current_user)):
    from .bot import test_bot_connection
    success, message = await test_bot_connection(
        token=req.get("tg_token"),
        admin_id=req.get("tg_admin_id"),
        proxy_url=req.get("proxy_url"),
        proxy_config=req.get("proxy_config")
    )
    return {"success": success, "message": message}

@app.post("/api/integrations/test")
async def test_integration(data: dict, current_user: User = Depends(get_current_user)):
    provider = data.get("provider")
    api_key = data.get("api_key")
    base_url = data.get("base_url")
    model_name = data.get("model_name")
    
    if not provider or not api_key:
        raise HTTPException(status_code=400, detail="Provider and API Key are required")
        
    try:
        if provider == "openai" or provider == "openrouter" or provider == "ollama":
            async with httpx.AsyncClient() as client:
                headers = {"Authorization": f"Bearer {api_key}"}
                # Simple models list or completion test
                test_url = f"{base_url}/models" if provider != "ollama" else f"{base_url}/tags"
                resp = await client.get(test_url, headers=headers, timeout=10.0)
                if resp.status_code == 200:
                    return {"status": "success", "message": "Connection successful"}
                else:
                    return {"status": "error", "message": f"Provider returned {resp.status_code}: {resp.text}"}
        
        elif provider == "gemini":
            # For Gemini we can try a simple generative model check
            from google.generativeai import configure, GenerativeModel
            configure(api_key=api_key)
            model = GenerativeModel(model_name or 'gemini-1.5-flash')
            # Just check if we can initialize (actual request might be better but costs quota)
            return {"status": "success", "message": "Gemini configuration initialized"}
            
        return {"status": "error", "message": "Unsupported provider"}
    except Exception as e:
        logger.error(f"Integration test failed: {str(e)}")
        return {"status": "error", "message": str(e)}

@app.get("/api/logs")
async def get_logs(current_user: User = Depends(get_current_user)):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Not authorized")
    try:
        exists = os.path.exists(LOG_FILE)
        size = os.path.getsize(LOG_FILE) if exists else 0
        if exists:
            with open(LOG_FILE, "r") as f:
                # Return last 200 lines
                lines = f.readlines()
                return {
                    "logs": "".join(lines[-200:]),
                    "debug": {
                        "path": LOG_FILE,
                        "exists": exists,
                        "size": size,
                        "cwd": os.getcwd()
                    }
                }
        return {
            "logs": f"Log file not found at {LOG_FILE}",
            "debug": {
                "path": LOG_FILE,
                "exists": exists,
                "cwd": os.getcwd()
            }
        }
    except Exception as e:
        return {"logs": f"Error reading logs: {str(e)}"}

@app.get("/api/external-db")
async def get_external_dbs(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    config = db.query(Config).filter(Config.user_id == current_user.id).first()
    if not config or not config.external_dbs:
        return {"dbs": []}
    return {"dbs": config.external_dbs}

@app.post("/api/external-db")
async def add_external_db(db_data: dict, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    config = db.query(Config).filter(Config.user_id == current_user.id).first()
    if not config:
        config = Config(user_id=current_user.id)
        db.add(config)
    
    dbs = config.external_dbs or []
    # Add unique ID to new DB
    db_data['id'] = str(uuid.uuid4())
    dbs.append(db_data)
    config.external_dbs = dbs
    db.commit()
    return {"status": "success", "dbs": dbs}

@app.delete("/api/external-db/{db_id}")
async def delete_external_db(db_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    config = db.query(Config).filter(Config.user_id == current_user.id).first()
    if not config or not config.external_dbs:
        raise HTTPException(status_code=404)
    
    dbs = [d for d in config.external_dbs if d.get('id') != db_id]
    config.external_dbs = dbs
    db.commit()
    return {"status": "success", "dbs": dbs}

@app.post("/api/upload")
async def upload(file: UploadFile = File(...), current_user: User = Depends(get_current_user)):
    fname = f"{uuid.uuid4()}{os.path.splitext(file.filename)[1]}"
    path = os.path.join('/app/storage/uploads', fname)
    with open(path, "wb") as b: b.write(await file.read())
    return {"url": f"/api/uploads/{fname}"}

@app.get("/api/uploads/{name}")
async def get_upload(name: str):
    path = os.path.join('/app/storage/uploads', name)
    if os.path.exists(path): return FileResponse(path)
    raise HTTPException(status_code=404)

# Chat
@app.post("/api/chat")
async def chat(req: dict, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    from .bot import parse_commands_llm
    from .utils.embeddings import embedding_manager
    
    msg = req.get("message", "")
    if not msg:
        raise HTTPException(status_code=400, detail="Message is required")
        
    # 1. Get all user notes for context (titles only for parsing efficiency)
    all_notes = db.query(Note).filter(Note.user_id == current_user.id).all()
    notes_context = [{"id": n.id, "title": n.title} for n in all_notes]
    
    # 2. Parse intent using the same logic as the bot
    commands = await parse_commands_llm(current_user.id, msg, notes_context)
    
    results = []
    answer = ""
    citations = []
    
    if commands:
        for cmd in commands:
            cmd_type = cmd.get("type")
            
            if cmd_type == "CREATE":
                new_note = Note(
                    title=cmd.get("title", "New Note"),
                    content=cmd.get("content", ""),
                    user_id=current_user.id,
                    embedding=embedding_manager.get_vector(f"{cmd.get('title')} {cmd.get('content')}")
                )
                db.add(new_note)
                db.commit()
                db.refresh(new_note)
                answer += f"✅ Создана заметка: **{new_note.title}**\n"
                citations.append({"id": new_note.id, "title": new_note.title})
                
            elif cmd_type == "UPDATE":
                note_id = cmd.get("note_id")
                note = db.query(Note).filter(Note.id == note_id, Note.user_id == current_user.id).first()
                if note:
                    append_text = cmd.get("append", "")
                    note.content = (note.content or "") + "\n" + append_text
                    note.embedding = embedding_manager.get_vector(f"{note.title} {note.content}")
                    db.commit()
                    answer += f"📝 Обновлена заметка: **{note.title}**\n"
                    citations.append({"id": note.id, "title": note.title})
                else:
                    answer += "❌ Заметка для обновления не найдена.\n"
                    
            elif cmd_type == "SEARCH":
                query = cmd.get("query", msg)
                v = embedding_manager.get_vector(query)
                found_notes = db.query(Note).filter(Note.user_id == current_user.id, Note.embedding.is_not(None)).order_by(Note.embedding.cosine_distance(v)).limit(5).all()
                if found_notes:
                    answer += f"🔍 Нашел релевантные заметки по запросу '{query}':\n"
                    for n in found_notes:
                        answer += f"* **{n.title}**: {n.content[:100]}...\n"
                        citations.append({"id": n.id, "title": n.title})
                else:
                    answer += "🤷‍♂️ Ничего не нашел по вашему запросу.\n"
    
    # 3. If no specific command was identified or we want a conversational response
    if not answer:
        # Fallback to RAG (Question Answering)
        v = embedding_manager.get_vector(msg)
        found_notes = db.query(Note).filter(Note.user_id == current_user.id, Note.embedding.is_not(None)).order_by(Note.embedding.cosine_distance(v)).limit(5).all()
        context = "\n\n---\n\n".join([f"Title: {n.title}\nContent: {n.content}" for n in found_notes])
        
        config = db.query(Config).first()
        provider = config.llm_provider if config else "openai"
        api_key = config.api_key if config else os.getenv("GEMINI_API_KEY")
        model_name = config.model_name or "gpt-4o-mini"
        
        system_prompt = "You are VibeMind AI. Answer based on the notes context. Be conversational and helpful."
        user_content = f"Context:\n{context}\n\nQuestion: {msg}"
        
        try:
            # Re-using the logic for LLM call (simplified for this edit)
            if provider == "gemini":
                url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={api_key}"
                async with httpx.AsyncClient() as session:
                    payload = {"contents": [{"parts": [{"text": f"{system_prompt}\n\n{user_content}"}]}]}
                    resp = await session.post(url, json=payload, timeout=30)
                    if resp.status_code == 200:
                        answer = resp.json()['candidates'][0]['content']['parts'][0]['text']
            else:
                client = AsyncOpenAI(api_key=api_key, base_url=config.base_url if config else None)
                response = await client.chat.completions.create(
                    model=model_name,
                    messages=[{"role": "system", "content": system_prompt}, {"role": "user", "content": user_content}]
                )
                answer = response.choices[0].message.content.strip()
            
            citations = [{"id": n.id, "title": n.title} for n in found_notes]
        except Exception as e:
            answer = f"Я нашел эти заметки, но не смог сгенерировать ответ: {str(e)}"
            citations = [{"id": n.id, "title": n.title} for n in found_notes]

    return {"answer": answer, "citations": citations}

# Static files and SPA fallback
STATIC_DIR = "/app/static"
if not os.path.exists(STATIC_DIR):
    STATIC_DIR = os.path.join(os.getcwd(), "dist")

if os.path.exists(STATIC_DIR):
    assets_dir = os.path.join(STATIC_DIR, "assets")
    if os.path.exists(assets_dir):
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")
    
    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        # If it's an API call that wasn't caught, let it 404
        if full_path.startswith("api/"):
            raise HTTPException(status_code=404)
            
        # Check if requested file exists in static dir
        file_path = os.path.join(STATIC_DIR, full_path)
        if os.path.isfile(file_path):
            return FileResponse(file_path)
            
        # Otherwise serve index.html for SPA routing
        index_path = os.path.join(STATIC_DIR, "index.html")
        if os.path.exists(index_path):
            return FileResponse(index_path)
        
        raise HTTPException(status_code=404)
else:
    logger.warning(f"Static directory not found. Frontend will not be served.")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=3344)
