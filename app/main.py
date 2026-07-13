import os
import sys
import json
import hashlib
import uuid
import shutil
import time
import asyncio
from typing import List, Optional
from fastapi import FastAPI, UploadFile, File, Depends, HTTPException, BackgroundTasks, Header, Form, Query, Request
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session
from sqlalchemy import func, text

from app.database import engine, get_db, DB_FILE, SessionLocal
from app.models import Base, FileMetadata, Container
from app.logger import get_logger, LOG_FILE
from app.share_sync import (
    sanitize_container_id, is_hash_filename, sync_share_path,
    sync_container_from_path, list_share_rooms, cleanup_duplicate_directories,
    DEFAULT_SHARE_ROOT_ROOM
)

# DB 테이블 생성
Base.metadata.create_all(bind=engine)

# DB 스키마 마이그레이션
try:
    with engine.connect() as conn:
        result = conn.execute(text("PRAGMA table_info(file_metadata)"))
        columns = [row[1] for row in result.fetchall()]
        if "folder_path" not in columns:
            conn.execute(text("ALTER TABLE file_metadata ADD COLUMN folder_path VARCHAR DEFAULT ''"))
            print("[Migration] Added folder_path column to file_metadata")
        if "is_directory" not in columns:
            conn.execute(text("ALTER TABLE file_metadata ADD COLUMN is_directory BOOLEAN DEFAULT 0"))
            print("[Migration] Added is_directory column to file_metadata")
        conn.commit()
except Exception as e:
    print(f"DB Migration Error: {e}")

# 컨테이너 비밀번호 해시 마이그레이션
try:
    with engine.connect() as conn:
        rows = conn.execute(text("SELECT id, password FROM containers WHERE password IS NOT NULL")).fetchall()
        for row in rows:
            if row[1] and not (len(row[1]) == 64 and all(c in '0123456789abcdef' for c in row[1])):
                hashed = hashlib.sha256(row[1].encode('utf-8')).hexdigest()
                conn.execute(text("UPDATE containers SET password = :pw WHERE id = :id"), {"pw": hashed, "id": row[0]})
                print(f"[Migration] Hashed password for container: {row[0]}")
        conn.commit()
except Exception as e:
    print(f"Password migration error: {e}")

logger = get_logger()

# IP별 관리자 로그인 실패 횟수 및 차단 시간 추적
admin_failed_attempts = {}
# IP별 경로 확인 요청 제한 (Path Enumeration 방지)
verify_path_attempts = {}

# PyInstaller 패키징 여부에 따른 경로 관리
IS_FROZEN = getattr(sys, 'frozen', False)
BASE_DIR = sys._MEIPASS if IS_FROZEN else os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RUNNING_DIR = os.path.dirname(sys.executable) if IS_FROZEN else os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# 업로드 디렉토리 설정
UPLOAD_DIR = os.path.join(RUNNING_DIR, "uploads")
if not os.path.exists(UPLOAD_DIR):
    os.makedirs(UPLOAD_DIR)

# 설정 파일 경로
CONFIG_PATH = os.path.join(RUNNING_DIR, "config.json")

def load_config():
    try:
        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}

def get_share_path() -> Optional[str]:
    share_path = load_config().get("share_path", "")
    if share_path and os.path.isdir(share_path):
        return os.path.abspath(share_path)
    return None

def get_storage_base() -> str:
    share_path = get_share_path()
    return share_path if share_path else UPLOAD_DIR

def get_container_upload_dir(container_id: str) -> str:
    safe_id = sanitize_container_id(container_id)
    path = os.path.join(get_storage_base(), safe_id)
    os.makedirs(path, exist_ok=True)
    return path

def get_file_physical_path(container_id: str, filename: str) -> str:
    if not filename:
        return ""
    container_dir = get_container_upload_dir(container_id)
    if is_hash_filename(filename):
        new_path = os.path.join(container_dir, filename)
        if os.path.exists(new_path):
            return new_path
        legacy_path = os.path.join(UPLOAD_DIR, filename)
        if os.path.exists(legacy_path):
            return legacy_path
        return new_path
    return os.path.join(container_dir, filename.replace('/', os.sep))

# 정적 파일 경로 지정
if IS_FROZEN:
    STATIC_DIR = os.path.join(sys._MEIPASS, "app", "static")
else:
    STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")

app = FastAPI(title="Simple File Share API")

@app.on_event("startup")
def startup_sync_share_path():
    share_path = get_share_path()
    if share_path:
        db = SessionLocal()
        try:
            config = load_config()
            root_room = config.get("share_root_room", DEFAULT_SHARE_ROOT_ROOM)
            sync_share_path(share_path, db, logger, share_root_room=root_room)
        finally:
            db.close()

# Uvicorn 서버 객체 글로벌 참조 관리
global_server = None

def set_server_instance(server):
    global global_server
    global_server = server
    logger.info("Uvicorn server instance bound successfully.")

def get_max_upload_size():
    config = load_config()
    return config.get("max_upload_size_mb", 100) * 1024 * 1024

# Uvicorn 종료 태스크 (별도 스레드/태스크로 실행)
async def restart_server_task():
    await asyncio.sleep(1)
    if global_server:
        logger.info("Triggering server reload for port change...")
        global_server.should_exit = True
    else:
        logger.warning("No server instance bound. Restart request ignored.")

def hash_password(plain: str) -> str:
    try:
        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            config = json.load(f)
            salt = config.get("password_salt", "")
    except Exception:
        salt = ""
    return hashlib.sha256((salt + plain).encode('utf-8')).hexdigest()

def is_hashed(value: str) -> bool:
    return len(value) == 64 and all(c in '0123456789abcdef' for c in value)

def verify_hashed(plain: str, stored: str) -> bool:
    if is_hashed(stored):
        return hash_password(plain) == stored
    return plain == stored  # fallback for legacy plaintext

def verify_password(password: str):
    try:
        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            config = json.load(f)
            stored = config.get("admin_password", "admin")
            return verify_hashed(password, stored)
    except Exception:
        return False

@app.post("/api/admin/verify")
def verify_admin(request: Request, payload: dict):
    ip = request.client.host
    now = time.time()
    
    try:
        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            config = json.load(f)
            max_attempts = config.get("max_failed_attempts", 10)
    except Exception:
        max_attempts = 10
        
    if ip in admin_failed_attempts:
        attempt_info = admin_failed_attempts[ip]
        if attempt_info['blocked_until'] > now:
            raise HTTPException(status_code=403, detail="최대 로그인 실패 횟수를 초과했습니다. 15분간 차단됩니다.")
        elif attempt_info['blocked_until'] != 0:
            admin_failed_attempts[ip] = {'count': 0, 'blocked_until': 0}
            
    password = payload.get("password")
    if verify_password(password):
        if ip in admin_failed_attempts:
            admin_failed_attempts[ip] = {'count': 0, 'blocked_until': 0}
        return {"status": "success", "message": "Authenticated"}
        
    if ip not in admin_failed_attempts:
        admin_failed_attempts[ip] = {'count': 1, 'blocked_until': 0}
    else:
        admin_failed_attempts[ip]['count'] += 1
        
    if admin_failed_attempts[ip]['count'] >= max_attempts:
        admin_failed_attempts[ip]['blocked_until'] = now + 900
        raise HTTPException(status_code=403, detail="최대 로그인 실패 횟수를 초과했습니다. 15분간 차단됩니다.")
        
    raise HTTPException(status_code=401, detail=f"비밀번호가 올바르지 않습니다. (실패 횟수: {admin_failed_attempts[ip]['count']}/{max_attempts})")

@app.get("/api/verify_path/{container_id}")
def verify_admin_path(request: Request, container_id: str):
    ip = request.client.host
    now = time.time()
    
    if ip not in verify_path_attempts:
        verify_path_attempts[ip] = {'count': 1, 'reset_at': now + 60}
    else:
        if now > verify_path_attempts[ip]['reset_at']:
            verify_path_attempts[ip] = {'count': 1, 'reset_at': now + 60}
        else:
            verify_path_attempts[ip]['count'] += 1
            if verify_path_attempts[ip]['count'] > 10:
                time.sleep(2)  # Delay penalty for brute-forcing
                return {"is_admin": False}
                
    try:
        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            config = json.load(f)
            admin_path = config.get("admin_path", "admin")
            return {"is_admin": container_id == admin_path}
    except Exception:
        return {"is_admin": container_id == "admin"}

@app.get("/api/settings")
def get_settings(x_admin_password: str = Header(None)):
    if not verify_password(x_admin_password):
        raise HTTPException(status_code=401, detail="Unauthorized: Invalid admin password.")
        
    if not os.path.exists(CONFIG_PATH):
        raise HTTPException(status_code=404, detail="Configuration file not found.")
    try:
        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read settings: {str(e)}")

@app.post("/api/settings")
def update_settings(settings: dict, background_tasks: BackgroundTasks, x_admin_password: str = Header(None)):
    if not verify_password(x_admin_password):
        raise HTTPException(status_code=401, detail="Unauthorized: Invalid admin password.")
        
    port = settings.get("port")
    max_size = settings.get("max_upload_size_mb")
    new_password = settings.get("admin_password")
    new_admin_path = settings.get("admin_path")
    new_max_failed = settings.get("max_failed_attempts")
    new_salt = settings.get("password_salt")
    new_share_path = settings.get("share_path")
    
    if not port or not isinstance(port, int) or port < 1024 or port > 65535:
        raise HTTPException(status_code=400, detail="Invalid port number. Must be between 1024 and 65535.")
    if not max_size or not isinstance(max_size, int) or max_size <= 0:
        raise HTTPException(status_code=400, detail="Invalid max upload size. Must be greater than 0.")
        
    try:
        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            old_conf = json.load(f)
    except Exception:
        old_conf = {"admin_password": hash_password("admin"), "admin_path": "admin"}
        
    if new_password and isinstance(new_password, str) and len(new_password.strip()) > 0:
        settings["admin_password"] = hash_password(new_password.strip())
    else:
        settings["admin_password"] = old_conf.get("admin_password", hash_password("admin"))
        
    if not new_admin_path or not isinstance(new_admin_path, str) or len(new_admin_path.strip()) == 0:
        settings["admin_path"] = old_conf.get("admin_path", "admin")
        
    if new_max_failed is not None and isinstance(new_max_failed, int) and new_max_failed > 0:
        settings["max_failed_attempts"] = new_max_failed
    else:
        settings["max_failed_attempts"] = old_conf.get("max_failed_attempts", 10)
        
    if new_salt is not None and isinstance(new_salt, str):
        settings["password_salt"] = new_salt
    else:
        settings["password_salt"] = old_conf.get("password_salt", "")

    if new_share_path is not None and isinstance(new_share_path, str):
        settings["share_path"] = new_share_path.strip()
    else:
        settings["share_path"] = old_conf.get("share_path", "")
    try:
        with open(CONFIG_PATH, "w", encoding="utf-8") as f:
            json.dump(settings, f, indent=4)
        logger.info(f"Configuration updated: Port={port}, MaxSize={max_size}MB")
        
        current_port = getattr(global_server.config, "port", None) if global_server else None
        
        if current_port and current_port != port:
            logger.info(f"Port changed from {current_port} to {port}. Initiating restart...")
            background_tasks.add_task(restart_server_task)
            return {"status": "restarting", "message": "Port changed. Server is restarting..."}
        else:
            share_path = settings.get("share_path", "").strip()
            if share_path and os.path.isdir(share_path):
                db = SessionLocal()
                try:
                    root_room = settings.get("share_root_room", DEFAULT_SHARE_ROOT_ROOM)
                    sync_share_path(os.path.abspath(share_path), db, logger, share_root_room=root_room)
                finally:
                    db.close()
            return {"status": "success", "message": "Settings saved successfully."}
            
    except Exception as e:
        logger.error(f"Failed to save settings: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to save settings: {str(e)}")

# --- 헬퍼 함수 ---
def get_effective_password(container_id: str, container: Optional[Container] = None) -> Optional[str]:
    try:
        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            config = json.load(f)
            if container_id == config.get("admin_path", "admin"):
                return config.get("admin_password", "admin")
    except Exception:
        if container_id == "admin":
            return "admin"
    if container and container.password:
        return container.password
    return None

# --- 컨테이너 및 파일 API ---
@app.post("/api/container/{container_id}/auth")
def auth_container(container_id: str, payload: dict, db: Session = Depends(get_db)):
    password = payload.get("password", "")
    container = db.query(Container).filter(Container.id == container_id).first()
    
    effective_pw = get_effective_password(container_id, container)
    
    if effective_pw and not verify_hashed(password, effective_pw):
        raise HTTPException(status_code=401, detail="비밀번호가 올바르지 않습니다.")
        
    if not container:
        # 컨테이너가 없으면 방 생성 (admin 방의 경우 비밀번호 필드를 DB에 명시적으로 쓰지 않아도 됨)
        container = Container(id=container_id, password=hash_password(password) if (password and not effective_pw) else None)
        db.add(container)
        db.commit()
        return {"status": "created", "message": "Container created."}
    else:
        # 일반 방에 처음 비밀번호가 설정되는 경우
        if not effective_pw and password:
            container.password = hash_password(password)
            db.commit()
            return {"status": "updated", "message": "Container password set."}
        return {"status": "success", "message": "Authenticated"}

@app.get("/api/container/{container_id}/info")
def container_info(container_id: str, db: Session = Depends(get_db)):
    container = db.query(Container).filter(Container.id == container_id).first()
    effective_pw = get_effective_password(container_id, container)
    
    # 관리자 방(admin_path)인 경우, DB에 없더라도 config에 의해 비밀번호가 존재하므로 방이 이미 있는 것으로 취급
    return {
        "exists": container is not None or effective_pw is not None,
        "has_password": bool(effective_pw)
    }

@app.put("/api/container/{container_id}/password")
def change_container_password(container_id: str, payload: dict, db: Session = Depends(get_db), x_admin_password: str = Header(None)):
    container = db.query(Container).filter(Container.id == container_id).first()
    if not container:
        raise HTTPException(status_code=404, detail="방을 찾을 수 없습니다.")
    
    current_password = payload.get("current_password", "")
    new_password = payload.get("new_password", "")
    
    is_admin = verify_password(x_admin_password) if x_admin_password else False
    
    if not is_admin:
        effective_pw = get_effective_password(container_id, container)
        if effective_pw and not verify_hashed(current_password, effective_pw):
            raise HTTPException(status_code=401, detail="현재 비밀번호가 올바르지 않습니다.")
    
    container.password = hash_password(new_password) if new_password else None
    db.commit()
    return {"status": "success", "message": "비밀번호가 변경되었습니다."}

@app.get("/api/files/{container_id}/readme")
def get_readme(container_id: str, folder_path: str = Query(""), db: Session = Depends(get_db), x_container_password: str = Header(None), x_admin_password: str = Header(None)):
    container = db.query(Container).filter(Container.id == container_id).first()
    effective_pw = get_effective_password(container_id, container)
    
    is_admin = verify_password(x_admin_password) if x_admin_password else False
    if effective_pw and not is_admin:
        if not x_container_password or not verify_hashed(x_container_password, effective_pw):
            raise HTTPException(status_code=401, detail="권한이 없습니다.")
            
    files = db.query(FileMetadata).filter(
        FileMetadata.container_id == container_id,
        FileMetadata.folder_path == folder_path,
        FileMetadata.is_directory == False
    ).all()
    
    readme_file = None
    for f in files:
        if f.original_name.lower() == "readme.md":
            readme_file = f
            break
    
    if not readme_file:
        raise HTTPException(status_code=404, detail="README.md not found")
    
    file_path = get_file_physical_path(container_id, readme_file.filename)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File missing")
    
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            content = f.read()
        return {"content": content, "filename": readme_file.original_name}
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to read file")

@app.get("/api/files/{container_id}")
def list_files(container_id: str, folder_path: str = Query(""), page: int = Query(1), page_size: int = Query(50), db: Session = Depends(get_db), x_container_password: str = Header(None), x_admin_password: str = Header(None)):
    share_path = get_share_path()
    if share_path:
        room_path = os.path.join(share_path, sanitize_container_id(container_id))
        if not os.path.isdir(room_path):
            exact_path = os.path.join(share_path, container_id)
            room_path = exact_path if os.path.isdir(exact_path) else None
        if room_path:
            sync_container_from_path(container_id, room_path, db, logger)

    container = db.query(Container).filter(Container.id == container_id).first()
    effective_pw = get_effective_password(container_id, container)
    
    is_admin = verify_password(x_admin_password) if x_admin_password else False
    is_authenticated = is_admin
    if effective_pw and not is_admin:
        if x_container_password and verify_hashed(x_container_password, effective_pw):
            is_authenticated = True
    elif not effective_pw:
        is_authenticated = True

    query = db.query(FileMetadata).filter(FileMetadata.container_id == container_id)
    query = query.filter(FileMetadata.folder_path == folder_path)
    if not is_authenticated:
        query = query.filter(FileMetadata.is_protected == False)
        
    query = query.order_by(FileMetadata.is_directory.desc(), FileMetadata.upload_time.desc())
    total = query.count()
    files = query.offset((page - 1) * page_size).limit(page_size).all()
    result = []
    for f in files:
        result.append({
            "id": f.id,
            "original_name": f.original_name,
            "file_size": f.file_size,
            "is_protected": f.is_protected,
            "folder_path": f.folder_path,
            "is_directory": f.is_directory,
            "upload_time": f.upload_time.strftime("%Y-%m-%d %H:%M:%S"),
            "download_count": f.download_count
        })
    return {"items": result, "total": total, "page": page, "page_size": page_size, "total_pages": (total + page_size - 1) // page_size}

@app.post("/api/upload/{container_id}")
async def upload_file(
    container_id: str,
    file: UploadFile = File(...), 
    is_protected: bool = Form(False),
    folder_path: str = Form(""),
    db: Session = Depends(get_db),
    content_length: int = Header(None),
    x_container_password: str = Header(None),
    x_admin_password: str = Header(None)
):
    container = db.query(Container).filter(Container.id == container_id).first()
    if not container:
        container = Container(id=container_id)
        db.add(container)
        db.commit()
    
    effective_pw = get_effective_password(container_id, container)
    is_admin = verify_password(x_admin_password) if x_admin_password else False
    
    if is_protected:
        if not effective_pw:
            raise HTTPException(status_code=400, detail="방에 비밀번호가 설정되어 있지 않아 보호 파일을 올릴 수 없습니다.")
        if not is_admin and not (x_container_password and verify_hashed(x_container_password, effective_pw)):
            raise HTTPException(status_code=401, detail="보호된 파일을 업로드하려면 방 비밀번호가 필요합니다.")

    max_bytes = get_max_upload_size()
    
    if content_length and content_length > max_bytes:
        raise HTTPException(status_code=413, detail=f"File exceeds maximum upload limit ({max_bytes // (1024 * 1024)}MB).")
        
    existing_file = db.query(FileMetadata).filter(
        FileMetadata.container_id == container_id,
        FileMetadata.folder_path == folder_path,
        FileMetadata.original_name == file.filename,
        FileMetadata.is_directory == False
    ).first()

    if existing_file:
        raise HTTPException(status_code=400, detail="동일한 이름의 파일이 이 폴더에 이미 존재합니다.")
        
    logger.info(f"Starting file upload: {file.filename} to container {container_id}")
    
    container_dir = get_container_upload_dir(container_id)
    file_id = str(uuid.uuid4())
    temp_filename = f"temp_{file_id}"
    temp_path = os.path.join(container_dir, temp_filename)
    
    total_size = 0
    hasher = hashlib.sha256()
    try:
        with open(temp_path, "wb") as buffer:
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                total_size += len(chunk)
                if total_size > max_bytes:
                    buffer.close()
                    os.remove(temp_path)
                    raise HTTPException(status_code=413, detail=f"File exceeds maximum upload limit.")
                buffer.write(chunk)
                hasher.update(chunk)
    except HTTPException:
        raise
    except Exception as e:
        if os.path.exists(temp_path):
            os.remove(temp_path)
        raise HTTPException(status_code=500, detail="Failed to write file to storage.")
    
    file_hash = hasher.hexdigest()
    saved_filename = file_hash
    saved_path = os.path.join(container_dir, saved_filename)
    
    if not os.path.exists(saved_path):
        os.replace(temp_path, saved_path)
    else:
        if os.path.exists(temp_path):
            os.remove(temp_path)
        logger.info(f"File deduplicated: {file_hash}")
    
    db_file = FileMetadata(
        id=file_id,
        container_id=container_id,
        filename=saved_filename,
        original_name=file.filename,
        file_size=total_size,
        is_protected=is_protected,
        folder_path=folder_path,
        is_directory=False
    )
    db.add(db_file)
    
    if folder_path:
        parts = folder_path.strip("/").split("/")
        current_path = ""
        for part in parts:
            if not part:
                continue
            existing_dir = db.query(FileMetadata).filter(
                FileMetadata.container_id == container_id,
                FileMetadata.folder_path == current_path,
                FileMetadata.original_name == part,
                FileMetadata.is_directory == True
            ).first()
            if not existing_dir:
                new_dir = FileMetadata(
                    id=str(uuid.uuid4()),
                    container_id=container_id,
                    filename="",
                    original_name=part,
                    file_size=0,
                    is_protected=False,
                    folder_path=current_path,
                    is_directory=True
                )
                db.add(new_dir)
            current_path = f"{current_path}/{part}" if current_path else part

    db.commit()
    db.refresh(db_file)
    
    return {"id": file_id, "original_name": file.filename, "file_size": total_size, "is_protected": is_protected}

@app.post("/api/folder/{container_id}")
def create_folder(
    container_id: str,
    folder_name: str = Form(...),
    parent_path: str = Form(""),
    db: Session = Depends(get_db),
    x_container_password: str = Header(None),
    x_admin_password: str = Header(None)
):
    container = db.query(Container).filter(Container.id == container_id).first()
    if not container:
        container = Container(id=container_id)
        db.add(container)
        db.commit()
        
    effective_pw = get_effective_password(container_id, container)
    is_admin = verify_password(x_admin_password) if x_admin_password else False
    
    if effective_pw and not is_admin and not (x_container_password and verify_hashed(x_container_password, effective_pw)):
        raise HTTPException(status_code=401, detail="방 비밀번호가 필요합니다.")
        
    existing = db.query(FileMetadata).filter(
        FileMetadata.container_id == container_id,
        FileMetadata.folder_path == parent_path,
        FileMetadata.original_name == folder_name,
        FileMetadata.is_directory == True
    ).first()
    
    if existing:
        raise HTTPException(status_code=400, detail="이미 존재하는 폴더입니다.")
        
    folder_id = str(uuid.uuid4())
    db_folder = FileMetadata(
        id=folder_id,
        container_id=container_id,
        filename="",
        original_name=folder_name,
        file_size=0,
        is_protected=False,
        folder_path=parent_path,
        is_directory=True
    )
    db.add(db_folder)
    db.commit()
    return {"status": "success", "message": "Folder created"}

@app.get("/download/{file_id}")
def download_file(file_id: str, db: Session = Depends(get_db), x_container_password: str = Header(None), x_admin_password: str = Header(None)):
    db_file = db.query(FileMetadata).filter(FileMetadata.id == file_id).first()
    if not db_file:
        raise HTTPException(status_code=404, detail="File not found.")
        
    container = db.query(Container).filter(Container.id == db_file.container_id).first()
    effective_pw = get_effective_password(db_file.container_id, container)
    
    is_admin = verify_password(x_admin_password) if x_admin_password else False
    is_room_auth = verify_hashed(x_container_password, effective_pw) if (x_container_password and effective_pw) else False
    
    if db_file.is_protected or effective_pw:
        if not is_admin and not is_room_auth:
            raise HTTPException(status_code=401, detail="권한이 없습니다.")
    
    file_path = get_file_physical_path(db_file.container_id, db_file.filename)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Physical file missing from storage.")
    
    db_file.download_count += 1
    db.commit()
    
    return FileResponse(
        path=file_path, 
        filename=db_file.original_name, 
        media_type="application/octet-stream"
    )

@app.delete("/api/files/{container_id}/{file_id}")
def delete_file(container_id: str, file_id: str, db: Session = Depends(get_db), x_container_password: str = Header(None), x_admin_password: str = Header(None)):
    db_file = db.query(FileMetadata).filter(FileMetadata.id == file_id, FileMetadata.container_id == container_id).first()
    if not db_file:
        raise HTTPException(status_code=404, detail="File not found.")
        
    container = db.query(Container).filter(Container.id == container_id).first()
    effective_pw = get_effective_password(container_id, container)
    
    if effective_pw:
        is_room_auth = verify_hashed(x_container_password, effective_pw) if x_container_password else False
        is_admin = verify_password(x_admin_password) if x_admin_password else False
        if not is_room_auth and not is_admin:
            raise HTTPException(status_code=401, detail="Unauthorized to delete this file.")
    
    if db_file.is_directory:
        target_prefix = f"{db_file.folder_path}/{db_file.original_name}" if db_file.folder_path else db_file.original_name
        
        all_children = db.query(FileMetadata).filter(FileMetadata.container_id == container_id).all()
        to_delete = [db_file]
        for item in all_children:
            if item.folder_path == target_prefix or item.folder_path.startswith(target_prefix + "/"):
                to_delete.append(item)
                
        for item in to_delete:
            if not item.is_directory and item.filename:
                file_path = get_file_physical_path(container_id, item.filename)
                remaining = db.query(FileMetadata).filter(
                    FileMetadata.container_id == container_id,
                    FileMetadata.filename == item.filename,
                    FileMetadata.id != item.id
                ).count()
                if remaining == 0 and os.path.exists(file_path):
                    try:
                        os.remove(file_path)
                    except:
                        pass
            db.delete(item)
        db.commit()
        return {"message": "Folder and its contents deleted successfully."}
    else:
        if db_file.filename:
            file_path = get_file_physical_path(container_id, db_file.filename)
            remaining = db.query(FileMetadata).filter(
                FileMetadata.container_id == container_id,
                FileMetadata.filename == db_file.filename,
                FileMetadata.id != db_file.id
            ).count()
            if remaining == 0 and os.path.exists(file_path):
                try:
                    os.remove(file_path)
                except Exception as e:
                    raise HTTPException(status_code=500, detail="Failed to delete file from storage.")
                
        db.delete(db_file)
        db.commit()
        return {"message": "File deleted successfully."}

# --- 전역 관리자 전용 API ---
@app.get("/api/admin/containers")
def admin_get_containers(page: int = Query(1), page_size: int = Query(50), db: Session = Depends(get_db), x_admin_password: str = Header(None)):
    if not verify_password(x_admin_password):
        raise HTTPException(status_code=401, detail="Unauthorized")
        
    query = db.query(Container)
    total = query.count()
    containers = query.offset((page - 1) * page_size).limit(page_size).all()
    result = []
    for c in containers:
        file_count = db.query(func.count(FileMetadata.id)).filter(FileMetadata.container_id == c.id).scalar()
        total_size = db.query(func.sum(FileMetadata.file_size)).filter(FileMetadata.container_id == c.id).scalar() or 0
        result.append({
            "id": c.id,
            "has_password": bool(c.password),
            "created_at": c.created_at.strftime("%Y-%m-%d %H:%M:%S") if c.created_at else "",
            "file_count": file_count,
            "total_size": total_size
        })
    return {"items": result, "total": total, "page": page, "page_size": page_size, "total_pages": (total + page_size - 1) // page_size}

@app.get("/api/admin/files")
def admin_get_all_files(page: int = Query(1), page_size: int = Query(50), db: Session = Depends(get_db), x_admin_password: str = Header(None)):
    if not verify_password(x_admin_password):
        raise HTTPException(status_code=401, detail="Unauthorized")
        
    query = db.query(FileMetadata).order_by(FileMetadata.upload_time.desc())
    total = query.count()
    files = query.offset((page - 1) * page_size).limit(page_size).all()
    result = []
    for f in files:
        result.append({
            "id": f.id,
            "container_id": f.container_id,
            "original_name": f.original_name,
            "file_size": f.file_size,
            "is_protected": f.is_protected,
            "folder_path": f.folder_path,
            "is_directory": f.is_directory,
            "upload_time": f.upload_time.strftime("%Y-%m-%d %H:%M:%S"),
            "download_count": f.download_count
        })
    return {"items": result, "total": total, "page": page, "page_size": page_size, "total_pages": (total + page_size - 1) // page_size}

@app.patch("/api/files/{container_id}/{file_id}/protect")
def toggle_protect(container_id: str, file_id: str, payload: dict, db: Session = Depends(get_db), x_container_password: str = Header(None), x_admin_password: str = Header(None)):
    db_file = db.query(FileMetadata).filter(FileMetadata.id == file_id, FileMetadata.container_id == container_id).first()
    if not db_file:
        raise HTTPException(status_code=404, detail="파일을 찾을 수 없습니다.")
    
    container = db.query(Container).filter(Container.id == container_id).first()
    effective_pw = get_effective_password(container_id, container)
    is_admin = verify_password(x_admin_password) if x_admin_password else False
    is_room_auth = verify_hashed(x_container_password, effective_pw) if (x_container_password and effective_pw) else False
    
    if not is_admin and not is_room_auth:
        raise HTTPException(status_code=401, detail="권한이 없습니다.")
    
    db_file.is_protected = payload.get("is_protected", not db_file.is_protected)
    db.commit()
    return {"status": "success", "is_protected": db_file.is_protected}

@app.patch("/api/files/{container_id}/{file_id}/move")
def move_file(container_id: str, file_id: str, payload: dict, db: Session = Depends(get_db), x_container_password: str = Header(None), x_admin_password: str = Header(None)):
    db_file = db.query(FileMetadata).filter(FileMetadata.id == file_id, FileMetadata.container_id == container_id).first()
    if not db_file:
        raise HTTPException(status_code=404, detail="파일을 찾을 수 없습니다.")
    
    container = db.query(Container).filter(Container.id == container_id).first()
    effective_pw = get_effective_password(container_id, container)
    is_admin = verify_password(x_admin_password) if x_admin_password else False
    is_room_auth = verify_hashed(x_container_password, effective_pw) if (x_container_password and effective_pw) else False
    
    if not is_admin and not is_room_auth:
        raise HTTPException(status_code=401, detail="권한이 없습니다.")
    
    target_folder = payload.get("target_folder", "")
    
    if db_file.is_directory:
        old_prefix = f"{db_file.folder_path}/{db_file.original_name}" if db_file.folder_path else db_file.original_name
        new_prefix = f"{target_folder}/{db_file.original_name}" if target_folder else db_file.original_name
        
        all_items = db.query(FileMetadata).filter(FileMetadata.container_id == container_id).all()
        for item in all_items:
            if item.folder_path == old_prefix or item.folder_path.startswith(old_prefix + "/"):
                item.folder_path = new_prefix + item.folder_path[len(old_prefix):]
    
    db_file.folder_path = target_folder
    db.commit()
    return {"status": "success", "message": "이동이 완료되었습니다."}

@app.delete("/api/admin/containers/{container_id}")
def admin_delete_container(container_id: str, db: Session = Depends(get_db), x_admin_password: str = Header(None)):
    if not verify_password(x_admin_password):
        raise HTTPException(status_code=401, detail="Unauthorized")
        
    container = db.query(Container).filter(Container.id == container_id).first()
    if not container:
        raise HTTPException(status_code=404, detail="Container not found.")
        
    files = db.query(FileMetadata).filter(FileMetadata.container_id == container_id).all()
    container_dir = get_container_upload_dir(container_id)
    for f in files:
        if f.filename and not f.is_directory:
            file_path = get_file_physical_path(container_id, f.filename)
            if os.path.exists(file_path):
                try:
                    os.remove(file_path)
                except:
                    pass
        db.delete(f)

    if os.path.isdir(container_dir):
        try:
            shutil.rmtree(container_dir)
        except:
            pass
        
    db.delete(container)
    db.commit()
    return {"message": "Container and all associated files deleted successfully."}

import socket
def get_local_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(('10.254.254.254', 1))
        ip = s.getsockname()[0]
    except Exception:
        ip = '127.0.0.1'
    finally:
        s.close()
    return ip

@app.get("/api/server/info")
def get_server_info():
    try:
        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            config = json.load(f)
            port = config.get("port", 8000)
    except Exception:
        port = 8000
    share_path = get_share_path()
    return {
        "local_ip": get_local_ip(),
        "port": port,
        "share_path": share_path or "",
        "share_enabled": bool(share_path)
    }

@app.get("/api/share/rooms")
def get_share_rooms():
    share_path = get_share_path()
    if not share_path:
        return {"rooms": [], "share_path": ""}
    return {"rooms": list_share_rooms(share_path), "share_path": share_path}

@app.get("/api/logs")
def get_logs(x_admin_password: str = Header(None)):
    if not verify_password(x_admin_password):
        raise HTTPException(status_code=401, detail="Unauthorized")
    if not os.path.exists(LOG_FILE):
        return []
    try:
        with open(LOG_FILE, "r", encoding="utf-8", errors="ignore") as f:
            lines = f.readlines()
            return [line.strip() for line in lines[-100:]]
    except Exception as e:
        return [f"[ERROR] Failed to read log file: {str(e)}"]

if os.path.exists(STATIC_DIR):
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

@app.get("/", response_class=HTMLResponse)
@app.get("/{container_id}", response_class=HTMLResponse)
def get_index(container_id: str = None):
    index_file = os.path.join(STATIC_DIR, "index.html")
    if not os.path.exists(index_file):
        return HTMLResponse("<h2>index.html not found. Place static resources correctly.</h2>", status_code=404)
    with open(index_file, "r", encoding="utf-8") as f:
        return f.read()
