document.addEventListener('DOMContentLoaded', () => {
    // 1. URL 기반 라우팅 처리
    const pathname = window.location.pathname.replace(/^\/|\/$/g, '');
    const containerId = pathname;

    const landingView = document.getElementById('landing-view');
    const appView = document.getElementById('app-view');

    // Landing View UI
    const shareIdInput = document.getElementById('share-id-input');
    const btnJoinShare = document.getElementById('btn-join-share');

    if (!containerId) {
        // 랜딩 페이지
        landingView.style.display = 'block';
        appView.style.display = 'none';

        const joinRoom = () => {
            const targetId = shareIdInput.value.trim();
            if (targetId) {
                window.location.href = `/${targetId}`;
            }
        };

        btnJoinShare.addEventListener('click', joinRoom);
        shareIdInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') joinRoom();
        });

        (async () => {
            try {
                const res = await fetch('/api/share/rooms');
                if (!res.ok) return;
                const data = await res.json();
                if (!data.rooms || data.rooms.length === 0) return;

                const section = document.getElementById('share-rooms-section');
                const listEl = document.getElementById('share-rooms-list');
                const pathEl = document.getElementById('share-path-display');
                section.style.display = 'block';
                pathEl.textContent = data.share_path;

                data.rooms.forEach(room => {
                    const btn = document.createElement('button');
                    btn.className = 'btn btn-block';
                    btn.style.cssText = 'text-align: left; display: flex; justify-content: space-between; align-items: center;';
                    const label = room.label || room.id;
                    btn.innerHTML = `<span>${label}</span><span style="color: var(--ink-muted-48); font-size: 0.85rem;">${room.file_count}개 파일</span>`;
                    btn.addEventListener('click', () => { window.location.href = `/${encodeURIComponent(room.id)}`; });
                    listEl.appendChild(btn);
                });
            } catch (e) {
                console.error('Failed to load share rooms', e);
            }
        })();

        return; // 메인 앱 초기화 중단
    } else {
        // 컨테이너 페이지
        landingView.style.display = 'none';
        appView.style.display = 'block';
    }

    // --- 이하 메인 앱 뷰 초기화 ---

    // DOM Element References
    const tabs = document.querySelectorAll('.nav-tab');
    const panels = document.querySelectorAll('.tab-panel');
    const fileInput = document.getElementById('file-input');
    const dropZone = document.getElementById('drop-zone');
    const fileListBody = document.getElementById('file-list-body');
    const refreshFilesBtn = document.getElementById('btn-refresh-files');
    const progressContainer = document.getElementById('progress-container');
    const progressFilename = document.getElementById('progress-filename');
    const progressPercentage = document.getElementById('progress-percentage');
    const progressBarFill = document.getElementById('progress-bar-fill');
    
    const logConsole = document.getElementById('log-console');
    const clearLogsBtn = document.getElementById('btn-clear-logs');
    
    // Auth & Settings DOM Elements
    const settingsLockOverlay = document.getElementById('settings-lock-overlay');
    const settingsContentCard = document.getElementById('settings-content-card');
    const adminAuthPasswordInput = document.getElementById('admin-auth-password');
    const authErrorMsg = document.getElementById('auth-error-msg');
    const btnSubmitAuth = document.getElementById('btn-submit-auth');
    
    const settingsForm = document.getElementById('settings-form');
    const settingsPort = document.getElementById('settings-port');
    const settingsLimit = document.getElementById('settings-upload-limit');
    const settingsPassword = document.getElementById('settings-password');
    const settingsPasswordConfirm = document.getElementById('settings-password-confirm');
    const passwordConfirmErrorMsg = document.getElementById('password-confirm-error-msg');
    
    const restartOverlay = document.getElementById('restart-overlay');
    const restartTimer = document.getElementById('restart-timer');
    const countdownRedirectUrl = document.getElementById('countdown-redirect-url');
    const toast = document.getElementById('toast');

    // Container Specific Elements
    const containerAuthOverlay = document.getElementById('container-auth-overlay');
    const containerAuthPassword = document.getElementById('container-auth-password');
    const containerAuthErrorMsg = document.getElementById('container-auth-error-msg');
    const btnSubmitContainerAuth = document.getElementById('btn-submit-container-auth');
    const btnCancelContainerAuth = document.getElementById('btn-cancel-container-auth');
    const btnUnlockFiles = document.getElementById('btn-unlock-files');
    const uploadProtectedCheck = document.getElementById('upload-protected');

    // Admin Rooms Elements
    const tabBtnAdminRooms = document.getElementById('tab-btn-admin-rooms');
    const tabBtnLogs = document.getElementById('tab-btn-logs');
    const tabBtnSettings = document.getElementById('tab-btn-settings');
    const adminRoomsBody = document.getElementById('admin-rooms-body');
    const adminFilesBody = document.getElementById('admin-files-body');
    const btnRefreshAdminRooms = document.getElementById('btn-refresh-admin-rooms');
    const adminFileInput = document.getElementById('admin-file-input');
    const adminDropZone = document.getElementById('admin-drop-zone');
    const adminTargetRoomId = document.getElementById('admin-target-room-id');
    const adminUploadProtected = document.getElementById('admin-upload-protected');
    const settingsAdminPath = document.getElementById('settings-admin-path');
    const settingsMaxFailed = document.getElementById('settings-max-failed');
    const settingsSalt = document.getElementById('settings-salt');
    const btnRoomSettings = document.getElementById('btn-room-settings');
    const btnShowQr = document.getElementById('btn-show-qr');
    const roomAuthIndicator = document.getElementById('room-auth-indicator');
    const btnLogout = document.getElementById('btn-logout');
    const readmeContainer = document.getElementById('readme-container');
    const readmeBody = document.getElementById('readme-body');
    const readmeFilename = document.getElementById('readme-filename');

    // Global Config & Security State
    let currentSettings = { port: 8000, max_upload_size_mb: 100 };
    let logIntervalId = null;
    let containerPasswordCache = sessionStorage.getItem(`pw_${containerId}`) || ''; 
    let adminPasswordCache = sessionStorage.getItem('admin_pw') || '';
    let isRoomPublic = false;
    let isAuthenticated = adminPasswordCache !== '';
    let currentFolderPath = ''; 
    let currentFilesPage = 1;
    let currentAdminRoomsPage = 1;
    let currentAdminFilesPage = 1;
    
    let authTimerInterval = null;
    const authTimerEl = document.getElementById('auth-timer');

    if (containerPasswordCache && !sessionStorage.getItem(`pw_expire_${containerId}`)) {
        sessionStorage.setItem(`pw_expire_${containerId}`, Date.now() + 60 * 60 * 1000);
    }
    if (adminPasswordCache && !sessionStorage.getItem('admin_expire')) {
        sessionStorage.setItem('admin_expire', Date.now() + 60 * 60 * 1000);
    }

    function startAuthTimer() {
        if (authTimerInterval) clearInterval(authTimerInterval);
        if (!authTimerEl) return;
        
        let expireKey = adminPasswordCache ? 'admin_expire' : (containerPasswordCache ? `pw_expire_${containerId}` : null);
        if (!expireKey) {
            authTimerEl.style.display = 'none';
            return;
        }

        authTimerEl.style.display = 'inline-block';
        
        authTimerInterval = setInterval(() => {
            let expireTime = parseInt(sessionStorage.getItem(expireKey) || '0', 10);
            if (!expireTime) {
                clearInterval(authTimerInterval);
                return;
            }
            
            let now = Date.now();
            let remaining = expireTime - now;
            
            if (remaining <= 0) {
                clearInterval(authTimerInterval);
                performLogout();
                alert('인증 시간이 만료되어 로그아웃 되었습니다.');
            } else {
                let m = Math.floor(remaining / 60000);
                let s = Math.floor((remaining % 60000) / 1000);
                authTimerEl.textContent = `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
            }
        }, 1000);
    }
    
    if (containerPasswordCache || adminPasswordCache) {
        startAuthTimer();
    }

    /* ==========================================================================
       Tab Navigation & Access Control
       ========================================================================== */
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const targetTab = tab.getAttribute('data-tab');
            
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            
            panels.forEach(panel => {
                panel.classList.remove('active');
                if (panel.getAttribute('id') === `tab-${targetTab}`) {
                    panel.classList.add('active');
                }
            });

            if (targetTab === 'logs') {
                fetchLogs();
                if (!logIntervalId) {
                    logIntervalId = setInterval(fetchLogs, 2000);
                }
            } else {
                if (logIntervalId) {
                    clearInterval(logIntervalId);
                    logIntervalId = null;
                }
            }

            if (targetTab === 'settings') {
                if (!isAuthenticated) {
                    settingsLockOverlay.style.display = 'flex';
                    settingsContentCard.style.display = 'none';
                    adminAuthPasswordInput.focus();
                } else {
                    settingsLockOverlay.style.display = 'none';
                    settingsContentCard.style.display = 'block';
                    loadSettings();
                }
            }

            if (targetTab === 'admin-rooms') {
                if (isAuthenticated) {
                    fetchAdminData();
                }
            }
        });
    });

    /* ==========================================================================
       Helper Functions (Formatters & Notifications)
       ========================================================================== */
    function formatBytes(bytes, decimals = 2) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
    }

    function showToast(message) {
        toast.textContent = message;
        toast.classList.add('show');
        setTimeout(() => {
            toast.classList.remove('show');
        }, 3000);
    }

    /* ==========================================================================
       Container Authentication
       ========================================================================== */
    btnUnlockFiles.addEventListener('click', () => {
        if (containerPasswordCache || isAuthenticated) {
            performLogout();
        } else {
            containerAuthOverlay.style.display = 'flex';
            containerAuthPassword.value = '';
            containerAuthPassword.focus();
        }
    });

    btnCancelContainerAuth.addEventListener('click', () => {
        containerAuthOverlay.style.display = 'none';
        containerAuthErrorMsg.style.display = 'none';
    });

    async function submitContainerAuth() {
        const password = containerAuthPassword.value;
        try {
            const response = await fetch(`/api/container/${containerId}/auth`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: password })
            });

            if (response.ok) {
                containerPasswordCache = password;
                sessionStorage.setItem(`pw_${containerId}`, password);
                containerAuthOverlay.style.display = 'none';
                containerAuthErrorMsg.style.display = 'none';
                showToast('방 인증에 성공했습니다.');
                if (btnUnlockFiles) {
                    btnUnlockFiles.innerHTML = '<span class="material-icons-outlined" style="color: #34c759;">lock_open</span><span style="color: #34c759; font-weight: bold;">인증됨</span>';
                    btnUnlockFiles.disabled = false;
                }
                if (btnRoomSettings) {
                    btnRoomSettings.style.color = '';
                    btnRoomSettings.style.opacity = '1';
                    btnRoomSettings.style.cursor = 'pointer';
                }
                const btnNewFolder = document.getElementById('btn-new-folder');
                if (btnNewFolder) {
                    btnNewFolder.style.color = '';
                    btnNewFolder.style.opacity = '1';
                    btnNewFolder.style.cursor = 'pointer';
                }
                if (roomAuthIndicator) {
                    roomAuthIndicator.style.display = 'inline-flex';
                    roomAuthIndicator.innerHTML = '<span class="material-icons-outlined" style="font-size: 14px;">verified_user</span>방 관리자';
                }
                if (btnLogout) btnLogout.style.display = 'inline-block';
                fetchFiles();
            } else {
                containerAuthErrorMsg.style.display = 'block';
                containerAuthPassword.focus();
            }
        } catch (error) {
            console.error(error);
            alert('인증 중 오류가 발생했습니다.');
        }
    }

    btnSubmitContainerAuth.addEventListener('click', submitContainerAuth);
    containerAuthPassword.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') submitContainerAuth();
    });


    /* ==========================================================================
       Admin Authentication
       ========================================================================== */
    async function submitAuthentication() {
        const password = adminAuthPasswordInput.value;
        if (!password) return;

        try {
            const response = await fetch('/api/admin/verify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: password })
            });

            if (response.ok) {
                isAuthenticated = true;
                adminPasswordCache = password;
                sessionStorage.setItem('admin_pw', password);
                sessionStorage.setItem('admin_expire', Date.now() + 60 * 60 * 1000);
                startAuthTimer();
                authErrorMsg.style.display = 'none';
                settingsLockOverlay.style.display = 'none';
                settingsContentCard.style.display = 'block';
                if (tabBtnAdminRooms) tabBtnAdminRooms.style.display = 'inline-block';
                showToast('관리자 인증에 성공했습니다.');
                if (btnRoomSettings) {
                    btnRoomSettings.style.color = '';
                    btnRoomSettings.style.opacity = '1';
                    btnRoomSettings.style.cursor = 'pointer';
                }
                const btnNewFolder = document.getElementById('btn-new-folder');
                if (btnNewFolder) {
                    btnNewFolder.style.color = '';
                    btnNewFolder.style.opacity = '1';
                    btnNewFolder.style.cursor = 'pointer';
                }
                if (roomAuthIndicator) {
                    roomAuthIndicator.style.display = 'inline-flex';
                    roomAuthIndicator.innerHTML = '<span class="material-icons-outlined" style="font-size: 14px;">admin_panel_settings</span>전체 관리자';
                }
                if (btnUnlockFiles) {
                    btnUnlockFiles.innerHTML = '<span class="material-icons-outlined" style="color: #34c759;">lock_open</span><span style="color: #34c759; font-weight: bold;">인증됨</span>';
                    btnUnlockFiles.disabled = false;
                }
                if (btnLogout) btnLogout.style.display = 'inline-block';
                loadSettings();
            } else {
                authErrorMsg.style.display = 'block';
                adminAuthPasswordInput.value = '';
                adminAuthPasswordInput.focus();
                setTimeout(() => {
                    authErrorMsg.style.display = 'none';
                }, 4000);
            }
        } catch (error) {
            console.error(error);
            alert('인증 중 서버 오류가 발생했습니다.');
        }
    }

    btnSubmitAuth.addEventListener('click', submitAuthentication);
    adminAuthPasswordInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') submitAuthentication();
    });

    const btnLockAdmin = document.getElementById('btn-lock-admin');
    if (btnLockAdmin) {
        btnLockAdmin.addEventListener('click', () => {
            isAuthenticated = false;
            adminPasswordCache = '';
            settingsContentCard.style.display = 'none';
            settingsLockOverlay.style.display = 'flex';
            adminAuthPasswordInput.value = '';
            if (tabBtnAdminRooms) tabBtnAdminRooms.style.display = 'none';
            if (document.querySelector('.nav-tab.active') && document.querySelector('.nav-tab.active').getAttribute('data-tab') === 'admin-rooms') {
                document.querySelector('.nav-tab[data-tab="files"]').click();
            }
            showToast('관리자 메뉴가 다시 잠겼습니다.');
        });
    }

    /* ==========================================================================
       Global Admin Management Functions
       ========================================================================== */
    async function fetchAdminData(roomsPage, filesPage) {
        if (!isAuthenticated) return;
        if (roomsPage !== undefined) currentAdminRoomsPage = roomsPage;
        if (filesPage !== undefined) currentAdminFilesPage = filesPage;
        
        try {
            // Fetch Containers
            const resContainers = await fetch(`/api/admin/containers?page=${currentAdminRoomsPage}&page_size=50`, { headers: { 'X-Admin-Password': adminPasswordCache }});
            if (resContainers.ok) {
                const data = await resContainers.json();
                const containers = data.items || data;
                const totalPages = data.total_pages || 1;
                renderAdminRooms(containers);
                renderPagination('admin-rooms-pagination', currentAdminRoomsPage, totalPages, fetchAdminRoomsPage);
            }
            
            // Fetch All Files
            const resFiles = await fetch(`/api/admin/files?page=${currentAdminFilesPage}&page_size=50`, { headers: { 'X-Admin-Password': adminPasswordCache }});
            if (resFiles.ok) {
                const data = await resFiles.json();
                const files = data.items || data;
                const totalPages = data.total_pages || 1;
                renderAdminFiles(files);
                renderPagination('admin-files-pagination', currentAdminFilesPage, totalPages, fetchAdminFilesPage);
            }
        } catch (e) {
            console.error('Failed to load admin data:', e);
            showToast('관리자 데이터 로드 실패');
        }
    }

    function fetchAdminRoomsPage(page) {
        fetchAdminData(page, undefined);
    }

    function fetchAdminFilesPage(page) {
        fetchAdminData(undefined, page);
    }

    function renderAdminRooms(containers) {
        if (!adminRoomsBody) return;
        if (containers.length === 0) {
            adminRoomsBody.innerHTML = `<tr><td colspan="5" class="empty-state">개설된 방이 없습니다.</td></tr>`;
            return;
        }
        
        adminRoomsBody.innerHTML = containers.map(c => `
            <tr>
                <td style="font-weight: 600;">
                    <a href="/${c.id}" style="text-decoration: none; color: var(--primary);">${escapeHtml(c.id)}</a>
                </td>
                <td class="text-center">${c.has_password ? '<span class="material-icons-outlined" style="font-size:16px; color:#ff9f0a; vertical-align:middle;" title="보호됨">lock</span>' : '<span style="color:var(--ink-muted-48)">없음</span>'}</td>
                <td class="text-right">${c.file_count}</td>
                <td class="text-right">${formatBytes(c.total_size)}</td>
                <td class="text-center">
                    <button class="btn-icon btn-danger-icon" onclick="deleteAdminContainer('${c.id}')" title="방과 모든 파일 강제 삭제">
                        <span class="material-icons-outlined">delete_forever</span>
                    </button>
                </td>
            </tr>
        `).join('');
    }

    function renderAdminFiles(files) {
        if (!adminFilesBody) return;
        if (files.length === 0) {
            adminFilesBody.innerHTML = `<tr><td colspan="4" class="empty-state">파일이 없습니다.</td></tr>`;
            return;
        }
        
        adminFilesBody.innerHTML = files.map(f => {
            const lockIcon = f.is_protected ? '<span class="material-icons-outlined" style="font-size:14px; color:#ff9f0a; margin-right:4px; vertical-align:middle;">lock</span>' : '';
            const typeIcon = f.is_directory ? '<span class="material-icons-outlined" style="font-size:16px; color:var(--primary); margin-right:4px; vertical-align:middle;">folder</span>' : '';
            const displayPath = f.folder_path ? `<span style="color:var(--ink-muted-48)">${escapeHtml(f.folder_path)} / </span>` : '';
            const sizeStr = f.is_directory ? '-' : formatBytes(f.file_size);
            
            return `
            <tr>
                <td><span style="background:var(--surface-pearl); padding: 2px 6px; border-radius: 4px; font-size:12px; border:1px solid var(--hairline);">${escapeHtml(f.container_id)}</span></td>
                <td><div style="display:flex; align-items:center;">${lockIcon}${typeIcon}${displayPath}${escapeHtml(f.original_name)}</div></td>
                <td class="text-right">${sizeStr}</td>
                <td class="text-right">${f.is_directory ? '-' : f.download_count}</td>
            </tr>
        `}).join('');
    }

    window.deleteAdminContainer = async function(id) {
        if (!confirm(`정말로 '${id}' 방과 그 안의 모든 파일을 완전히 삭제하시겠습니까?`)) return;
        
        try {
            const response = await fetch(`/api/admin/containers/${id}`, {
                method: 'DELETE',
                headers: { 'X-Admin-Password': adminPasswordCache }
            });
            if (response.ok) {
                showToast(`'${id}' 방이 삭제되었습니다.`);
                fetchAdminData();
            } else {
                const err = await response.json();
                alert(`삭제 실패: ${err.detail}`);
            }
        } catch(e) {
            console.error(e);
            alert('삭제 중 오류가 발생했습니다.');
        }
    };

    if (btnRefreshAdminRooms) {
        btnRefreshAdminRooms.addEventListener('click', fetchAdminData);
    }

    async function adminUploadFiles(files) {
        if (files.length === 0) return;
        const targetId = adminTargetRoomId.value.trim();
        if (!targetId) {
            alert('타겟 방 ID를 입력해주세요.');
            adminTargetRoomId.focus();
            return;
        }
        
        const isProtected = adminUploadProtected.checked;
        progressContainer.style.display = 'flex';
        let successCount = 0;

        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            progressFilename.textContent = `[${i+1}/${files.length}] ${file.name}`;
            progressPercentage.textContent = '0%';
            progressBarFill.style.width = '0%';

            await new Promise((resolve) => {
                const xhr = new XMLHttpRequest();
                xhr.open('POST', `/api/upload/${targetId}`, true);
                if (adminPasswordCache) {
                    xhr.setRequestHeader('x-admin-password', adminPasswordCache);
                }
                
                xhr.upload.onprogress = (e) => {
                    if (e.lengthComputable) {
                        const percent = Math.round((e.loaded / e.total) * 100);
                        progressPercentage.textContent = `${percent}%`;
                        progressBarFill.style.width = `${percent}%`;
                    }
                };

                xhr.onload = () => {
                    if (xhr.status === 200) {
                        successCount++;
                    } else {
                        let errorMsg = '업로드 실패';
                        try {
                            const resJson = JSON.parse(xhr.responseText);
                            errorMsg = resJson.detail || errorMsg;
                        } catch(e) {}
                        alert(`[${file.name}] 실패: ${errorMsg}`);
                    }
                    resolve();
                };

                xhr.onerror = () => {
                    alert(`[${file.name}] 네트워크 오류`);
                    resolve();
                };

                const formData = new FormData();
                formData.append('file', file);
                formData.append('is_protected', isProtected);
                let targetPath = '';
                if (file.customPath && file.customPath.includes('/')) {
                    const parts = file.customPath.split('/');
                    parts.pop();
                    targetPath = parts.join('/');
                }
                formData.append('folder_path', targetPath);
                
                xhr.send(formData);
            });
        }

        progressContainer.style.display = 'none';
        if (successCount > 0) {
            showToast(`'${targetId}' 방에 ${successCount}개 파일 공유 완료`);
            adminUploadProtected.checked = false;
            adminTargetRoomId.value = '';
            fetchAdminData();
        }
    }

    if (adminFileInput) adminFileInput.addEventListener('change', () => adminUploadFiles(adminFileInput.files));
    if (adminDropZone) {
        ['dragenter', 'dragover'].forEach(evt => adminDropZone.addEventListener(evt, (e) => { e.preventDefault(); e.stopPropagation(); adminDropZone.classList.add('dragover'); }, false));
        ['dragleave', 'drop'].forEach(evt => adminDropZone.addEventListener(evt, (e) => { e.preventDefault(); e.stopPropagation(); adminDropZone.classList.remove('dragover'); }, false));
        adminDropZone.addEventListener('drop', async (e) => {
            e.preventDefault();
            const items = e.dataTransfer.items;
            if (items && items.length > 0) {
                let promises = [];
                for (let i = 0; i < items.length; i++) {
                    const item = items[i];
                    if (item.webkitGetAsEntry) {
                        const entry = item.webkitGetAsEntry();
                        if (entry) promises.push(traverseFileTree(entry, ''));
                    } else if (item.getAsFile) {
                        const file = item.getAsFile();
                        if (file) promises.push(Promise.resolve([file]));
                    }
                }
                const results = await Promise.all(promises);
                const allFiles = results.flat().filter(f => f);
                if (allFiles.length > 0) adminUploadFiles(allFiles);
            } else {
                adminUploadFiles(e.dataTransfer.files);
            }
        });
    }

    /* ==========================================================================
       File Share Functions (List, Upload, Download, Delete)
       ========================================================================== */
    const btnNewFolder = document.getElementById('btn-new-folder');
    if (btnNewFolder) {
        btnNewFolder.addEventListener('click', async () => {
            if (btnNewFolder.style.cursor === 'not-allowed') {
                showToast('먼저 방 비밀번호로 인증해주세요.');
                return;
            }
            const folderName = prompt('새 폴더 이름을 입력하세요:');
            if (!folderName || !folderName.trim()) return;
            
            try {
                const formData = new FormData();
                formData.append('folder_name', folderName.trim());
                formData.append('parent_path', currentFolderPath);
                
                const headers = {};
                if (containerPasswordCache) headers['x-container-password'] = containerPasswordCache;
                if (adminPasswordCache) headers['x-admin-password'] = adminPasswordCache;

                const response = await fetch(`/api/folder/${containerId}`, {
                    method: 'POST',
                    headers: headers,
                    body: formData
                });
                
                if (response.ok) {
                    showToast('폴더가 생성되었습니다.');
                    fetchFiles();
                } else {
                    const result = await response.json();
                    alert(`폴더 생성 실패: ${result.detail}`);
                }
            } catch (error) {
                console.error(error);
                alert('폴더 생성 중 오류가 발생했습니다.');
            }
        });
    }

    function updateBreadcrumb() {
        const breadcrumbPath = document.getElementById('breadcrumb-path');
        if (!breadcrumbPath) return;
        
        if (!currentFolderPath) {
            breadcrumbPath.innerHTML = '';
            return;
        }
        
        const parts = currentFolderPath.split('/');
        let html = '';
        let accumPath = '';
        
        parts.forEach((part, index) => {
            if (!part) return;
            accumPath += (accumPath ? '/' : '') + part;
            html += `<span style="color:var(--ink-muted-48)">/</span>`;
            html += `<span style="cursor:pointer; color:var(--primary); text-decoration:none;" onclick="navigateToFolder('${accumPath}')" onmouseover="this.style.textDecoration='underline'" onmouseout="this.style.textDecoration='none'">${escapeHtml(part)}</span>`;
        });
        
        breadcrumbPath.innerHTML = html;
    }
    
    window.navigateToFolder = function(path) {
        currentFolderPath = path;
        updateBreadcrumb();
        fetchFiles();
    };
    
    const breadcrumbHome = document.getElementById('breadcrumb-home');
    if (breadcrumbHome) {
        breadcrumbHome.addEventListener('click', () => {
            navigateToFolder('');
        });
    }

    async function fetchFiles(page = 1) {
        currentFilesPage = page;
        try {
            const headers = {};
            if (containerPasswordCache) {
                headers['x-container-password'] = containerPasswordCache;
            }
            if (adminPasswordCache) {
                headers['x-admin-password'] = adminPasswordCache;
            }
            const response = await fetch(`/api/files/${containerId}?folder_path=${encodeURIComponent(currentFolderPath)}&page=${page}&page_size=50`, { headers });
            if (response.status === 401) {
                if (containerPasswordCache) {
                    containerPasswordCache = '';
                    sessionStorage.removeItem(`pw_${containerId}`);
                }
                containerAuthOverlay.style.display = 'flex';
                return;
            }
            if (!response.ok) throw new Error('파일 목록 로드 실패');
            const data = await response.json();
            // Handle both old (array) and new (paginated) response format
            const files = data.items || data;
            const totalPages = data.total_pages || 1;
            renderFileList(files);
            renderPagination('files-pagination', currentFilesPage, totalPages, fetchFiles);
            updateBreadcrumb();
            fetchReadme();
            
            // Restore UI state if authenticated via cache
            if (isAuthenticated || adminPasswordCache || containerPasswordCache) {
                if (btnRoomSettings) {
                    btnRoomSettings.style.color = '';
                    btnRoomSettings.style.opacity = '1';
                    btnRoomSettings.style.cursor = 'pointer';
                }
                const btnNewFolder = document.getElementById('btn-new-folder');
                if (btnNewFolder) {
                    btnNewFolder.style.color = '';
                    btnNewFolder.style.opacity = '1';
                    btnNewFolder.style.cursor = 'pointer';
                }
                if (btnUnlockFiles) {
                    btnUnlockFiles.innerHTML = '<span class="material-icons-outlined" style="color: #34c759;">lock_open</span><span style="color: #34c759; font-weight: bold;">인증됨</span>';
                    btnUnlockFiles.disabled = false;
                }
                if (btnLogout) btnLogout.style.display = 'inline-block';
            }
            if (isAuthenticated || adminPasswordCache) {
                if (tabBtnAdminRooms) tabBtnAdminRooms.style.display = 'inline-block';
                if (roomAuthIndicator) {
                    roomAuthIndicator.style.display = 'inline-flex';
                    roomAuthIndicator.innerHTML = '<span class="material-icons-outlined" style="font-size: 14px;">admin_panel_settings</span>전체 관리자';
                }
            } else if (containerPasswordCache) {
                if (roomAuthIndicator) {
                    roomAuthIndicator.style.display = 'inline-flex';
                    roomAuthIndicator.innerHTML = '<span class="material-icons-outlined" style="font-size: 14px;">verified_user</span>방 관리자';
                }
            }
            
        } catch (error) {
            console.error(error);
            showToast('파일 목록을 불러오는 중 오류가 발생했습니다.');
        }
    }

    function renderFileList(files) {
        if (files.length === 0) {
            fileListBody.innerHTML = `
                <tr>
                    <td colspan="5" class="empty-state">
                        <span class="material-icons-outlined">info</span>
                        <p>이 폴더는 비어있습니다. 첫 파일을 올려보세요!</p>
                    </td>
                </tr>
            `;
            return;
        }

        const isAuth = isRoomPublic || containerPasswordCache || adminPasswordCache;

        fileListBody.innerHTML = files.map(file => {
            const downloadUrl = `${window.location.origin}/download/${file.id}`;
            const lockIcon = file.is_protected ? '<span class="material-icons-outlined" style="font-size:16px; color:#ff9f0a; vertical-align:middle; margin-right:4px;" title="보호된 파일">lock</span>' : '';
            
            if (file.is_directory) {
                const targetPath = file.folder_path ? `${file.folder_path}/${file.original_name}` : file.original_name;
                const moveBtn = isAuth 
                    ? `<button class="btn-icon" onclick="moveFile('${file.id}')" title="이동"><span class="material-icons-outlined">drive_file_move</span></button>` 
                    : `<button class="btn-icon" style="color: var(--ink-muted-48); cursor: not-allowed;" title="이동 (인증 필요)"><span class="material-icons-outlined">drive_file_move</span></button>`;
                const deleteBtn = isAuth
                    ? `<button class="btn-icon btn-danger-icon" onclick="deleteFile('${file.id}')" title="폴더 삭제"><span class="material-icons-outlined">delete</span></button>`
                    : `<button class="btn-icon" style="color: var(--ink-muted-48); cursor: not-allowed;" title="삭제 (인증 필요)"><span class="material-icons-outlined">delete</span></button>`;
                return `
                <tr>
                    <td>
                        <div style="font-weight: 600; color: var(--ink); display: flex; align-items: center; cursor: pointer;" onclick="navigateToFolder('${escapeHtml(targetPath)}')">
                            <span class="material-icons-outlined" style="color:var(--primary); margin-right:8px; font-size:24px;">folder</span>
                            ${escapeHtml(file.original_name)}
                        </div>
                    </td>
                    <td style="color:var(--ink-muted-48);">-</td>
                    <td style="color: var(--ink-muted-80);">${file.upload_time}</td>
                    <td class="text-center" style="font-weight: 600;">-</td>
                    <td>
                        <div class="action-group">
                            ${moveBtn}
                            ${deleteBtn}
                        </div>
                    </td>
                </tr>
                `;
            } else {
                const protectToggle = isAuth ? 
                    `<label class="toggle-switch" title="보호 상태 변경">
                        <input type="checkbox" ${file.is_protected ? 'checked' : ''} onchange="toggleProtect('${file.id}', this.checked)">
                        <span class="toggle-slider"></span>
                    </label>` :
                    (file.is_protected ? '<span class="material-icons-outlined" style="font-size:16px; color:#ff9f0a;">lock</span>' : '<span class="material-icons-outlined" style="font-size:16px; color:var(--ink-muted-48);">lock_open</span>');
                const moveBtn = isAuth 
                    ? `<button class="btn-icon" onclick="moveFile('${file.id}')" title="이동"><span class="material-icons-outlined">drive_file_move</span></button>` 
                    : `<button class="btn-icon" style="color: var(--ink-muted-48); cursor: not-allowed;" title="이동 (인증 필요)"><span class="material-icons-outlined">drive_file_move</span></button>`;
                const deleteBtn = isAuth
                    ? `<button class="btn-icon btn-danger-icon" onclick="deleteFile('${file.id}')" title="파일 삭제"><span class="material-icons-outlined">delete</span></button>`
                    : `<button class="btn-icon" style="color: var(--ink-muted-48); cursor: not-allowed;" title="삭제 (인증 필요)"><span class="material-icons-outlined">delete</span></button>`;
                return `
                <tr>
                    <td>
                        <div style="font-weight: 600; color: var(--ink); display: flex; align-items: center;">
                            <span class="material-icons-outlined" style="color:var(--ink-muted-48); margin-right:8px; font-size:20px;">insert_drive_file</span>
                            ${lockIcon}
                            ${escapeHtml(file.original_name)}
                        </div>
                    </td>
                    <td>${formatBytes(file.file_size)}</td>
                    <td style="color: var(--ink-muted-80);">${file.upload_time}</td>
                    <td class="text-center">${protectToggle}</td>
                    <td>
                        <div class="action-group">
                            <button class="btn-icon" onclick="copyToClipboard('${downloadUrl}')" title="다운로드 링크 복사">
                                <span class="material-icons-outlined">content_copy</span>
                            </button>
                            <button class="btn-icon" onclick="downloadFile('${file.id}', decodeURIComponent('${encodeURIComponent(file.original_name)}'))" title="다운로드">
                                <span class="material-icons-outlined">download</span>
                            </button>
                            ${moveBtn}
                            ${deleteBtn}
                        </div>
                    </td>
                </tr>
                `;
            }
        }).join('');
    }

    function escapeHtml(str) {
        return str.replace(/[&<>'"]/g, 
            tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
        );
    }

    window.copyToClipboard = function(text) {
        navigator.clipboard.writeText(text).then(() => {
            showToast('다운로드 링크가 클립보드에 복사되었습니다.');
        }).catch(err => {
            console.error('클립보드 복사 실패: ', err);
            showToast('링크 복사에 실패했습니다.');
        });
    };

    window.downloadFile = async function(fileId, originalName) {
        try {
            const headers = {};
            if (containerPasswordCache) headers['x-container-password'] = containerPasswordCache;
            if (adminPasswordCache) headers['x-admin-password'] = adminPasswordCache;
            
            showToast('파일을 다운로드 중입니다...');
            const response = await fetch(`/download/${fileId}`, { headers });
            
            if (response.ok) {
                const blob = await response.blob();
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = originalName;
                document.body.appendChild(a);
                a.click();
                a.remove();
                window.URL.revokeObjectURL(url);
                fetchFiles();
            } else {
                if (response.status === 401) {
                    showToast('권한이 없습니다. 방 비밀번호를 인증하세요.');
                } else {
                    showToast('파일 다운로드에 실패했습니다.');
                }
            }
        } catch (e) {
            console.error('Download error:', e);
            showToast('네트워크 오류가 발생했습니다.');
        }
    };

    window.deleteFile = async function(fileId) {
        if (!confirm('정말로 이 파일을 삭제하시겠습니까?')) return;
        try {
            const headers = {};
            if (containerPasswordCache) headers['x-container-password'] = containerPasswordCache;
            if (adminPasswordCache) headers['x-admin-password'] = adminPasswordCache;

            const response = await fetch(`/api/files/${containerId}/${fileId}`, { 
                method: 'DELETE',
                headers: headers
            });
            const result = await response.json();
            if (response.ok) {
                showToast('파일이 정상적으로 삭제되었습니다.');
                fetchFiles(currentFilesPage);
            } else {
                throw new Error(result.detail || '삭제 실패');
            }
        } catch (error) {
            console.error(error);
            showToast(`오류: ${error.message}`);
        }
    };

    async function uploadFiles(files) {
        if (files.length === 0) return;
        
        const isProtected = uploadProtectedCheck.checked;
        if (isProtected && !containerPasswordCache && !adminPasswordCache) {
            alert('보호된 파일을 올리려면 먼저 방 비밀번호 인증을 해야 합니다.');
            btnUnlockFiles.click(); // 모달 띄우기
            return;
        }

        progressContainer.style.display = 'flex';
        let successCount = 0;

        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const maxLimitBytes = (currentSettings.max_upload_size_mb || 100) * 1024 * 1024;
            if (file.size > maxLimitBytes) {
                alert(`[${file.name}] 파일 크기가 제한(${currentSettings.max_upload_size_mb || 100}MB)을 초과합니다.`);
                continue;
            }

            progressFilename.textContent = `[${i+1}/${files.length}] ${file.name}`;
            progressPercentage.textContent = '0%';
            progressBarFill.style.width = '0%';

            await new Promise((resolve) => {
                const xhr = new XMLHttpRequest();
                xhr.open('POST', `/api/upload/${containerId}`, true);
                
                if (containerPasswordCache) {
                    xhr.setRequestHeader('x-container-password', containerPasswordCache);
                }
                if (adminPasswordCache) {
                    xhr.setRequestHeader('x-admin-password', adminPasswordCache);
                }

                xhr.upload.onprogress = (e) => {
                    if (e.lengthComputable) {
                        const percent = Math.round((e.loaded / e.total) * 100);
                        progressPercentage.textContent = `${percent}%`;
                        progressBarFill.style.width = `${percent}%`;
                    }
                };

                xhr.onload = () => {
                    if (xhr.status === 200) {
                        successCount++;
                    } else {
                        let errorMsg = '업로드 중 오류 발생';
                        try {
                            const resJson = JSON.parse(xhr.responseText);
                            errorMsg = resJson.detail || errorMsg;
                        } catch(e) {}
                        alert(`[${file.name}] 업로드 실패: ${errorMsg}`);
                    }
                    resolve();
                };

                xhr.onerror = () => {
                    alert(`[${file.name}] 네트워크 오류로 파일 업로드에 실패했습니다.`);
                    resolve();
                };

                const formData = new FormData();
                formData.append('file', file);
                formData.append('is_protected', isProtected);
                let targetPath = currentFolderPath;
                if (file.customPath && file.customPath.includes('/')) {
                    const parts = file.customPath.split('/');
                    parts.pop();
                    const subPath = parts.join('/');
                    targetPath = targetPath ? `${targetPath}/${subPath}` : subPath;
                }
                formData.append('folder_path', targetPath);
                
                xhr.send(formData);
            });
        }
        
        progressContainer.style.display = 'none';
        if (successCount > 0) {
            showToast(`${successCount}개의 파일이 성공적으로 업로드되었습니다.`);
            uploadProtectedCheck.checked = false; // 리셋
            fetchFiles(1);
        }
    }

    async function traverseFileTree(item, path) {
        return new Promise((resolve) => {
            if (item.isFile) {
                item.file(file => {
                    file.customPath = path + file.name;
                    resolve([file]);
                });
            } else if (item.isDirectory) {
                const dirReader = item.createReader();
                let entries = [];
                const readEntries = () => {
                    dirReader.readEntries(async (results) => {
                        if (!results.length) {
                            const promises = entries.map(e => traverseFileTree(e, path + item.name + '/'));
                            const filesArrays = await Promise.all(promises);
                            resolve(filesArrays.flat());
                        } else {
                            entries = entries.concat(Array.from(results));
                            readEntries();
                        }
                    }, (error) => {
                        console.error(error);
                        resolve([]);
                    });
                };
                readEntries();
            } else {
                resolve([]);
            }
        });
    }

    ['dragenter', 'dragover'].forEach(eventName => {
        dropZone.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropZone.classList.add('dragover');
        }, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropZone.classList.remove('dragover');
        }, false);
    });

    dropZone.addEventListener('drop', async (e) => {
        const items = e.dataTransfer.items;
        if (items && items.length > 0) {
            let promises = [];
            for (let i = 0; i < items.length; i++) {
                const item = items[i];
                if (item.webkitGetAsEntry) {
                    const entry = item.webkitGetAsEntry();
                    if (entry) promises.push(traverseFileTree(entry, ''));
                } else if (item.getAsFile) {
                    const file = item.getAsFile();
                    if (file) promises.push(Promise.resolve([file]));
                }
            }
            const results = await Promise.all(promises);
            const allFiles = results.flat().filter(f => f);
            if (allFiles.length > 0) uploadFiles(allFiles);
        } else {
            uploadFiles(e.dataTransfer.files);
        }
    });

    fileInput.addEventListener('change', () => {
        uploadFiles(fileInput.files);
    });

    refreshFilesBtn.addEventListener('click', fetchFiles);

    /* ==========================================================================
       Terminal Server Logs
       ========================================================================== */
    async function fetchLogs() {
        try {
            const response = await fetch('/api/logs');
            if (!response.ok) return;
            const logLines = await response.json();
            
            const isScrolledToBottom = logConsole.scrollHeight - logConsole.clientHeight <= logConsole.scrollTop + 50;
            
            logConsole.innerHTML = logLines.map(line => {
                let logClass = 'info';
                if (line.includes(' WARNING ') || line.includes('WARNING:')) logClass = 'warning';
                else if (line.includes(' ERROR ') || line.includes('ERROR:') || line.includes('[ERROR]')) logClass = 'error';
                
                return `<div class="log-line ${logClass}">${escapeHtml(line)}</div>`;
            }).join('');

            if (isScrolledToBottom) {
                logConsole.scrollTop = logConsole.scrollHeight;
            }
        } catch (error) {
            console.error('로그 조회 실패:', error);
        }
    }

    clearLogsBtn.addEventListener('click', () => {
        logConsole.innerHTML = '';
        showToast('화면상의 로그를 비웠습니다.');
    });

    /* ==========================================================================
       Settings & Restart Configuration
       ========================================================================== */
    async function loadSettings() {
        try {
            const response = await fetch('/api/settings', {
                headers: { 'X-Admin-Password': adminPasswordCache }
            });
            if (!response.ok) throw new Error();
            currentSettings = await response.json();
            settingsPort.value = currentSettings.port;
            settingsLimit.value = currentSettings.max_upload_size_mb;
            if (settingsAdminPath) settingsAdminPath.value = currentSettings.admin_path || 'admin';
            if (settingsMaxFailed) settingsMaxFailed.value = currentSettings.max_failed_attempts || 10;
            if (settingsSalt) settingsSalt.value = currentSettings.password_salt || '';
            settingsPassword.value = '';
            settingsPasswordConfirm.value = '';
            passwordConfirmErrorMsg.style.display = 'none';
        } catch (error) {
            console.error('설정 로드 실패');
            showToast('설정을 읽어오는데 실패했습니다. 재인증이 필요할 수 있습니다.');
            isAuthenticated = false;
            adminPasswordCache = '';
            settingsLockOverlay.style.display = 'flex';
            settingsContentCard.style.display = 'none';
        }
    }

    settingsForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const newPort = parseInt(settingsPort.value);
        const newLimit = parseInt(settingsLimit.value);
        const newPasswordVal = settingsPassword.value.trim();
        const confirmPasswordVal = settingsPasswordConfirm.value.trim();
        const newAdminPathVal = settingsAdminPath ? settingsAdminPath.value.trim() : 'admin';
        const newMaxFailedVal = settingsMaxFailed ? parseInt(settingsMaxFailed.value) : 10;
        const newSaltVal = settingsSalt ? settingsSalt.value.trim() : '';

        if (newPasswordVal.length > 0) {
            if (newPasswordVal !== confirmPasswordVal) {
                passwordConfirmErrorMsg.style.display = 'block';
                settingsPasswordConfirm.focus();
                return;
            }
        }
        passwordConfirmErrorMsg.style.display = 'none';

        const updatedConfig = {
            port: newPort,
            max_upload_size_mb: newLimit,
            admin_password: newPasswordVal,
            admin_path: newAdminPathVal,
            max_failed_attempts: newMaxFailedVal,
            password_salt: newSaltVal
        };

        try {
            const response = await fetch('/api/settings', {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'X-Admin-Password': adminPasswordCache
                },
                body: JSON.stringify(updatedConfig)
            });
            const result = await response.json();
            
            if (response.ok) {
                if (newPasswordVal.length > 0) {
                    adminPasswordCache = newPasswordVal;
                }

                if (result.status === 'restarting' || currentSettings.admin_path !== newAdminPathVal) {
                    startServerRestartFlow(newPort, newAdminPathVal);
                } else {
                    currentSettings.max_upload_size_mb = newLimit;
                    showToast('설정이 성공적으로 저장되었습니다.');
                    settingsPassword.value = '';
                    settingsPasswordConfirm.value = '';
                }
            } else {
                throw new Error(result.detail || '설정 저장 실패');
            }
        } catch (error) {
            alert(`오류: ${error.message}`);
        }
    });

    function startServerRestartFlow(newPort, newAdminPathVal) {
        const nextUrl = `http://127.0.0.1:${newPort}/${newAdminPathVal || ''}`;
        countdownRedirectUrl.textContent = nextUrl;
        
        let secondsLeft = 5;
        restartTimer.textContent = secondsLeft;
        restartOverlay.classList.add('active');

        const interval = setInterval(() => {
            secondsLeft -= 1;
            restartTimer.textContent = secondsLeft;
            
            if (secondsLeft <= 0) {
                clearInterval(interval);
                window.location.href = nextUrl;
            }
        }, 1000);
    }

    async function fetchServerInfo() {
        try {
            const response = await fetch('/api/server/info');
            if (response.ok) {
                const info = await response.json();
                const shareUrlDisplay = document.getElementById('share-url-display');
                const displayIp = (info.local_ip === '127.0.0.1' || info.local_ip === '0.0.0.0') ? window.location.hostname : info.local_ip;
                shareUrlDisplay.textContent = `접속 주소: http://${displayIp}:${info.port}/${containerId}`;
            }
        } catch (error) {
            console.error('서버 주소 정보 로드 실패:', error);
        }
    }

    /* ==========================================================================
       Initialization
       ========================================================================== */
    fetchFiles();
    fetchServerInfo();

    async function verifyAdminPath() {
        if (adminPasswordCache) {
            if (tabBtnLogs) tabBtnLogs.style.display = 'inline-block';
            if (tabBtnSettings) tabBtnSettings.style.display = 'inline-block';
            return;
        }
        
        try {
            const res = await fetch(`/api/verify_path/${containerId}`);
            if (res.ok) {
                const data = await res.json();
                if (data.is_admin) {
                    if (tabBtnLogs) tabBtnLogs.style.display = 'inline-block';
                    if (tabBtnSettings) tabBtnSettings.style.display = 'inline-block';
                    
                    if (btnUnlockFiles && !containerPasswordCache) {
                        btnUnlockFiles.click();
                    }
                }
            }
        } catch(e) {
            console.error('Failed to verify admin path:', e);
        }
    }
    
    verifyAdminPath();

    // Check if room exists, show setup modal if not
    async function checkRoomExists() {
        try {
            const res = await fetch(`/api/container/${containerId}/info`);
            if (res.ok) {
                const data = await res.json();
                if (!data.exists) {
                    document.getElementById('room-setup-overlay').style.display = 'flex';
                } else if (!data.has_password) {
                    isRoomPublic = true;
                    if (btnRoomSettings) {
                        btnRoomSettings.style.color = '';
                        btnRoomSettings.style.opacity = '1';
                        btnRoomSettings.style.cursor = 'pointer';
                    }
                    const btnNewFolder = document.getElementById('btn-new-folder');
                    if (btnNewFolder) {
                        btnNewFolder.style.color = '';
                        btnNewFolder.style.opacity = '1';
                        btnNewFolder.style.cursor = 'pointer';
                    }
                    if (btnUnlockFiles) {
                        btnUnlockFiles.style.display = 'none'; // 공개방은 인증버튼 숨김
                    }
                }
            }
        } catch(e) {
            console.error('Failed to check room:', e);
        }
    }
    checkRoomExists();

    // Room setup modal
    const btnCreateRoom = document.getElementById('btn-create-room');
    if (btnCreateRoom) {
        btnCreateRoom.addEventListener('click', async () => {
            const pw = document.getElementById('room-setup-password').value;
            const pwConfirm = document.getElementById('room-setup-password-confirm').value;
            const errorMsg = document.getElementById('room-setup-error-msg');
            
            if (pw && pw !== pwConfirm) {
                errorMsg.textContent = '비밀번호가 일치하지 않습니다.';
                errorMsg.style.display = 'block';
                return;
            }
            errorMsg.style.display = 'none';
            
            try {
                const response = await fetch(`/api/container/${containerId}/auth`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ password: pw })
                });
                if (response.ok) {
                    containerPasswordCache = pw;
                    if (pw) {
                        sessionStorage.setItem(`pw_${containerId}`, pw);
                        sessionStorage.setItem(`pw_expire_${containerId}`, Date.now() + 60 * 60 * 1000);
                        startAuthTimer();
                    }
                    document.getElementById('room-setup-overlay').style.display = 'none';
                    showToast('방이 생성되었습니다.');
                    if (pw) {
                        if (btnUnlockFiles) {
                            btnUnlockFiles.innerHTML = '<span class="material-icons-outlined" style="color: #34c759;">lock_open</span><span style="color: #34c759; font-weight: bold;">인증됨</span>';
                            btnUnlockFiles.disabled = false;
                        }
                        if (btnRoomSettings) {
                            btnRoomSettings.style.color = '';
                            btnRoomSettings.style.opacity = '1';
                            btnRoomSettings.style.cursor = 'pointer';
                        }
                        const btnNewFolder = document.getElementById('btn-new-folder');
                        if (btnNewFolder) {
                            btnNewFolder.style.color = '';
                            btnNewFolder.style.opacity = '1';
                            btnNewFolder.style.cursor = 'pointer';
                        }
                        if (roomAuthIndicator) {
                            roomAuthIndicator.style.display = 'inline-flex';
                            roomAuthIndicator.innerHTML = '<span class="material-icons-outlined" style="font-size: 14px;">verified_user</span>방 관리자';
                        }
                        if (btnLogout) btnLogout.style.display = 'inline-block';
                    }
                    fetchFiles();
                }
            } catch(e) {
                alert('방 생성 중 오류가 발생했습니다.');
            }
        });
    }

    // Room password change
    if (btnRoomSettings) {
        btnRoomSettings.addEventListener('click', () => {
            if (btnRoomSettings.style.cursor === 'not-allowed') {
                showToast('먼저 방 비밀번호로 인증해주세요.');
                return;
            }
            document.getElementById('room-password-overlay').style.display = 'flex';
            document.getElementById('room-pw-current').value = '';
            document.getElementById('room-pw-new').value = '';
            document.getElementById('room-pw-confirm').value = '';
            document.getElementById('room-pw-error-msg').style.display = 'none';
        });
    }

    const btnSaveRoomPw = document.getElementById('btn-save-room-pw');
    if (btnSaveRoomPw) {
        btnSaveRoomPw.addEventListener('click', async () => {
            const current = document.getElementById('room-pw-current').value;
            const newPw = document.getElementById('room-pw-new').value;
            const confirmPw = document.getElementById('room-pw-confirm').value;
            const errorMsg = document.getElementById('room-pw-error-msg');
            
            if (newPw !== confirmPw) {
                errorMsg.textContent = '새 비밀번호가 일치하지 않습니다.';
                errorMsg.style.display = 'block';
                return;
            }
            
            try {
                const headers = { 'Content-Type': 'application/json' };
                if (adminPasswordCache) headers['X-Admin-Password'] = adminPasswordCache;
                
                const response = await fetch(`/api/container/${containerId}/password`, {
                    method: 'PUT',
                    headers,
                    body: JSON.stringify({ current_password: current, new_password: newPw })
                });
                
                if (response.ok) {
                    containerPasswordCache = newPw;
                    sessionStorage.setItem(`pw_${containerId}`, newPw);
                    sessionStorage.setItem(`pw_expire_${containerId}`, Date.now() + 60 * 60 * 1000);
                    startAuthTimer();
                    document.getElementById('room-password-overlay').style.display = 'none';
                    showToast('방 비밀번호가 변경되었습니다.');
                } else {
                    const err = await response.json();
                    errorMsg.textContent = err.detail || '변경 실패';
                    errorMsg.style.display = 'block';
                }
            } catch(e) {
                alert('비밀번호 변경 중 오류가 발생했습니다.');
            }
        });
    }

    const btnCancelRoomPw = document.getElementById('btn-cancel-room-pw');
    if (btnCancelRoomPw) {
        btnCancelRoomPw.addEventListener('click', () => {
            document.getElementById('room-password-overlay').style.display = 'none';
        });
    }

    // QR Code
    const btnCloseQr = document.getElementById('btn-close-qr');
    if (btnShowQr) {
        btnShowQr.addEventListener('click', async () => {
            const qrOverlay = document.getElementById('qr-overlay');
            const qrContainer = document.getElementById('qr-canvas-container');
            const qrUrlText = document.getElementById('qr-url-text');
            
            qrOverlay.style.display = 'flex';
            qrContainer.innerHTML = '';
            
            // Get server info for proper URL
            try {
                const res = await fetch('/api/server/info');
                const info = await res.json();
                const displayIp = (info.local_ip === '127.0.0.1' || info.local_ip === '0.0.0.0') ? window.location.hostname : info.local_ip;
                const url = `http://${displayIp}:${info.port}/${containerId}`;
                qrUrlText.textContent = url;
                
                if (typeof QRCode !== 'undefined') {
                    const canvas = document.createElement('canvas');
                    qrContainer.appendChild(canvas);
                    QRCode.toCanvas(canvas, url, { width: 220, margin: 2 }, function(error) {
                        if (error) console.error(error);
                    });
                }
            } catch(e) {
                qrUrlText.textContent = window.location.href;
            }
        });
    }
    if (btnCloseQr) {
        btnCloseQr.addEventListener('click', () => {
            document.getElementById('qr-overlay').style.display = 'none';
        });
    }

    // Logout Function
    window.performLogout = function() {
        containerPasswordCache = '';
        adminPasswordCache = '';
        isAuthenticated = false;
        sessionStorage.removeItem(`pw_${containerId}`);
        sessionStorage.removeItem('admin_pw');
        sessionStorage.removeItem(`pw_expire_${containerId}`);
        sessionStorage.removeItem('admin_expire');
        
        if (authTimerInterval) clearInterval(authTimerInterval);
        if (authTimerEl) authTimerEl.style.display = 'none';
        
        if (roomAuthIndicator) roomAuthIndicator.style.display = 'none';
        if (btnLogout) btnLogout.style.display = 'none';
        
        if (btnUnlockFiles) {
            btnUnlockFiles.style.display = 'inline-flex';
            btnUnlockFiles.innerHTML = '<span class="material-icons-outlined">lock</span><span>비밀번호 인증</span>';
            btnUnlockFiles.disabled = false;
        }
        
        if (btnRoomSettings) {
            btnRoomSettings.style.color = 'var(--ink-muted-48)';
            btnRoomSettings.style.opacity = '0.6';
            btnRoomSettings.style.cursor = 'not-allowed';
        }
        const btnNewFolder = document.getElementById('btn-new-folder');
        if (btnNewFolder) {
            btnNewFolder.style.color = 'var(--ink-muted-48)';
            btnNewFolder.style.opacity = '0.6';
            btnNewFolder.style.cursor = 'not-allowed';
        }
        if (tabBtnAdminRooms) tabBtnAdminRooms.style.display = 'none';
        if (tabBtnLogs) tabBtnLogs.style.display = 'none';
        if (tabBtnSettings) tabBtnSettings.style.display = 'none';
        
        // Switch back to files tab if needed
        const filesTabBtn = document.querySelector('.nav-tab[data-tab="files"]');
        if (filesTabBtn) filesTabBtn.click();
        
        showToast('로그아웃 되었습니다.');
        fetchFiles(1);
    };

    // Logout Button Event
    if (btnLogout) {
        btnLogout.addEventListener('click', performLogout);
    }

    // README rendering
    async function fetchReadme() {
        if (!readmeContainer) return;
        try {
            const response = await fetch(`/api/files/${containerId}/readme?folder_path=${encodeURIComponent(currentFolderPath)}`);
            if (response.ok) {
                const data = await response.json();
                readmeFilename.textContent = data.filename;
                readmeBody.innerHTML = DOMPurify.sanitize(marked.parse(data.content));
                readmeContainer.style.display = 'block';
            } else {
                readmeContainer.style.display = 'none';
            }
        } catch(e) {
            readmeContainer.style.display = 'none';
        }
    }

    // Pagination renderer
    function renderPagination(containerId_el, currentPage, totalPages, fetchFn) {
        const container = document.getElementById(containerId_el);
        if (!container || totalPages <= 1) {
            if (container) container.innerHTML = '';
            return;
        }
        
        let html = '';
        html += `<button ${currentPage <= 1 ? 'disabled' : ''} onclick="(${fetchFn.name})(${currentPage - 1})"><span class="material-icons-outlined" style="font-size:18px">chevron_left</span></button>`;
        
        const maxVisible = 5;
        let start = Math.max(1, currentPage - Math.floor(maxVisible / 2));
        let end = Math.min(totalPages, start + maxVisible - 1);
        if (end - start < maxVisible - 1) start = Math.max(1, end - maxVisible + 1);
        
        if (start > 1) {
            html += `<button onclick="(${fetchFn.name})(1)">1</button>`;
            if (start > 2) html += `<button disabled>...</button>`;
        }
        
        for (let i = start; i <= end; i++) {
            html += `<button class="${i === currentPage ? 'active' : ''}" onclick="(${fetchFn.name})(${i})">${i}</button>`;
        }
        
        if (end < totalPages) {
            if (end < totalPages - 1) html += `<button disabled>...</button>`;
            html += `<button onclick="(${fetchFn.name})(${totalPages})">${totalPages}</button>`;
        }
        
        html += `<button ${currentPage >= totalPages ? 'disabled' : ''} onclick="(${fetchFn.name})(${currentPage + 1})"><span class="material-icons-outlined" style="font-size:18px">chevron_right</span></button>`;
        container.innerHTML = html;
    }

    // toggleProtect global function
    window.toggleProtect = async function(fileId, isProtected) {
        try {
            const headers = { 'Content-Type': 'application/json' };
            if (containerPasswordCache) headers['x-container-password'] = containerPasswordCache;
            if (adminPasswordCache) headers['x-admin-password'] = adminPasswordCache;
            
            const response = await fetch(`/api/files/${containerId}/${fileId}/protect`, {
                method: 'PATCH',
                headers,
                body: JSON.stringify({ is_protected: isProtected })
            });
            if (response.ok) {
                showToast(isProtected ? '파일이 보호 설정되었습니다.' : '파일 보호가 해제되었습니다.');
            } else {
                showToast('보호 상태 변경에 실패했습니다.');
                fetchFiles(currentFilesPage);
            }
        } catch(e) {
            console.error(e);
            fetchFiles(currentFilesPage);
        }
    };

    // moveFile global function
    window.moveFile = async function(fileId) {
        const targetFolder = prompt('이동할 폴더 경로를 입력하세요:\n(최상위는 빈 값, 예: 문서/기획)');
        if (targetFolder === null) return;
        
        try {
            const headers = { 'Content-Type': 'application/json' };
            if (containerPasswordCache) headers['x-container-password'] = containerPasswordCache;
            if (adminPasswordCache) headers['x-admin-password'] = adminPasswordCache;
            
            const response = await fetch(`/api/files/${containerId}/${fileId}/move`, {
                method: 'PATCH',
                headers,
                body: JSON.stringify({ target_folder: targetFolder })
            });
            if (response.ok) {
                showToast('파일이 이동되었습니다.');
                fetchFiles(currentFilesPage);
            } else {
                const err = await response.json();
                alert(`이동 실패: ${err.detail}`);
            }
        } catch(e) {
            console.error(e);
            alert('파일 이동 중 오류가 발생했습니다.');
        }
    };

    // Expose functions globally for pagination onclick
    window.fetchFiles = fetchFiles;
    window.fetchAdminData = fetchAdminData;
    window.fetchAdminRoomsPage = fetchAdminRoomsPage;
    window.fetchAdminFilesPage = fetchAdminFilesPage;
});
