from fastapi import FastAPI, Depends, HTTPException, status, File, UploadFile, BackgroundTasks
from fastapi.security import OAuth2PasswordBearer
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
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
SQL_ARGS = {"check_same_thread": False} if "sqlite" in SQLALCHEMY_DATABASE_URL else {}
engine = create_engine(
    SQLALCHEMY_DATABASE_URL, 
    connect_args=SQL_ARGS,
    pool_size=20,
    max_overflow=10
)
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
            if 'updated_at' not in actual_columns:
                conn.execute(text('ALTER TABLE notes ADD COLUMN updated_at TEXT;'))
                logger.info("Added updated_at to notes")
            conn.commit()
    if 'folders' in inspector.get_table_names():
        actual_columns = [c['name'] for c in inspector.get_columns('folders')]
        with engine.connect() as conn:
            if 'updated_at' not in actual_columns:
                conn.execute(text('ALTER TABLE folders ADD COLUMN updated_at TEXT;'))
                logger.info("Added updated_at to folders")
            if 'password_hash' not in actual_columns:
                conn.execute(text('ALTER TABLE folders ADD COLUMN password_hash TEXT;'))
                logger.info("Added password_hash to folders")
            conn.commit()
except Exception as e:
    logger.warning(f"Migration error: {e}")

app = FastAPI(title="VibeMind Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="api/auth/login")

starting_up = False

@app.on_event("startup")
async def startup_event():
    global starting_up
    if starting_up:
        return
    starting_up = True
    
    # Файловая блокировка для предотвращения запуска ботов несколькими воркерами uvicorn
    lock_file = "/tmp/vibemind_bot_startup.lock"
    try:
        # Проверяем, не запускал ли уже другой процесс ботов недавно (в пределах 30 секунд)
        if os.path.exists(lock_file):
            mtime = os.path.getmtime(lock_file)
            if datetime.now().timestamp() - mtime < 30:
                logger.info("Bot startup already handled by another worker, skipping.")
                return
        
        # Создаем/обновляем файл блокировки
        with open(lock_file, "w") as f:
            f.write(str(os.getpid()))
            
        db = SessionLocal()
        try:
            # Create default admin if no users exist
            if db.query(User).count() == 0:
                admin_user = User(
                    username="admin",
                    email="admin@example.com",
                    hashed_password=pwd_context.hash("admin"),
                    role="admin"
                )
                db.add(admin_user)
                db.commit()
                logger.info("Default admin user created: admin/admin")

            configs = db.query(Config).filter(Config.tg_token != None).all()
            seen_tokens = set()
            for c in configs:
                if not c.tg_token:
                    continue
                
                if c.tg_token in seen_tokens:
                    logger.warning(f"Duplicate token found for user {c.user_id}, skipping startup for this instance.")
                    continue
                
                seen_tokens.add(c.tg_token)
                user = db.query(User).filter(User.id == c.user_id).first()
                if user:
                    logger.info(f"Starting bot for user {user.username} (ID: {c.user_id})")
                    await restart_bot(c.user_id, user.username, c.tg_token, c.proxy_url, c.proxy_config, c.tg_admin_id)
        except Exception as e:
            logger.error(f"Error starting bots on startup: {e}")
        finally:
            db.close()
    except Exception as e:
        logger.error(f"Error in startup lock logic: {e}")
    finally:
        starting_up = False

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
    updated_at: str | None = None

class NoteUpdate(BaseModel):
    id: str | None = None
    title: str | None = None
    content: str | None = None
    folderId: str | None = None
    isPinned: bool | None = None
    updated_at: str | None = None

class FolderCreate(BaseModel):
    id: str
    name: str
    parentId: str | None = None
    updated_at: str | None = None
    password: str | None = None

class FolderUpdate(BaseModel):
    name: str | None = None
    parentId: str | None = None
    updated_at: str | None = None
    password: str | None = None

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
    # Get all folders for the current user
    user_folders = {f.id for f in db.query(Folder).filter(Folder.user_id == current_user.id).all()}
    
    # Notes owned by user
    notes = db.query(Note).filter(Note.user_id == current_user.id).all()
    
    # Clean up orphaned notes (whose folderId refers to a deleted folder)
    valid_notes = []
    orphaned_notes = []
    for n in notes:
        if n.folderId and n.folderId not in user_folders:
            # Check if it might be from an old bug where folder doesn't exist
            if not db.query(Folder).filter(Folder.id == n.folderId).first():
                orphaned_notes.append(n)
                continue
        valid_notes.append(n)
        
    if orphaned_notes:
        for n in orphaned_notes:
            db.delete(n)
        db.commit()
    
    notes = valid_notes
    
    # Notes shared directly with user
    shared_notes = db.query(Share).filter(Share.target_user_id == current_user.id, Share.resource_type == "note").all()
    for s in shared_notes:
        n = db.query(Note).filter(Note.id == s.resource_id).first()
        if n and n not in notes: notes.append(n)
        
    # Notes in folders shared with user
    shared_folders = db.query(Share).filter(Share.target_user_id == current_user.id, Share.resource_type == "folder").all()
    for s in shared_folders:
        folder_notes = db.query(Note).filter(Note.folderId == s.resource_id).all()
        for n in folder_notes:
            if n not in notes: notes.append(n)
    
    res = []
    for n in notes:
        is_shared = n.user_id != current_user.id
        owner_name = None
        permission = "owner"
        if is_shared:
            owner = db.query(User).filter(User.id == n.user_id).first()
            owner_name = owner.username if owner else "Unknown"
            # Check direct share
            s = db.query(Share).filter(Share.resource_id == n.id, Share.target_user_id == current_user.id).first()
            if s: 
                permission = s.permission
            else:
                # Check folder share
                if n.folderId:
                    fs = db.query(Share).filter(Share.resource_id == n.folderId, Share.target_user_id == current_user.id).first()
                    if fs: permission = fs.permission
        
        # Check if shared by me
        is_shared_by_me = False
        if not is_shared:
            share_count = db.query(Share).filter(Share.resource_id == n.id, Share.owner_id == current_user.id).count()
            is_shared_by_me = share_count > 0
            # Also check if parent folder is shared by me
            if not is_shared_by_me and n.folderId:
                folder_share_count = db.query(Share).filter(Share.resource_id == n.folderId, Share.owner_id == current_user.id).count()
                is_shared_by_me = folder_share_count > 0

        res.append({
            "id": n.id, "title": n.title, "content": n.content, "folderId": n.folderId,
            "isPinned": bool(n.isPinned), "isShared": is_shared, "ownerUsername": owner_name, 
            "permission": permission, "isSharedByMe": is_shared_by_me,
            "updated_at": n.updated_at
        })
    return res

@app.post("/api/notes")
async def create_note(note: NoteCreate, background_tasks: BackgroundTasks, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    db_note = db.query(Note).filter(Note.id == note.id).first()
    if db_note:
        if db_note.user_id != current_user.id:
            # Check direct share
            s = db.query(Share).filter(Share.resource_id == note.id, Share.target_user_id == current_user.id, Share.permission == "write").first()
            if not s:
                # Check folder share
                if db_note.folderId:
                    fs = db.query(Share).filter(Share.resource_id == db_note.folderId, Share.target_user_id == current_user.id, Share.permission == "write").first()
                    if not fs: raise HTTPException(status_code=403)
                else:
                    raise HTTPException(status_code=403)
        db_note.title = note.title
        db_note.content = note.content
        db_note.folderId = note.folderId
        db_note.isPinned = 1 if note.isPinned else 0
        db_note.updated_at = note.updated_at or datetime.utcnow().isoformat()
    else:
        db_note = Note(
            id=note.id, 
            title=note.title, 
            content=note.content, 
            folderId=note.folderId, 
            user_id=current_user.id, 
            isPinned=1 if note.isPinned else 0,
            updated_at=note.updated_at or datetime.utcnow().isoformat()
        )
        db.add(db_note)
    db.commit()
    
    background_tasks.add_task(update_note_embedding, note.id, f"{note.title}\n{note.content or ''}")
    
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
    notes = db.query(Note).filter(Note.user_id == current_user.id, or_(Note.title.ilike(f"%{query}%"), Note.content.ilike(f"%{query}%"))).limit(20).all()
    res = []
    for n in notes:
        is_protected = False
        if n.folderId:
            f = db.query(Folder).filter(Folder.id == n.folderId).first()
            if f and f.password_hash: is_protected = True
        res.append({"id": n.id, "title": n.title, "content": n.content, "folderId": n.folderId, "folderIsProtected": is_protected})
    return res

@app.get("/api/distances")
async def get_distances(query: str, db: Session = Depends(get_db)):
    from .utils.embeddings import embedding_manager
    v = embedding_manager.get_vector(query)
    notes_with_dist = db.query(Note, Note.embedding.cosine_distance(v).label("d")).filter(Note.embedding.is_not(None)).order_by("d").limit(10).all()
    res = []
    for n, dist in notes_with_dist:
        res.append({"title": n.title, "content": n.content[:50] if n.content else "", "distance": float(dist)})
    return res

@app.get("/api/notes/semantic-search")
async def semantic_search(query: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    from .utils.embeddings import embedding_manager
    v = embedding_manager.get_vector(query)
    
    # Log all distances for debugging
    all_notes = db.query(Note, Note.embedding.cosine_distance(v).label("d")).filter(Note.user_id == current_user.id, Note.embedding.is_not(None)).order_by("d").limit(15).all()

    if not all_notes:
        return []

    res = []
    best_dist = float(all_notes[0].d)
    
    for n, dist in all_notes:
        d = float(dist)
        
        # Absolute ceiling: never return completely unrelated nodes
        if d > 0.46:
            continue
            
        # Dynamic ceiling: tight relative clamping to drop junk
        if d > 0.38 and d > best_dist + 0.05:
            continue
            
        is_protected = False
        if n.folderId:
            f = db.query(Folder).filter(Folder.id == n.folderId).first()
            if f and f.password_hash: is_protected = True
        res.append({"id": n.id, "title": n.title, "content": n.content, "distance": d, "folderId": n.folderId, "folderIsProtected": is_protected})
    return res

@app.post("/api/notes/reindex")
async def reindex_notes(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    from .utils.embeddings import embedding_manager
    notes = db.query(Note).filter(Note.user_id == current_user.id).all()
    for n in notes:
        n.embedding = embedding_manager.get_vector(f"{n.title}\n{n.content or ''}")
    db.commit()
    return {"status": "success"}

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
    
    # Check if folder is protected
    folder_is_protected = False
    if n.folderId:
        f = db.query(Folder).filter(Folder.id == n.folderId).first()
        if f and f.password_hash:
            folder_is_protected = True
        
    return {
        "id": n.id, "title": n.title, "content": n.content, "folderId": n.folderId,
        "isPinned": bool(n.isPinned), "isShared": is_shared, "ownerUsername": owner_name,
        "folderIsProtected": folder_is_protected
    }

@app.patch("/api/notes/{note_id}")
async def patch_note(note_id: str, update: NoteUpdate, background_tasks: BackgroundTasks, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    n = db.query(Note).filter(Note.id == note_id).first()
    if not n: raise HTTPException(status_code=404)
    if n.user_id != current_user.id:
        # Check direct share
        s = db.query(Share).filter(Share.resource_id == note_id, Share.target_user_id == current_user.id, Share.permission == "write").first()
        if not s:
            # Check folder share
            if n.folderId:
                fs = db.query(Share).filter(Share.resource_id == n.folderId, Share.target_user_id == current_user.id, Share.permission == "write").first()
                if not fs: raise HTTPException(status_code=403)
            else:
                raise HTTPException(status_code=403)
    
    if update.title is not None: n.title = update.title
    if update.content is not None: n.content = update.content
    if update.folderId is not None: n.folderId = update.folderId if update.folderId else None
    if update.isPinned is not None: n.isPinned = 1 if update.isPinned else 0
    n.updated_at = update.updated_at or datetime.utcnow().isoformat()
    
    db.commit()

    if update.title is not None or update.content is not None:
        background_tasks.add_task(update_note_embedding, note_id, f"{n.title}\n{n.content or ''}")
    
    return {"status": "success"}

def update_note_embedding(note_id: str, text: str):
    from .utils.embeddings import embedding_manager
    db = SessionLocal()
    try:
        n = db.query(Note).filter(Note.id == note_id).first()
        if n:
            n.embedding = embedding_manager.get_vector(text)
            db.commit()
    finally:
        db.close()

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
    if current_user.role != "admin" and current_user.id != user_id:
        raise HTTPException(status_code=403, detail="Not authorized")
    db_user = db.query(User).filter(User.id == user_id).first()
    if not db_user: raise HTTPException(status_code=404)
    for k, v in update.items():
        if k == "role" and current_user.role != "admin":
            continue # Only admins can change roles
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
    
    # Shared folders
    shared = db.query(Share).filter(Share.target_user_id == current_user.id, Share.resource_type == "folder").all()
    for s in shared:
        f = db.query(Folder).filter(Folder.id == s.resource_id).first()
        if f and f not in folders: folders.append(f)
        
    res = []
    for f in folders:
        is_shared = f.user_id != current_user.id
        owner_name = None
        permission = "owner"
        if is_shared:
            owner = db.query(User).filter(User.id == f.user_id).first()
            owner_name = owner.username if owner else "Unknown"
            s = db.query(Share).filter(Share.resource_id == f.id, Share.target_user_id == current_user.id).first()
            if s: permission = s.permission
        
        # Check if shared by me
        is_shared_by_me = False
        if not is_shared:
            share_count = db.query(Share).filter(Share.resource_id == f.id, Share.owner_id == current_user.id).count()
            is_shared_by_me = share_count > 0

        res.append({
            "id": f.id, "name": f.name, "parentId": f.parentId,
            "isShared": is_shared, "ownerUsername": owner_name, 
            "permission": permission, "isSharedByMe": is_shared_by_me,
            "isProtected": f.password_hash is not None,
            "updated_at": f.updated_at
        })
    return res

@app.post("/api/folders")
async def create_folder(f: FolderCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    # Check if folder already exists (to avoid IntegrityError on duplicate ID)
    existing = db.query(Folder).filter(Folder.id == f.id).first()
    if existing:
        if existing.user_id == current_user.id:
            existing.name = f.name
            existing.parentId = f.parentId
            existing.updated_at = f.updated_at or datetime.utcnow().isoformat()
            db.commit()
            return f
        else:
            # ID collision with another user's folder - should be rare with UUIDs but possible with frontend timestamps
            # Generate a new ID if collision
            new_id = f"f{int(datetime.now().timestamp() * 1000)}"
            db_f = Folder(id=new_id, name=f.name, parentId=f.parentId, user_id=current_user.id, updated_at=f.updated_at or datetime.utcnow().isoformat())
            db.add(db_f)
            db.commit()
            f.id = new_id
            return f
            
    db_f = Folder(
        id=f.id, name=f.name, parentId=f.parentId, user_id=current_user.id, 
        updated_at=f.updated_at or datetime.utcnow().isoformat(),
        password_hash=pwd_context.hash(f.password) if f.password else None
    )
    db.add(db_f)
    db.commit()
    return f

@app.patch("/api/folders/{id}")
async def patch_folder(id: str, u: FolderUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    f = db.query(Folder).filter(Folder.id == id, Folder.user_id == current_user.id).first()
    if not f: raise HTTPException(status_code=404)
    if u.name is not None: f.name = u.name
    if u.parentId is not None: f.parentId = u.parentId if u.parentId else None
    if u.password is not None:
        f.password_hash = pwd_context.hash(u.password) if u.password else None
    f.updated_at = u.updated_at or datetime.utcnow().isoformat()
    db.commit()
    return {"status": "success"}

@app.post("/api/folders/{id}/verify")
async def verify_folder_password(id: str, req: dict, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    f = db.query(Folder).filter(Folder.id == id, Folder.user_id == current_user.id).first()
    if not f: raise HTTPException(status_code=404)
    if not f.password_hash: return {"success": True}
    if pwd_context.verify(req.get("password", ""), f.password_hash):
        return {"success": True}
    return {"success": False}

@app.post("/api/folders/verify-by-note/{note_id}")
async def verify_folder_password_by_note(note_id: str, req: dict, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    note = db.query(Note).filter(Note.id == note_id, Note.user_id == current_user.id).first()
    if not note: raise HTTPException(status_code=404)
    if not note.folderId: return {"success": True}
    
    f = db.query(Folder).filter(Folder.id == note.folderId).first()
    if not f or not f.password_hash: return {"success": True}
    
    if pwd_context.verify(req.get("password", ""), f.password_hash):
        return {"success": True}
    return {"success": False}

@app.delete("/api/folders/{id}")
async def delete_folder(id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    f = db.query(Folder).filter(Folder.id == id, Folder.user_id == current_user.id).first()
    if not f: raise HTTPException(status_code=404)
    
    def get_all_child_folders(fid: str):
        children = db.query(Folder).filter(Folder.parentId == fid).all()
        ids = [fid]
        for c in children:
            ids.extend(get_all_child_folders(c.id))
        return ids
    
    all_fids = get_all_child_folders(id)
    
    # Delete all notes in these folders
    db.query(Note).filter(Note.folderId.in_(all_fids)).delete(synchronize_session=False)
    
    # Delete the folders
    db.query(Folder).filter(Folder.id.in_(all_fids)).delete(synchronize_session=False)
    
    db.commit()
    return {"status": "success"}

# Sharing Endpoints
@app.get("/api/shares/{resource_type}/{resource_id}")
async def get_shares(resource_type: str, resource_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    shares = db.query(Share).filter(Share.resource_id == resource_id, Share.resource_type == resource_type, Share.owner_id == current_user.id).all()
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

@app.post("/api/shares/{resource_type}/{resource_id}")
async def create_share(resource_type: str, resource_id: str, s: ShareCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    target_user_id = None
    if s.target_username:
        u = db.query(User).filter(User.username == s.target_username).first()
        if not u: raise HTTPException(status_code=404, detail="User not found")
        target_user_id = u.id
    
    # Check if share already exists
    existing = db.query(Share).filter(
        Share.resource_id == resource_id,
        Share.resource_type == resource_type,
        Share.target_user_id == target_user_id,
        Share.is_public == s.is_public
    ).first()
    
    if existing:
        existing.permission = s.permission
        db.commit()
        return {
            "id": existing.id, 
            "resource_id": existing.resource_id, 
            "resource_type": existing.resource_type,
            "target_username": s.target_username,
            "permission": existing.permission,
            "is_public": existing.is_public
        }

    share_id = str(uuid.uuid4())
    db_share = Share(id=share_id, resource_id=resource_id, resource_type=resource_type, owner_id=current_user.id, target_user_id=target_user_id, permission=s.permission, is_public=s.is_public)
    db.add(db_share)
    
    # Update resource updated_at to trigger sync
    if resource_type == "note":
        note = db.query(Note).filter(Note.id == resource_id).first()
        if note: note.updated_at = datetime.utcnow().isoformat()
    elif resource_type == "folder":
        folder = db.query(Folder).filter(Folder.id == resource_id).first()
        if folder: folder.updated_at = datetime.utcnow().isoformat()
        
    db.commit()
    return {
        "id": share_id, 
        "resource_id": resource_id, 
        "resource_type": resource_type,
        "target_username": s.target_username,
        "permission": s.permission,
        "is_public": s.is_public
    }

@app.delete("/api/shares/{share_id}")
async def delete_share(share_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    s = db.query(Share).filter(Share.id == share_id, Share.owner_id == current_user.id).first()
    if not s: raise HTTPException(status_code=404)
    
    resource_id = s.resource_id
    resource_type = s.resource_type
    
    db.delete(s)
    
    # Update resource updated_at to trigger sync
    if resource_type == "note":
        note = db.query(Note).filter(Note.id == resource_id).first()
        if note: note.updated_at = datetime.utcnow().isoformat()
    elif resource_type == "folder":
        folder = db.query(Folder).filter(Folder.id == resource_id).first()
        if folder: folder.updated_at = datetime.utcnow().isoformat()
        
    db.commit()
    return {"status": "success"}

@app.get("/api/public/shares/{share_id}")
async def get_public_share(share_id: str, db: Session = Depends(get_db)):
    s = db.query(Share).filter(Share.id == share_id, Share.is_public == 1).first()
    if not s: raise HTTPException(status_code=404, detail="Public share not found")
    
    if s.resource_type == "note":
        n = db.query(Note).filter(Note.id == s.resource_id).first()
        if not n: raise HTTPException(status_code=404, detail="Note not found")
        return {
            "share": {
                "id": s.id, "resource_id": s.resource_id, "resource_type": s.resource_type,
                "permission": s.permission, "is_public": s.is_public
            },
            "note": {
                "id": n.id, "title": n.title, "content": n.content, "folderId": n.folderId
            }
        }
    
    if s.resource_type == "folder":
        f = db.query(Folder).filter(Folder.id == s.resource_id).first()
        if not f: raise HTTPException(status_code=404, detail="Folder not found")
        
        # Get all notes in this folder
        notes = db.query(Note).filter(Note.folderId == f.id).all()
        
        return {
            "share": {
                "id": s.id, "resource_id": s.resource_id, "resource_type": s.resource_type,
                "permission": s.permission, "is_public": s.is_public
            },
            "folder": {
                "id": f.id, "name": f.name, "parentId": f.parentId
            },
            "notes": [
                {"id": n.id, "title": n.title, "content": n.content, "folderId": n.folderId}
                for n in notes
            ]
        }
    
    return {"error": "Unsupported resource type"}

@app.patch("/api/public/shares/{share_id}")
async def update_public_share(share_id: str, update: NoteUpdate, db: Session = Depends(get_db)):
    s = db.query(Share).filter(Share.id == share_id, Share.is_public == 1, Share.permission == "write").first()
    if not s: raise HTTPException(status_code=403, detail="No write access to this public share")
    
    if s.resource_type == "note":
        n = db.query(Note).filter(Note.id == s.resource_id).first()
        if not n: raise HTTPException(status_code=404)
        if update.title is not None: n.title = update.title
        if update.content is not None: n.content = update.content
        db.commit()
        return {"status": "success"}
    
    if s.resource_type == "folder":
        if not update.id:
            raise HTTPException(status_code=400, detail="Note ID is required for folder share updates")
        
        # Verify note belongs to the shared folder
        n = db.query(Note).filter(Note.id == update.id, Note.folderId == s.resource_id).first()
        if not n: raise HTTPException(status_code=404, detail="Note not found in this shared folder")
        
        if update.title is not None: n.title = update.title
        if update.content is not None: n.content = update.content
        db.commit()
        return {"status": "success"}
        
    return {"error": "Unsupported resource type for update"}

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
    bot = current_bots.get(current_user.id)
    if bot:
        try:
            me = await bot.get_me()
            return {
                "status": "connected",
                "username": me.username,
                "first_name": me.first_name
            }
        except Exception as e:
            logger.error(f"Error getting bot info: {e}")
            return {"status": "connected", "username": "Unknown"}
    return {"status": "disconnected"}

@app.get("/api/admin/bots")
async def admin_bots(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Not authorized")
    
    from .bot import current_bots
    users = db.query(User).all()
    configs = db.query(Config).all()
    config_dict = {c.user_id: c for c in configs}
    
    res = []
    for u in users:
        c = config_dict.get(u.id)
        is_configured = c is not None and c.tg_token is not None
        bot = current_bots.get(u.id)
        
        bot_info = None
        if bot:
            try:
                me = await bot.get_me()
                bot_info = {
                    "username": me.username,
                    "first_name": me.first_name
                }
            except:
                bot_info = {"username": "Error"}
        
        res.append({
            "user_id": u.id,
            "username": u.username,
            "is_configured": is_configured,
            "is_running": bot is not None,
            "bot_info": bot_info
        })
    return res

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
    
    if not provider:
        raise HTTPException(status_code=400, detail="Provider is required")
        
    try:
        if provider in ["openai", "openrouter", "ollama"]:
            # Use AsyncOpenAI for testing as it's what we use in chat
            kwargs = {"api_key": api_key or "dummy"}
            if base_url:
                kwargs["base_url"] = base_url
            
            async with AsyncOpenAI(**kwargs) as client:
                # Minimal request to test connection
                await client.chat.completions.create(
                    model=model_name or "gpt-4o-mini",
                    messages=[{"role": "user", "content": "ping"}],
                    max_tokens=1
                )
                return {"status": "success", "message": "Connection successful"}
        
        elif provider == "gemini":
            if not api_key:
                raise HTTPException(status_code=400, detail="API Key is required for Gemini")
            
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name or 'gemini-1.5-flash'}:generateContent?key={api_key}"
            async with httpx.AsyncClient() as client:
                payload = {"contents": [{"parts": [{"text": "ping"}]}]}
                resp = await client.post(url, json=payload, timeout=10.0)
                if resp.status_code == 200:
                    return {"status": "success", "message": "Gemini connection successful"}
                else:
                    return {"status": "error", "message": f"Gemini returned {resp.status_code}: {resp.text}"}
            
        return {"status": "error", "message": "Unsupported provider"}
    except Exception as e:
        logger.error(f"Integration test failed: {str(e)}")
        return {"status": "error", "message": str(e)}

@app.post("/api/proxy/test")
async def test_proxy(req: dict, current_user: User = Depends(get_current_user)):
    proxy_config = req.get("proxy_config")
    if not proxy_config or not proxy_config.get("host"):
        raise HTTPException(status_code=400, detail="Proxy host is required")
    
    protocol = proxy_config.get("protocol", "http")
    host = proxy_config.get("host")
    port = proxy_config.get("port")
    username = proxy_config.get("username")
    password = proxy_config.get("password")
    
    proxy_url = f"{protocol}://"
    if username and password:
        proxy_url += f"{username}:{password}@"
    proxy_url += f"{host}"
    if port:
        proxy_url += f":{port}"
        
    try:
        async with httpx.AsyncClient(proxy=proxy_url, timeout=10.0) as client:
            # Try to reach a reliable public API
            resp = await client.get("https://api.ipify.org?format=json")
            if resp.status_code == 200:
                return {"status": "success", "message": f"Proxy connection successful. IP: {resp.json().get('ip')}"}
            else:
                return {"status": "error", "message": f"Proxy returned status {resp.status_code}"}
    except Exception as e:
        logger.error(f"Proxy test failed: {str(e)}")
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

class ChatRequest(BaseModel):
    message: str
    unlockedFolderIds: list[str] | None = None

@app.post("/api/chat")
async def chat_with_notes(req: ChatRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Чат с заметками (Advanced Hybrid RAG with Query Expansion)"""
    from .utils.embeddings import embedding_manager
    from sqlalchemy import or_
    import re
    
    # 0. Получение конфигурации LLM
    config = db.query(Config).first()
    if not config or not config.llm_provider:
        return {
            "answer": "ИИ-провайдер не настроен. Пожалуйста, настройте его в настройках.",
            "citations": []
        }

    # 1. Query Expansion (Расширение запроса через LLM) + Базовый сплит
    search_keywords = [req.message]
    
    # Базовый сплит на случай если LLM expansion упадет
    import re
    clean_message = re.sub(r'[^\w\sа-яА-ЯёЁ]', ' ', req.message).lower()
    stop_words = {'как', 'что', 'это', 'где', 'когда', 'почему', 'зачем', 'про', 'для', 'или', 'под', 'над', 'the', 'and', 'for', 'with', 'about', 'есть', 'нет', 'мне', 'нам', 'вам', 'какие', 'какой', 'какая', 'какого', 'каких', 'все', 'тут', 'там', 'найди', 'заметку', 'записал', 'найти', 'записи', 'запись', 'покажи', 'расскажи'}
    basic_words = [w for w in clean_message.split() if w not in stop_words and len(w) > 2]
    search_keywords.extend(basic_words)

    try:
        expansion_prompt = f"""Сгенерируй 5-7 ключевых слов для поиска в базе заметок по запросу: "{req.message}"
Учти возможные переводы (RU/EN), транслитерацию (например, докер -> docker, doker) и синонимы. 
Выдай только слова через запятую, без нумерации и пояснений.
Пример: "докер" -> "docker, doker, контейнеры, devops, докер"
Пример: "шашлык" -> "шашлык, мясо, мангал, гриль, bbq, барбекю"
"""
        # Используем тот же провайдер для расширения
        expanded_text = ""
        if config.llm_provider in ["openai", "ollama", "openrouter"]:
            from openai import AsyncOpenAI
            base_url = config.base_url
            if config.llm_provider == "openrouter" and not base_url:
                base_url = "https://openrouter.ai/api/v1"
            async with AsyncOpenAI(api_key=config.api_key or "dummy", base_url=base_url) as client:
                resp = await client.chat.completions.create(
                    model=config.model_name or "gpt-4o-mini",
                    messages=[{"role": "user", "content": expansion_prompt}],
                    max_tokens=50
                )
                expanded_text = resp.choices[0].message.content
        elif config.llm_provider == "gemini":
            api_key = config.api_key
            model = config.model_name or "gemini-1.5-flash"
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
            async with httpx.AsyncClient() as client:
                payload = {"contents": [{"parts": [{"text": expansion_prompt}]}]}
                resp = await client.post(url, json=payload, timeout=10)
                if resp.status_code == 200:
                    expanded_text = resp.json()['candidates'][0]['content']['parts'][0]['text']
        
        if expanded_text:
            # Очищаем и добавляем новые слова
            new_words = [w.strip().lower() for w in expanded_text.replace('\n', ',').split(',') if len(w.strip()) > 2]
            search_keywords.extend(new_words)
    except Exception as e:
        print(f"Query expansion failed: {e}")

    # 2. Проверка на наличие заметок без эмбеддингов (ленивая индексация)
    notes_without_embeddings = db.query(Note).filter(
        Note.user_id == current_user.id,
        Note.embedding.is_(None)
    ).all()
    if notes_without_embeddings:
        for note in notes_without_embeddings:
            text_to_embed = f"{note.title}\n{note.content or ''}"
            note.embedding = embedding_manager.get_vector(text_to_embed)
        db.commit()

    # 2.5 Определить защищенные папки (чтобы скрыть их контент, но оставить в поиске)
    unlocked_ids = req.unlockedFolderIds or []
    protected_folder_ids = [f.id for f in db.query(Folder.id).filter(
        Folder.user_id == current_user.id, 
        Folder.password_hash.is_not(None),
        Folder.password_hash != "",
        Folder.id.notin_(unlocked_ids + ['placeholder_to_avoid_empty_in_sql'])
    ).all()]

    base_filters = [Note.user_id == current_user.id]

    # 3. Ключевой поиск (Keyword Search) по расширенным словам
    keyword_filters = []
    unique_words = list(set(search_keywords))
    for word in unique_words:
        keyword_filters.append(Note.title.ilike(f"%{word}%"))
        
        # Для контента придется искать везде, но мы отфильтруем контент перед отправкой в LLM
        keyword_filters.append(Note.content.ilike(f"%{word}%"))
    
    keyword_results = []
    if keyword_filters:
        keyword_results = db.query(Note).filter(
            *base_filters,
            or_(*keyword_filters)
        ).limit(15).all()
    
    # 4. Семантический поиск (Semantic Search)
    query_vector = embedding_manager.get_vector(req.message)
    semantic_threshold = 0.40
    
    semantic_results = db.query(
        Note, 
        Note.embedding.cosine_distance(query_vector).label("distance")
    ).filter(
        *base_filters,
        Note.embedding.is_not(None)
    ).filter(
        Note.embedding.cosine_distance(query_vector) <= semantic_threshold
    ).order_by(
        Note.embedding.cosine_distance(query_vector)
    ).limit(15).all()
    
    # 5. Дедупликация и объединение
    combined_notes = {}
    for note in keyword_results:
        combined_notes[note.id] = note
    for note, dist in semantic_results:
        if note.id not in combined_notes:
            combined_notes[note.id] = note
            
    final_notes = list(combined_notes.values())[:20]
    
    if not final_notes:
        return {
            "answer": "Я не нашел релевантной информации в ваших заметках.",
            "citations": []
        }
    
    # 6. Формирование контекста
    context_parts = []
    for i, note in enumerate(final_notes):
        if note.folderId in protected_folder_ids:
            content = "[ЗАКРЫТО ПАРОЛЕМ. Содержимое скрыто.]"
        else:
            content = note.content
        context_parts.append(f"ЗАМЕТКА [{i+1}]\nID: {note.id}\nЗаголовок: {note.title}\nСодержание: {content}")
    
    context_text = "\n\n---\n\n".join(context_parts)
    
    # 7. Финальный запрос к LLM (Human answers for open notes, programmatic Telegram-style for protected)
    prompt = f"""Ты — умный ИИ-помощник в приложении заметок. Твоя задача — дать релевантный ответ на вопрос пользователя на основе предоставленных открытых заметок.

ЗАМЕТКИ ИЗ БАЗЫ:
{context_text}

ИНСТРУКЦИИ:
1. Ответь пользователю максимально естественно и подробно, используя ТОЛЬКО предоставленные открытые заметки.
2. ИГНОРИРУЙ ЗАЩИЩЕННЫЕ ЗАМЕТКИ: Если в тексте заметки написано "[ЗАКРЫТО ПАРОЛЕМ. Содержимое скрыто.]", полностью проигнорируй её. Ни в коем случае не упоминай защищенные заметки в своем ответе (система сама добавит их позже).
3. Если нет подходящих открытых заметок для ответа, НИЧЕГО НЕ ПИШИ в ответе (оставь текст абсолютно пустым).
4. Обязательно в конце выведи строку "SOURCES: ID1, ID2, ...". Укажи ID тех ОТКРЫТЫХ заметок, которые ты использовал. Если ничего не нашел — "SOURCES: NONE".

ВОПРОС: {req.message}"""

    try:
        answer = ""
        if config.llm_provider in ["openai", "ollama", "openrouter"]:
            from openai import AsyncOpenAI
            base_url = config.base_url
            if config.llm_provider == "openrouter" and not base_url:
                base_url = "https://openrouter.ai/api/v1"
            async with AsyncOpenAI(api_key=config.api_key or "dummy", base_url=base_url) as client:
                response = await client.chat.completions.create(
                    model=config.model_name or "gpt-4o-mini",
                    messages=[{"role": "user", "content": prompt}]
                )
                answer = response.choices[0].message.content
        elif config.llm_provider == "gemini":
            api_key = config.api_key
            model = config.model_name or "gemini-1.5-flash"
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
            async with httpx.AsyncClient() as client:
                payload = {"contents": [{"parts": [{"text": prompt}]}]}
                response = await client.post(url, json=payload, timeout=30)
                if response.status_code == 200:
                    answer = response.json()['candidates'][0]['content']['parts'][0]['text']
                else:
                    answer = f"Ошибка Gemini API: {response.text}"
        
        # Parse SOURCES
        used_ids = []
        if "SOURCES:" in answer:
            parts = answer.split("SOURCES:")
            answer_text = parts[0].strip()
            ids_part = parts[1].strip()
            if ids_part != "NONE" and ids_part != "":
                used_ids = [id.strip() for id in ids_part.split(',') if id.strip()]
            answer = answer_text

        # 1. Разобьем заметки на открытые и закрытые
        open_notes = [n for n in final_notes if n.folderId not in protected_folder_ids]
        protected_notes = [n for n in final_notes if n.folderId in protected_folder_ids]
        
        # 2. Формируем цитаты
        final_citations = []
        relevant_open = [n for n in open_notes if n.id in used_ids]
        
        # Защищенные всегда считаем релевантными, если движок их отобрал
        final_relevant_notes = relevant_open + protected_notes
        for note in final_relevant_notes:
            snippet_short = "[Защищено паролем]" if note.folderId in protected_folder_ids else (note.content[:100] + "..." if note.content else "")
            final_citations.append({
                "id": note.id,
                "title": note.title,
                "snippet": snippet_short
            })

        # 3. Форматируем ответ. 
        final_answer = answer.strip()
        
        if protected_notes:
            telegram_list = []
            for i, pn in enumerate(protected_notes):
                telegram_list.append(f"{i+1}. {pn.title}\n[Содержимое защищено паролем]")
            
            telegram_str = "\n\n".join(telegram_list)
            
            # Если есть и человеческий текст, и запароленные заметки, ставим телеграм-блок ниже
            if final_answer:
                telegram_block = f"Также вот что я нашел по запросу «{req.message}»:\n\n{telegram_str}"
                final_answer += f"\n\n{telegram_block}"
            else:
                telegram_block = f"Вот что я нашел по запросу «{req.message}»:\n\n{telegram_str}"
                final_answer = telegram_block
        else:
            if not final_answer:
                 final_answer = f"Я не нашел информации по запросу «{req.message}» в ваших заметках."

        return {
            "answer": final_answer,
            "citations": final_citations
        }
    except Exception as e:
        return {"answer": f"Ошибка: {str(e)}", "citations": []}

@app.get("/api/debug/notes")
async def debug_notes(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    notes = db.query(Note).filter(Note.user_id == current_user.id).all()
    return [{"id": n.id, "title": n.title, "has_embedding": n.embedding is not None} for n in notes]

@app.post("/api/ai/summarize")
async def summarize_content(req: dict, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    content = req.get("content")
    if not content:
        raise HTTPException(status_code=400, detail="Content is required")
    
    config = db.query(Config).filter(Config.user_id == current_user.id).first()
    if not config or not config.llm_provider:
        raise HTTPException(status_code=400, detail="LLM provider not configured")
    
    prompt = f"""Пожалуйста, сделай краткое резюме (summary) следующего текста. 
Используй формат TL;DR в начале. Отвечай на языке текста (преимущественно на русском).
Текст:
{content}
"""
    
    try:
        summary = ""
        if config.llm_provider in ["openai", "ollama", "openrouter"]:
            from openai import AsyncOpenAI
            base_url = config.base_url
            if config.llm_provider == "openrouter" and not base_url:
                base_url = "https://openrouter.ai/api/v1"
            async with AsyncOpenAI(api_key=config.api_key or "dummy", base_url=base_url) as client:
                response = await client.chat.completions.create(
                    model=config.model_name or "gpt-4o-mini",
                    messages=[{"role": "user", "content": prompt}]
                )
                summary = response.choices[0].message.content
        elif config.llm_provider == "gemini":
            api_key = config.api_key
            model = config.model_name or "gemini-1.5-flash"
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
            async with httpx.AsyncClient() as client:
                payload = {"contents": [{"parts": [{"text": prompt}]}]}
                response = await client.post(url, json=payload, timeout=30)
                if response.status_code == 200:
                    summary = response.json()['candidates'][0]['content']['parts'][0]['text']
                else:
                    raise Exception(f"Gemini error: {response.text}")
        
        return {"summary": summary}
    except Exception as e:
        logger.error(f"Summarization failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

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