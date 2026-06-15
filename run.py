import os
import sys
import json
import hashlib
import time
import subprocess
import threading
import webview

# PyInstaller 패키징 여부 감지
IS_FROZEN = getattr(sys, 'frozen', False)
BASE_DIR = sys._MEIPASS if IS_FROZEN else os.path.dirname(os.path.abspath(__file__))
RUNNING_DIR = os.path.dirname(sys.executable) if IS_FROZEN else os.path.dirname(os.path.abspath(__file__))

CONFIG_PATH = os.path.join(RUNNING_DIR, "config.json")

# 개발 환경에서 venv 내의 파이썬 인터프리터로 강제 전환하여 구동하는 래퍼
if not IS_FROZEN:
    venv_python = os.path.join(RUNNING_DIR, "venv", "Scripts", "python.exe")
    if os.path.exists(venv_python) and sys.executable != os.path.abspath(venv_python):
        print(f"[run.py] Virtual environment detected. Restarting script under venv...")
        sys.exit(subprocess.call([venv_python] + sys.argv))

def load_config():
    if not os.path.exists(CONFIG_PATH):
        default_config = {
            "port": 8000,
            "max_upload_size_mb": 100,
            "admin_password": hashlib.sha256(("admin").encode('utf-8')).hexdigest(),
            "admin_path": "admin",
            "max_failed_attempts": 10,
            "password_salt": ""
        }
        try:
            with open(CONFIG_PATH, "w", encoding="utf-8") as f:
                json.dump(default_config, f, indent=4)
            print(f"[run.py] Created default config file: {CONFIG_PATH}")
        except Exception as e:
            print(f"[run.py] Failed to create config file: {e}")
        return default_config
    
    try:
        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            config = json.load(f)
            
            migrated = False
            if "admin_password" not in config:
                config["admin_password"] = "admin"
                migrated = True
            if "admin_path" not in config:
                config["admin_path"] = "admin"
                migrated = True
            if "max_failed_attempts" not in config:
                config["max_failed_attempts"] = 10
                migrated = True
            if "password_salt" not in config:
                config["password_salt"] = ""
                migrated = True
                
            if migrated:
                with open(CONFIG_PATH, "w", encoding="utf-8") as f:
                    json.dump(config, f, indent=4)
                print("[run.py] Added missing settings to config.json")
            
            # 관리자 비밀번호 해시 마이그레이션
            admin_pw = config.get("admin_password", "admin")
            salt = config.get("password_salt", "")
            if not (len(admin_pw) == 64 and all(c in '0123456789abcdef' for c in admin_pw)):
                config["admin_password"] = hashlib.sha256((salt + admin_pw).encode('utf-8')).hexdigest()
                with open(CONFIG_PATH, "w", encoding="utf-8") as f:
                    json.dump(config, f, indent=4)
                print("[run.py] Migrated admin password to SHA-256 hash")
            
            return config
    except Exception as e:
        print(f"[run.py] Failed to read config file, using defaults. Error: {e}")
        return {"port": 8000, "max_upload_size_mb": 100, "admin_password": "admin", "admin_path": "admin", "max_failed_attempts": 10, "password_salt": ""}

# 글로벌 공유 인스턴스 변수
server_thread = None
server_instance = None
window_instance = None
app_should_exit = False

def start_uvicorn(port):
    global server_instance
    import uvicorn
    from app.main import app, set_server_instance
    
    uv_config = uvicorn.Config(
        app=app,
        host="0.0.0.0",  # 로컬 네트워크 내 다른 기기 접속 허용을 위해 0.0.0.0 바인딩
        port=port,
        log_level="info",
        loop="asyncio"
    )
    server_instance = uvicorn.Server(uv_config)
    set_server_instance(server_instance)
    
    try:
        server_instance.run()
    except Exception as e:
        print(f"[Uvicorn Thread] Web server error: {e}")

def server_management_loop():
    global server_thread, window_instance, app_should_exit, server_instance
    
    current_port = None
    
    while not app_should_exit:
        config = load_config()
        port = config.get("port", 8000)
        
        # 포트 설정이 변경되었거나 서버가 최초로 시작될 때
        if current_port != port:
            if server_instance:
                print(f"[run.py] Configuration change detected. Stopping current server on port {current_port}...")
                server_instance.should_exit = True
                if server_thread:
                    server_thread.join(timeout=3)
            
            print(f"[run.py] Starting server thread on port {port}...")
            current_port = port
            server_thread = threading.Thread(target=start_uvicorn, args=(port,), daemon=True)
            server_thread.start()
            
            # 서버 바인딩 대기
            time.sleep(1.5)
            
            # GUI 웹뷰 창이 열려있는 상태라면, 새로운 포트로 웹뷰 갱신
            if window_instance:
                new_url = f"http://127.0.0.1:{port}"
                print(f"[run.py] Loading new GUI URL: {new_url}")
                try:
                    window_instance.load_url(new_url)
                except Exception as e:
                    print(f"[run.py] Failed to load new url in webview: {e}")
        
        # Uvicorn 서버 객체의 종료 여부 감시
        if server_instance and server_instance.should_exit:
            # 만약 사용자가 완전히 창을 닫아 종료를 원한 거라면 루프 즉시 탈출
            if getattr(server_instance, "should_exit_permanently", False):
                break
            # 설정값 업데이트 대기
            time.sleep(0.5)
            continue
            
        time.sleep(1)

def on_closed():
    global app_should_exit, server_instance
    print("[run.py] GUI window closed by user. Terminating process...")
    app_should_exit = True
    if server_instance:
        server_instance.should_exit = True
        server_instance.should_exit_permanently = True

def main():
    global window_instance
    
    # 패키지 임포트 보장
    if RUNNING_DIR not in sys.path:
        sys.path.insert(0, RUNNING_DIR)
        
    config = load_config()
    port = config.get("port", 8000)
    
    # 서버 관리 스레드 기동
    mgmt_thread = threading.Thread(target=server_management_loop, daemon=True)
    mgmt_thread.start()
    
    # 서버 기동 대기
    time.sleep(1.5)
    
    # pywebview 클라이언트 윈도우 생성
    print("[run.py] Creating Webview window...")
    window_instance = webview.create_window(
        title="Simple File Share",
        url=f"http://127.0.0.1:{port}",
        width=980,
        height=720,
        min_size=(800, 600)
    )
    
    # 창 닫힘 이벤트에 콜백 바인딩
    window_instance.events.closed += on_closed
    
    # GUI 메인 루프 가동 (메인 스레드 블로킹)
    webview.start()

if __name__ == "__main__":
    main()
