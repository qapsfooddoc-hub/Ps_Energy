// Main Application Controller with Security Fixes & Dynamic Titles

const STORAGE_KEY = "MULTI_YEAR_ENERGY_SUMMARY_DATA_V5";
const WATER_STORAGE_KEY = "MULTI_YEAR_WATER_METERS_DATA_V5";
const ELEC_STORAGE_KEY = "MULTI_YEAR_ELEC_METERS_DATA_V5";
const AUDIT_STORAGE_KEY = "ENERGY_AUDIT_LOGS_DATA_V5";
const AUTH_STORAGE_KEY = "ENERGY_ADMIN_AUTH_V2"; // V2: hashed passwords

// FIX #8: Calculate current year/month dynamically from system date
const _now = new Date();
const CURRENT_REAL_YEAR = _now.getFullYear() + 543; // Convert CE to BE (พ.ศ.)
const CURRENT_REAL_MONTH_IDX = _now.getMonth();     // 0-indexed (0=มกราคม)

const ALL_MONTHS = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];

// FIX #4: Login attempt tracking for brute-force protection
let loginAttempts = 0;
let loginLockUntil = 0;
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_MS = 30000; // 30 seconds lockout

let appState = {
    multiYearData: {},
    waterMeters: {},
    elecMeters: {},
    auditLogs: [],
    authCredentials: { username: "admin", passwordHash: null }, // FIX #5: store hash not plaintext
    selectedYear: CURRENT_REAL_YEAR,
    compareYear: CURRENT_REAL_YEAR - 1,
    selectedMonth: ALL_MONTHS[CURRENT_REAL_MONTH_IDX],
    activeView: "dashboard-view",
    isEditing: false,
    editingMonth: null,
    previousSnapshot: null,
    isLoggedIn: false,
    currentUser: null
};

// FIX #5: Web Crypto SHA-256 hash helper
async function hashPassword(plain) {
    const encoder = new TextEncoder();
    const data = encoder.encode(plain);
    const hashBuf = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2,'0')).join('');
}

// Initialize App
document.addEventListener("DOMContentLoaded", () => {
    loadStateFromStorage();
    setupEventListeners();
    initYearAndMonthSelectors();
    updateAuthUI();
    switchView("dashboard-view");
    refreshAllViews();

    // Initialize Google Sheets Sync if configured (Stale-While-Revalidate in background)
    if (typeof sheetsService !== 'undefined') {
        sheetsService.updateStatusBadge();
        if (sheetsService.isConfigured()) {
            sheetsService.syncFromSheets(false);
        }
    }
});

function loadStateFromStorage() {
    localStorage.removeItem("ENERGY_SUMMARY_2568_DATA");
    localStorage.removeItem("MULTI_YEAR_ENERGY_SUMMARY_DATA");
    localStorage.removeItem("MULTI_YEAR_ENERGY_SUMMARY_DATA_V2");
    localStorage.removeItem("MULTI_YEAR_ENERGY_SUMMARY_DATA_V3");
    localStorage.removeItem("MULTI_YEAR_ENERGY_SUMMARY_DATA_V4");
    localStorage.removeItem("MULTI_YEAR_WATER_METERS_DATA_V4");
    localStorage.removeItem("MULTI_YEAR_ELEC_METERS_DATA_V4");

    const savedMulti = localStorage.getItem(STORAGE_KEY);
    const savedWater = localStorage.getItem(WATER_STORAGE_KEY);
    const savedElec = localStorage.getItem(ELEC_STORAGE_KEY);
    const savedAudit = localStorage.getItem(AUDIT_STORAGE_KEY) || localStorage.getItem("ENERGY_AUDIT_LOGS_DATA_V4");
    const savedAuth = localStorage.getItem(AUTH_STORAGE_KEY);

    let useDefault = true;

    if (savedMulti) {
        try {
            const parsed = JSON.parse(savedMulti);
            if (parsed && parsed["2568"] && parsed["2568"]["มกราคม"] && parsed["2568"]["มกราคม"].totalCost > 0) {
                appState.multiYearData = parsed;
                useDefault = false;
            }
        } catch(e) { useDefault = true; }
    }

    if (useDefault) {
        appState.multiYearData = JSON.parse(JSON.stringify(MULTI_YEAR_ENERGY_DATA));
        saveStateToStorage();
    }

    // Ensure 2569 July, August, September, and October are populated from latest dataset if empty or missing
    if (appState.multiYearData && appState.multiYearData["2569"]) {
        ["กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม"].forEach(m => {
            const cur = appState.multiYearData["2569"][m];
            const def = MULTI_YEAR_ENERGY_DATA["2569"] && MULTI_YEAR_ENERGY_DATA["2569"][m];
            if (def && (!cur || cur.production === 0 || cur.items.every(it => it.cost === 0) || (cur.items.find(i => i.id === 3)?.cost === 0 && def.items.find(i => i.id === 3)?.cost > 0))) {
                appState.multiYearData["2569"][m] = JSON.parse(JSON.stringify(def));
            }
        });
    }

    if (savedWater) {
        try { appState.waterMeters = JSON.parse(savedWater); } catch(e) { appState.waterMeters = {}; }
    } else { appState.waterMeters = {}; }

    if (savedElec) {
        try { appState.elecMeters = JSON.parse(savedElec); } catch(e) { appState.elecMeters = {}; }
    } else { appState.elecMeters = {}; }

    // Seed missing initial meters from dataset (for 2568, 2569, etc.)
    seedInitialMeters();

    if (savedAudit) {
        try { appState.auditLogs = JSON.parse(savedAudit); } catch(e) { appState.auditLogs = []; }
    } else { appState.auditLogs = []; }

    if (savedAuth) {
        try {
            const parsed = JSON.parse(savedAuth);
            // FIX #5: migrate from old plaintext format to hashed format
            if (parsed && parsed.password && !parsed.passwordHash) {
                // Old format: has plaintext password — hash it now
                hashPassword(parsed.password).then(hash => {
                    appState.authCredentials = { username: parsed.username || "admin", passwordHash: hash };
                    saveAuthToStorage();
                });
            } else {
                appState.authCredentials = parsed;
            }
        } catch(e) {
            // Default: hash "1234"
            hashPassword("1234").then(hash => {
                appState.authCredentials = { username: "admin", passwordHash: hash };
                saveAuthToStorage();
            });
        }
    } else {
        // First run: hash default password
        hashPassword("1234").then(hash => {
            appState.authCredentials = { username: "admin", passwordHash: hash };
            saveAuthToStorage();
        });
    }
}

function saveAuthToStorage() {
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(appState.authCredentials));
}

function saveStateToStorage() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(appState.multiYearData));
    localStorage.setItem(WATER_STORAGE_KEY, JSON.stringify(appState.waterMeters));
    localStorage.setItem(ELEC_STORAGE_KEY, JSON.stringify(appState.elecMeters));
    localStorage.setItem(AUDIT_STORAGE_KEY, JSON.stringify(appState.auditLogs));
    // Auth is saved separately via saveAuthToStorage()
}

function resetToDefaultData() {
    if (!checkAuthPermission("รีเซ็ตข้อมูล")) return;

    // FIX #7: More explicit confirmation with clear warning
    const firstConfirm = confirm(
        "⚠️ คำเตือน: การรีเซ็ตจะลบข้อมูลต่อไปนี้ออกทั้งหมด\n\n" +
        "• ข้อมูลมิเตอร์น้ำย่อย (ทุกเดือน ทุกปี)\n" +
        "• ข้อมูลมิเตอร์ไฟฟ้าย่อย (ทุกเดือน ทุกปี)\n" +
        "• ประวัติการแก้ไขข้อมูล (Audit Log)\n\n" +
        "ข้อมูลที่ถูกลบจะไม่สามารถกู้คืนได้\nต้องการดำเนินการต่อหรือไม่?"
    );
    if (!firstConfirm) return;

    const secondConfirm = confirm(
        "✅ ยืนยันอีกครั้ง: โหลดข้อมูลจากไฟล์ Excel ต้นฉบับ\n" +
        "ข้อมูลปัจจุบันทั้งหมดจะถูกแทนที่ใช่หรือไม่?"
    );
    if (!secondConfirm) return;

    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(WATER_STORAGE_KEY);
    localStorage.removeItem(ELEC_STORAGE_KEY);
    localStorage.removeItem(AUDIT_STORAGE_KEY);
    appState.multiYearData = JSON.parse(JSON.stringify(MULTI_YEAR_ENERGY_DATA));
    appState.waterMeters = {};
    appState.elecMeters = {};
    appState.auditLogs = [];
    seedInitialMeters();
    saveStateToStorage();
    cancelEditMode();
    refreshAllViews();
    showToast("โหลดข้อมูลจากไฟล์ Excel ต้นฉบับเรียบร้อยแล้ว");
}

// ----------------------------------------------------
// SEED INITIAL SUB-METERS DATA (FOR 2568, 2569, ETC.)
// ----------------------------------------------------
function seedInitialMeters() {
    if (typeof ALL_INITIAL_WATER_METERS !== 'undefined') {
        Object.keys(ALL_INITIAL_WATER_METERS).forEach(yr => {
            const yrMeters = ALL_INITIAL_WATER_METERS[yr];
            Object.keys(yrMeters).forEach(m => {
                const k = `${yr}_${m}`;
                const existing = appState.waterMeters[k];
                const isAllZero = !existing || !Array.isArray(existing) || existing.length === 0 || existing.every(it => (!it.cost || it.cost === 0) && (!it.usage || it.usage === 0));
                if (isAllZero && yrMeters[m] && yrMeters[m].some(it => it.cost > 0 || it.usage > 0)) {
                    appState.waterMeters[k] = JSON.parse(JSON.stringify(yrMeters[m]));
                } else if (!existing) {
                    appState.waterMeters[k] = JSON.parse(JSON.stringify(yrMeters[m]));
                }
            });
        });
    } else if (typeof INITIAL_WATER_METERS !== 'undefined') {
        Object.keys(INITIAL_WATER_METERS).forEach(m => {
            const k = `2568_${m}`;
            if (!appState.waterMeters[k]) {
                appState.waterMeters[k] = JSON.parse(JSON.stringify(INITIAL_WATER_METERS[m]));
            }
        });
    }

    if (typeof ALL_INITIAL_ELEC_METERS !== 'undefined') {
        Object.keys(ALL_INITIAL_ELEC_METERS).forEach(yr => {
            const yrMeters = ALL_INITIAL_ELEC_METERS[yr];
            Object.keys(yrMeters).forEach(m => {
                const k = `${yr}_${m}`;
                const existing = appState.elecMeters[k];
                const isAllZero = !existing || !Array.isArray(existing) || existing.length === 0 || existing.every(it => (!it.cost || it.cost === 0) && (!it.usage || it.usage === 0));
                if (isAllZero && yrMeters[m] && yrMeters[m].some(it => it.cost > 0 || it.usage > 0)) {
                    appState.elecMeters[k] = JSON.parse(JSON.stringify(yrMeters[m]));
                } else if (!existing) {
                    appState.elecMeters[k] = JSON.parse(JSON.stringify(yrMeters[m]));
                }
            });
        });
    } else if (typeof INITIAL_ELEC_METERS !== 'undefined') {
        Object.keys(INITIAL_ELEC_METERS).forEach(m => {
            const k = `2568_${m}`;
            if (!appState.elecMeters[k]) {
                appState.elecMeters[k] = JSON.parse(JSON.stringify(INITIAL_ELEC_METERS[m]));
            }
        });
    }
    saveStateToStorage();
}

function setupEventListeners() {
    document.querySelectorAll(".nav-item").forEach(item => {
        item.addEventListener("click", (e) => {
            e.preventDefault();
            const targetView = item.getAttribute("data-view");
            if (targetView) {
                if ((targetView === "entry-view" || targetView === "audit-view") && !appState.isLoggedIn) {
                    showLoginModal(`โปรดเข้าสู่ระบบผู้ดูแลข้อมูล (QA/EMR) ก่อนใช้งานเมนู ${item.innerText.trim()}`);
                    return;
                }
                document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));
                item.classList.add("active");
                switchView(targetView);
            }
        });
    });

    const themeBtn = document.getElementById("theme-toggle");
    if (themeBtn) {
        themeBtn.addEventListener("click", () => {
            const currentTheme = document.body.getAttribute("data-theme");
            const newTheme = currentTheme === "dark" ? "light" : "dark";
            document.body.setAttribute("data-theme", newTheme);
            themeBtn.querySelector("span").textContent = newTheme === "dark" ? "Light Mode" : "Dark Mode";
        });
    }

    const mobileToggle = document.getElementById("mobile-menu-toggle");
    const sidebar = document.querySelector(".sidebar");
    const sidebarOverlay = document.getElementById("sidebar-overlay");

    function openMobileSidebar() {
        sidebar && sidebar.classList.add("mobile-open");
        sidebarOverlay && sidebarOverlay.classList.add("active");
        document.body.style.overflow = "hidden";
    }

    function closeMobileSidebar() {
        sidebar && sidebar.classList.remove("mobile-open");
        sidebarOverlay && sidebarOverlay.classList.remove("active");
        document.body.style.overflow = "";
    }

    if (mobileToggle && sidebar) {
        mobileToggle.addEventListener("click", () => {
            if (sidebar.classList.contains("mobile-open")) {
                closeMobileSidebar();
            } else {
                openMobileSidebar();
            }
        });
    }

    if (sidebarOverlay) {
        sidebarOverlay.addEventListener("click", closeMobileSidebar);
    }

    // ปิด sidebar เมื่อคลิก nav item บนมือถือ
    document.querySelectorAll(".nav-item").forEach(item => {
        item.addEventListener("click", () => {
            if (window.innerWidth <= 768) closeMobileSidebar();
        });
    });

    const dashYearSel = document.getElementById("dash-year-select");
    if (dashYearSel) {
        dashYearSel.addEventListener("change", (e) => {
            appState.selectedYear = parseInt(e.target.value);
            updateMonthDropdownOptions();
            refreshAllViews();
        });
    }

    const dashCmpYearSel = document.getElementById("dash-compare-year-select");
    if (dashCmpYearSel) {
        dashCmpYearSel.addEventListener("change", (e) => {
            appState.compareYear = parseInt(e.target.value);
            refreshAllViews();
        });
    }

    const dashMonthFilterSel = document.getElementById("dash-month-filter");
    if (dashMonthFilterSel) {
        dashMonthFilterSel.addEventListener("change", () => {
            refreshAllViews();
        });
    }

    const formMonthSel = document.getElementById("entry-month-select");
    if (formMonthSel) {
        formMonthSel.addEventListener("change", (e) => {
            if (typeof autoSaveEntryFormData === "function") autoSaveEntryFormData(true);
            appState.selectedMonth = e.target.value;
            // sync sheet-month-select to same value
            const sheetSel = document.getElementById("sheet-month-select");
            if (sheetSel) sheetSel.value = e.target.value;
            loadEntryFormData(appState.selectedMonth);
            renderSheetView(appState.selectedMonth);
        });
    }

    // Bug fix: sheet-month-select had NO event listener — add it
    const sheetMonthSel = document.getElementById("sheet-month-select");
    if (sheetMonthSel) {
        sheetMonthSel.addEventListener("change", (e) => {
            if (typeof autoSaveEntryFormData === "function") autoSaveEntryFormData(true);
            appState.selectedMonth = e.target.value;
            // sync entry-month-select too
            const entrySel = document.getElementById("entry-month-select");
            if (entrySel) entrySel.value = e.target.value;
            renderSheetView(appState.selectedMonth);
        });
    }

    const formYearSel = document.getElementById("entry-year-select");
    if (formYearSel) {
        formYearSel.addEventListener("change", (e) => {
            if (typeof autoSaveEntryFormData === "function") autoSaveEntryFormData(true);
            appState.selectedYear = parseInt(e.target.value);
            updateMonthDropdownOptions();
            refreshAllViews();
        });
    }

    document.addEventListener("focusin", (e) => {
        if (e.target && e.target.tagName === "INPUT" && e.target.type === "number") {
            e.target.select();
        }
    });

    document.addEventListener("focusout", (e) => {
        if (e.target && (e.target.classList.contains("entry-water-input") || 
                         e.target.classList.contains("entry-elec-input") || 
                         e.target.id === "input-prod-vol" || 
                         e.target.id === "input-remarks" ||
                         e.target.id === "input-fuel-usage" ||
                         e.target.id === "input-fuel-cost" ||
                         e.target.id === "input-gas-usage" ||
                         e.target.id === "input-gas-cost")) {
            if (typeof autoSaveEntryFormData === "function") {
                autoSaveEntryFormData(true);
            }
        }
    });

    window.addEventListener("beforeunload", () => {
        if (typeof autoSaveEntryFormData === "function") {
            autoSaveEntryFormData(true);
        }
    });
}

function checkAuthPermission(actionName) {
    if (!appState.isLoggedIn) {
        showLoginModal(`โปรดเข้าสู่ระบบเพื่อกระทำรายการ: ${actionName}`);
        return false;
    }
    return true;
}

function toggleAuthAction() {
    if (appState.isLoggedIn) {
        if (confirm("คุณต้องการออกจากระบบ ใช่หรือไม่?")) {
            appState.isLoggedIn = false;
            appState.currentUser = null;
            updateAuthUI();
            switchView("dashboard-view");
            showToast("ออกจากระบบเรียบร้อยแล้ว (เข้าสู่โหมดทั่วไป)");
        }
    } else {
        showLoginModal();
    }
}

function showLoginModal(message) {
    const modal = document.getElementById("login-modal");
    if (modal) {
        modal.style.display = "flex";
        document.getElementById("login-username")?.focus();
        if (message) showToast(message);
    }
}

function closeLoginModal() {
    const modal = document.getElementById("login-modal");
    if (modal) modal.style.display = "none";
}

async function handleLoginSubmit(event) {
    event.preventDefault();

    // FIX #4: Check brute-force lockout
    const now = Date.now();
    if (now < loginLockUntil) {
        const secLeft = Math.ceil((loginLockUntil - now) / 1000);
        alert(`ระบบถูกล็อคชั่วคราวเนื่องจากกรอกรหัสผิดเกินกำหนด\nโปรดรออีก ${secLeft} วินาที`);
        return;
    }

    const u = document.getElementById("login-username")?.value.trim();
    const p = document.getElementById("login-password")?.value.trim();

    if (!u || !p) {
        alert("โปรดกรอกชื่อผู้ใช้งานและรหัสผ่าน");
        return;
    }

    // FIX #2: Remove all hardcoded backdoors — check only stored credentials
    const storedAuth = appState.authCredentials;
    const isValidUser = u.toLowerCase() === (storedAuth.username || "admin").toLowerCase();

    // FIX #5: Compare hashed password
    let isValidPass = false;
    if (storedAuth.passwordHash) {
        const inputHash = await hashPassword(p);
        isValidPass = inputHash === storedAuth.passwordHash;
    } else {
        // Fallback: no hash stored yet (first load edge case)
        isValidPass = (p === "1234");
    }

    if (isValidUser && isValidPass) {
        loginAttempts = 0;
        appState.isLoggedIn = true;
        appState.currentUser = u.toUpperCase();
        closeLoginModal();
        updateAuthUI();
        showToast(`เข้าสู่ระบบในฐานะผู้ดูแลข้อมูล (${appState.currentUser}) สำเร็จ`);
    } else {
        loginAttempts++;
        const remaining = MAX_LOGIN_ATTEMPTS - loginAttempts;
        if (loginAttempts >= MAX_LOGIN_ATTEMPTS) {
            loginLockUntil = Date.now() + LOCKOUT_MS;
            loginAttempts = 0;
            alert(`❌ กรอกรหัสผ่านผิดเกินกำหนด ระบบจะล็อคเป็นเวลา 30 วินาที`);
        } else {
            alert(`❌ ชื่อผู้ใช้งานหรือรหัสผ่านไม่ถูกต้อง (เหลืออีก ${remaining} ครั้ง)`);
        }
    }
}

function showChangePasswordModal() {
    if (!appState.isLoggedIn) {
        showLoginModal("โปรดเข้าสู่ระบบก่อนเปลี่ยนรหัสผ่าน");
        return;
    }
    const modal = document.getElementById("change-password-modal");
    if (modal) {
        modal.style.display = "flex";
        document.getElementById("change-username-input").value = appState.authCredentials.username;
        document.getElementById("change-old-password-input").value = "";
        document.getElementById("change-new-password-input").value = "";
        document.getElementById("change-confirm-password-input").value = "";
    }
}

function closeChangePasswordModal() {
    const modal = document.getElementById("change-password-modal");
    if (modal) modal.style.display = "none";
}

async function handleChangePasswordSubmit(event) {
    event.preventDefault();
    const u = document.getElementById("change-username-input")?.value.trim();
    const oldP = document.getElementById("change-old-password-input")?.value.trim();
    const newP = document.getElementById("change-new-password-input")?.value.trim();
    const confirmP = document.getElementById("change-confirm-password-input")?.value.trim();

    if (!u || !oldP || !newP) {
        alert("โปรดกรอกข้อมูลให้ครบทุกช่อง");
        return;
    }

    // FIX #3: Verify old password via hash only (no hardcoded bypass)
    const oldHash = await hashPassword(oldP);
    if (oldHash !== appState.authCredentials.passwordHash) {
        alert("❌ รหัสผ่านปัจจุบันไม่ถูกต้อง");
        return;
    }

    if (newP.length < 6) {
        alert("รหัสผ่านใหม่ต้องมีความยาวอย่างน้อย 6 ตัวอักษร");
        return;
    }

    if (newP !== confirmP) {
        alert("รหัสผ่านใหม่และการยืนยันรหัสผ่านไม่ตรงกัน");
        return;
    }

    // FIX #5: Store hash only, never plaintext
    const newHash = await hashPassword(newP);
    appState.authCredentials = { username: u, passwordHash: newHash };
    saveAuthToStorage();
    closeChangePasswordModal();
    showToast(`✅ เปลี่ยนรหัสผ่านผู้ดูแลระบบเรียบร้อยแล้ว (ไม่แสดงรหัสเพื่อความปลอดภัย)`);
}

function updateAuthUI() {
    const authBtn = document.getElementById("auth-user-btn");
    const changePwdBtn = document.getElementById("change-pwd-btn");
    const entryNav = document.getElementById("nav-entry-link");
    const auditNav = document.getElementById("nav-audit-link");

    if (appState.isLoggedIn) {
        if (authBtn) {
            authBtn.className = "btn btn-primary btn-sm";
            authBtn.innerHTML = `<i class="fa-solid fa-user-check"></i> <span>ผู้ดูแลระบบ (${appState.currentUser}) | 🚪 ออก</span>`;
        }
        if (changePwdBtn) changePwdBtn.style.display = "inline-flex";

        if (entryNav) {
            entryNav.classList.remove("locked");
            entryNav.querySelector("span").innerHTML = `บันทึกข้อมูลใหม่`;
        }
        if (auditNav) {
            auditNav.classList.remove("locked");
            auditNav.querySelector("span").innerHTML = `ประวัติการแก้ไข`;
        }
    } else {
        if (authBtn) {
            authBtn.className = "btn btn-secondary btn-sm";
            authBtn.innerHTML = `<i class="fa-solid fa-lock"></i> <span>เข้าสู่ระบบ (QA/EMR)</span>`;
        }
        if (changePwdBtn) changePwdBtn.style.display = "none";

        if (entryNav) {
            entryNav.classList.add("locked");
            entryNav.querySelector("span").innerHTML = `บันทึกข้อมูลใหม่ <i class="fa-solid fa-lock" style="font-size:0.75rem; margin-left:auto; opacity:0.6;"></i>`;
        }
        if (auditNav) {
            auditNav.classList.add("locked");
            auditNav.querySelector("span").innerHTML = `ประวัติการแก้ไข <i class="fa-solid fa-lock" style="font-size:0.75rem; margin-left:auto; opacity:0.6;"></i>`;
        }
    }
}

function switchView(viewId) {
    if (appState.activeView === "entry-view" && typeof autoSaveEntryFormData === "function") {
        autoSaveEntryFormData(true);
    }
    appState.activeView = viewId;
    document.querySelectorAll(".view-section").forEach(sec => sec.classList.remove("active"));
    const activeSec = document.getElementById(viewId);
    if (activeSec) activeSec.classList.add("active");

    const titles = {
        "dashboard-view": `📊 แดชบอร์ดวิเคราะห์และเปรียบเทียบพลังงานเชิงบริหาร`,
        "resource-unit-view": `📈 แดชบอร์ดวิเคราะห์ราคาพลังงานต่อหน่วย (Unit Rate: 4 พลังงาน)`,
        "entry-view": appState.isEditing ? `✏️ แก้ไขข้อมูลกรณีผิดพลาด (${appState.editingMonth} ${appState.selectedYear})` : `📝 บันทึกข้อมูลใหม่แยกตามทรัพยากร (ปี ${appState.selectedYear})`,
        "history-view": `📜 ประวัติการบันทึกข้อมูลย้อนหลัง ประจำปี ${appState.selectedYear}`,
        "audit-view": "🕵️‍♂️ ประวัติการแก้ไขข้อมูล (Audit Trail Log)",
        "sheet-view": `📄 ตารางสรุปรูปแบบสเปรดชีต Excel ประจำปี ${appState.selectedYear}`,
        "reports-view": "📑 รายงานสรุปและส่งออกข้อมูล (Export)",
        "manual-view": "📖 คู่มือการใช้งานระบบบริหารจัดการพลังงาน (User Manual)"
    };
    
    const pageTitle = document.getElementById("current-page-title");
    if (pageTitle && titles[viewId]) pageTitle.innerHTML = titles[viewId];

    refreshAllViews();
}

function initYearAndMonthSelectors() {
    const years = Object.keys(appState.multiYearData).map(y => parseInt(y)).sort((a,b) => a - b);
    
    const dashYearSel = document.getElementById("dash-year-select");
    if (dashYearSel) {
        dashYearSel.innerHTML = years.map(y => `<option value="${y}" ${y === appState.selectedYear ? 'selected':''}>ปี พ.ศ. ${y}</option>`).join("");
        dashYearSel.value = appState.selectedYear;
    }

    const dashCmpYearSel = document.getElementById("dash-compare-year-select");
    if (dashCmpYearSel) {
        dashCmpYearSel.innerHTML = years.map(y => `<option value="${y}" ${y === appState.compareYear ? 'selected':''}>ปี พ.ศ. ${y}</option>`).join("");
        dashCmpYearSel.value = appState.compareYear;
    }

    const entryYearSel = document.getElementById("entry-year-select");
    if (entryYearSel) {
        entryYearSel.innerHTML = years.concat([2570, 2571]).map(y => `<option value="${y}" ${y === appState.selectedYear ? 'selected':''}>${y}</option>`).join("");
        entryYearSel.value = appState.selectedYear;
    }

    updateMonthDropdownOptions();
}

function updateMonthDropdownOptions() {
    const curYear = appState.selectedYear;
    let allowedMonths = ALL_MONTHS;

    if (curYear === CURRENT_REAL_YEAR) {
        allowedMonths = ALL_MONTHS.slice(0, CURRENT_REAL_MONTH_IDX + 1); // Jan to Jul
    }

    if (!allowedMonths.includes(appState.selectedMonth)) {
        appState.selectedMonth = allowedMonths[allowedMonths.length - 1];
    }

    ["entry-month-select", "sheet-month-select"].forEach(id => {
        const sel = document.getElementById(id);
        if (sel) {
            sel.innerHTML = allowedMonths.map(m => `<option value="${m}">${m}</option>`).join("");
            sel.value = appState.selectedMonth;
        }
    });
}

function addNewMonthCard() {
    if (!checkAuthPermission("เพิ่มรอบบันทึกเดือนใหม่")) return;

    const allowedMonths = appState.selectedYear === CURRENT_REAL_YEAR 
        ? ALL_MONTHS.slice(0, CURRENT_REAL_MONTH_IDX + 1) 
        : ALL_MONTHS;

    // Use current selected month from dropdown (no prompt needed)
    const monthClean = appState.selectedMonth;
    if (!monthClean || !allowedMonths.includes(monthClean)) {
        showToast("เลือกเดือนที่ต้องการบันทึกจาก Dropdown ด้านบนก่อนครับ");
        return;
    }

    const year = appState.selectedYear;
    
    if (!appState.multiYearData[year]) appState.multiYearData[year] = {};

    if (appState.multiYearData[year][monthClean] && 
        appState.multiYearData[year][monthClean].totalCost > 0) {
        showToast(`เดือน ${monthClean} ${year} มีข้อมูลอยู่แล้ว — สามารถกรอกข้อมูลได้เลย`);
        return;
    }

    if (!appState.multiYearData[year][monthClean]) {
        appState.multiYearData[year][monthClean] = {
            month: monthClean,
            year: year,
            production: 0,
            items: [
                { id: 1, name: "น้ำ", usage: 0, unit: "ลบ.ม.", cost: 0, production: 0, usagePerProd: 0, costPerProd: 0 },
                { id: 2, name: "ไฟฟ้า", usage: 0, unit: "kWh", cost: 0, production: 0, usagePerProd: 0, costPerProd: 0 },
                { id: 3, name: "น้ำมันเชื้อเพลิง", usage: 0, unit: "ลิตร", cost: 0, production: 0, usagePerProd: 0, costPerProd: 0 },
                { id: 4, name: "แก๊ส (LPG)", usage: 0, unit: "กิโลกรัม", cost: 0, production: 0, usagePerProd: 0, costPerProd: 0 }
            ],
            totalCost: 0,
            note: "-",
            creator: "ผู้จัดทำ (QA)",
            inspector: "ผู้ตรวจสอบ (EMR)"
        };
    }

    document.querySelectorAll("#entry-month-select, #sheet-month-select").forEach(s => s.value = monthClean);
    saveStateToStorage();
    refreshAllViews();
    showToast(`✅ สร้างรอบบันทึกเดือน ${monthClean} ปี ${year} เรียบร้อยแล้ว`);
}


function refreshAllViews() {
    renderDashboard(appState.multiYearData, appState.waterMeters, appState.elecMeters);
    loadEntryFormData(appState.selectedMonth);
    renderSheetView(appState.selectedMonth);
    renderHistoryView();
    renderAuditView();
    if (typeof initReportView === "function") initReportView();
}

// ----------------------------------------------------
// EDIT MODE CONTROLLER
// ----------------------------------------------------
// EDIT & LOCK CONTROLLER (บันทึกแล้วล็อกเป็นสีเทา / ปลดล็อกเพื่อแก้ไข)
// ----------------------------------------------------
function isMonthLocked(curYear, month) {
    if (appState.isEditing && appState.editingMonth === month && appState.selectedYear === curYear) {
        return false;
    }
    const mData = appState.multiYearData[curYear]?.[month];
    if (!mData) return false;
    
    if (mData.isLocked === true) return true;
    if (mData.isLocked === false) return false;
    
    // Default for existing records: if it has totalCost > 0 or production > 0
    return (mData.totalCost > 0 || mData.production > 0 || !!mData.updatedAt);
}

function applyEntryFormLockState(isLocked) {
    const inputs = document.querySelectorAll(
        "#input-prod-vol, .entry-water-input, .entry-elec-input, " +
        "#input-fuel-usage, #input-fuel-cost, #input-gas-usage, #input-gas-cost, #input-remarks"
    );
    
    inputs.forEach(input => {
        input.disabled = isLocked;
        if (isLocked) {
            input.classList.add("locked-input");
        } else {
            input.classList.remove("locked-input");
        }
    });

    const resourceSaveBtns = document.querySelectorAll(
        ".resource-card button, .table-card button[onclick^='saveResource'], button[onclick^='saveProdVol']"
    );
    resourceSaveBtns.forEach(btn => {
        btn.disabled = isLocked;
        if (isLocked) {
            btn.classList.add("btn-disabled");
        } else {
            btn.classList.remove("btn-disabled");
        }
    });

    const lockedBanner = document.getElementById("entry-locked-banner");
    const editBanner = document.getElementById("edit-mode-banner");
    const editBtnHeader = document.getElementById("entry-header-edit-btn");
    const saveBtnFooter = document.getElementById("save-entry-footer-btn");
    const editBtnFooter = document.getElementById("edit-entry-footer-btn");
    const cancelBtnFooter = document.getElementById("cancel-entry-footer-btn");
    const editReasonGroup = document.getElementById("edit-reason-group");
    const autosaveBadges = document.querySelectorAll(".entry-autosave-indicator");

    if (isLocked) {
        if (lockedBanner) lockedBanner.style.display = "flex";
        if (editBanner) editBanner.style.display = "none";
        if (editBtnHeader) editBtnHeader.style.display = "inline-flex";
        if (saveBtnFooter) saveBtnFooter.style.display = "none";
        if (editBtnFooter) editBtnFooter.style.display = "inline-flex";
        if (cancelBtnFooter) cancelBtnFooter.style.display = "none";
        if (editReasonGroup) editReasonGroup.style.display = "none";
        
        autosaveBadges.forEach(b => {
            b.innerHTML = `<i class="fa-solid fa-lock" style="color:#64748b;"></i> ข้อมูลล็อกแล้ว`;
            b.style.background = "#f1f5f9";
            b.style.color = "#64748b";
        });
    } else {
        if (lockedBanner) lockedBanner.style.display = "none";
        if (editBtnHeader) editBtnHeader.style.display = "none";
        if (saveBtnFooter) saveBtnFooter.style.display = "inline-flex";
        if (editBtnFooter) editBtnFooter.style.display = "none";

        if (appState.isEditing) {
            if (editBanner) editBanner.style.display = "flex";
            if (cancelBtnFooter) cancelBtnFooter.style.display = "inline-flex";
            if (editReasonGroup) editReasonGroup.style.display = "block";
            const btnLabel2 = document.getElementById("save-btn-label-footer");
            if (btnLabel2) btnLabel2.textContent = "บันทึกการแก้ไขข้อมูล";
        } else {
            if (editBanner) editBanner.style.display = "none";
            if (cancelBtnFooter) cancelBtnFooter.style.display = "none";
            if (editReasonGroup) editReasonGroup.style.display = "none";
            const btnLabel2 = document.getElementById("save-btn-label-footer");
            if (btnLabel2) btnLabel2.textContent = "บันทึกทั้งหมดประจำเดือน";
        }

        autosaveBadges.forEach(b => {
            b.innerHTML = `<i class="fa-solid fa-circle-check" style="color:#16a34a;"></i> บันทึกข้อมูลค้างไว้เสมอ`;
            b.style.background = "#dcfce7";
            b.style.color = "#16a34a";
        });
    }
}

function startEditMode(month) {
    if (!month) month = appState.selectedMonth;
    if (!checkAuthPermission("แก้ไขข้อมูล")) return;

    appState.isEditing = true;
    appState.editingMonth = month;
    appState.selectedMonth = month;
    const curYear = appState.selectedYear;

    if (appState.multiYearData[curYear] && appState.multiYearData[curYear][month]) {
        appState.previousSnapshot = JSON.parse(JSON.stringify(appState.multiYearData[curYear][month]));
    }

    document.querySelectorAll("#entry-month-select, #sheet-month-select").forEach(s => s.value = month);

    applyEntryFormLockState(false);

    const banner = document.getElementById("edit-mode-banner");
    const bannerText = document.getElementById("edit-banner-text");
    if (banner && bannerText) {
        bannerText.innerHTML = `<strong>กำลังอยู่ในโหมดแก้ไขข้อมูล:</strong> ประจำเดือน ${month} ${curYear}`;
        banner.style.display = "flex";
    }

    const lockedBanner = document.getElementById("entry-locked-banner");
    if (lockedBanner) lockedBanner.style.display = "none";

    const editReasonGroup = document.getElementById("edit-reason-group");
    if (editReasonGroup) editReasonGroup.style.display = "block";
    const editReasonInput = document.getElementById("input-edit-reason");
    if (editReasonInput) editReasonInput.value = "";

    const btnLabel1 = document.getElementById("save-btn-label");
    const btnLabel2 = document.getElementById("save-btn-label-footer");
    if (btnLabel1) btnLabel1.textContent = "บันทึกการแก้ไขข้อมูล";
    if (btnLabel2) btnLabel2.textContent = "บันทึกการแก้ไขข้อมูล";

    if (appState.activeView !== "entry-view") {
        switchView("entry-view");
    }
    showToast(`✏️ ปลดล็อกช่องกรอกข้อมูลเดือน ${month} ${curYear} แล้ว — แก้ไขได้ตามต้องการ`);
}

function cancelEditMode() {
    const wasEditing = appState.isEditing;
    const curYear = appState.selectedYear;
    const month = appState.selectedMonth;

    if (wasEditing && appState.previousSnapshot && appState.multiYearData[curYear] && appState.multiYearData[curYear][month]) {
        appState.multiYearData[curYear][month] = JSON.parse(JSON.stringify(appState.previousSnapshot));
    }

    appState.isEditing = false;
    appState.editingMonth = null;
    appState.previousSnapshot = null;

    const banner = document.getElementById("edit-mode-banner");
    if (banner) banner.style.display = "none";

    const editReasonGroup = document.getElementById("edit-reason-group");
    if (editReasonGroup) editReasonGroup.style.display = "none";
    const editReasonInput = document.getElementById("input-edit-reason");
    if (editReasonInput) editReasonInput.value = "";

    const btnLabel1 = document.getElementById("save-btn-label");
    const btnLabel2 = document.getElementById("save-btn-label-footer");
    if (btnLabel1) btnLabel1.textContent = "บันทึกทั้งหมดประจำเดือน";
    if (btnLabel2) btnLabel2.textContent = "บันทึกทั้งหมดประจำเดือน";

    loadEntryFormData(month);
    if (wasEditing) showToast("ยกเลิกการแก้ไขข้อมูลแล้ว — คืนค่าเดิม");
}

// ----------------------------------------------------
// DATA ENTRY & FORM CONTROLLER
// ----------------------------------------------------
let autoSaveTimer = null;

function handleEntryInput(elem) {
    calculateEntryFormSummary();
    autoSaveEntryFormData(false);
}

function updateAutoSaveBadge(status) {
    const badges = document.querySelectorAll(".entry-autosave-indicator");
    badges.forEach(b => {
        if (status === "saving") {
            b.innerHTML = `<i class="fa-solid fa-spinner fa-spin" style="color:#d97706;"></i> กำลังบันทึกข้อมูล...`;
            b.style.color = "#d97706";
        } else if (status === "saved") {
            b.innerHTML = `<i class="fa-solid fa-circle-check" style="color:#16a34a;"></i> บันทึกข้อมูลค้างไว้เสมอ`;
            b.style.color = "#16a34a";
        }
    });
}

function autoSaveEntryFormData(immediate = false) {
    const curYear = appState.selectedYear;
    const month = appState.selectedMonth;
    if (!curYear || !month) return;
    if (isMonthLocked(curYear, month)) return;

    ensureMonthStructure(curYear, month);

    const prodInput = document.getElementById("input-prod-vol");
    const remarksInput = document.getElementById("input-remarks");
    if (!prodInput) return; // Entry form DOM not loaded yet

    const prodVol = parseFloat(prodInput.value) || 0;
    const remarks = remarksInput ? remarksInput.value : "";

    // 1. Collect Water Meters
    const waterKey = `${curYear}_${month}`;
    if (!appState.waterMeters[waterKey]) appState.waterMeters[waterKey] = [];
    let totalWaterUsage = 0, totalWaterCost = 0;
    document.querySelectorAll(".entry-water-input").forEach(input => {
        const idx = parseInt(input.getAttribute("data-idx"));
        const field = input.getAttribute("data-field");
        const val = parseFloat(input.value) || 0;
        if (!appState.waterMeters[waterKey][idx]) {
            const defaultMet = [
                { id: 1, meterCode: "58470568 575-010 PS", houseNo: "949", location: "บ้านกู๋พจน์ คลัง 1,2" },
                { id: 2, meterCode: "74483678 732-900 PS", houseNo: "999/2", location: "ออฟฟิศคลัง 3" },
                { id: 3, meterCode: "74738048 732-905 PS", houseNo: "949/2", location: "คลัง 3 / คลัง 4" },
                { id: 4, meterCode: "58470550 575-015 PS", houseNo: "949/1", location: "โรงฆ่าเก่า" },
                { id: 5, meterCode: "74492802 732-903 PS", houseNo: "999/3", location: "เฟส 3,4" },
                { id: 6, meterCode: "74850389 / 56188667", houseNo: "949/4-949/7", location: "เฟส 5 / เฟส 6" },
                { id: 7, meterCode: "74074261 / 58456013", houseNo: "999", location: "โรงกุนเชียงตัวใหญ่ / ตัวเล็ก" }
            ][idx] || { id: idx + 1, meterCode: "-", houseNo: "-", location: "-" };
            appState.waterMeters[waterKey][idx] = { ...defaultMet, usage: 0, cost: 0 };
        }
        appState.waterMeters[waterKey][idx][field] = val;
        if (field === "usage") totalWaterUsage += val;
        if (field === "cost") totalWaterCost += val;
    });

    // 2. Collect Elec Meters
    const elecKey = `${curYear}_${month}`;
    if (!appState.elecMeters[elecKey]) appState.elecMeters[elecKey] = [];
    let totalElecUsage = 0, totalElecCost = 0;
    document.querySelectorAll(".entry-elec-input").forEach(input => {
        const idx = parseInt(input.getAttribute("data-idx"));
        const field = input.getAttribute("data-field");
        const val = parseFloat(input.value) || 0;
        if (!appState.elecMeters[elecKey][idx]) {
            const defaultMet = [
                { id: 1, meterCode: "55161825", houseNo: "949/1", location: "หน้าร้านเก่า" },
                { id: 2, meterCode: "55048446", houseNo: "999", location: "คลังสินค้า 1" },
                { id: 3, meterCode: "55117509", houseNo: "949", location: "บ้านกู๋พจน์" },
                { id: 4, meterCode: "55213319", houseNo: "999/2", location: "ออฟฟิสคลัง 3" },
                { id: 5, meterCode: "95746027", houseNo: "999/2-5", location: "คลังสินค้า 4" },
                { id: 6, meterCode: "95887241", houseNo: "999/5-949/7", location: "เฟส 5-เฟส 6" },
                { id: 7, meterCode: "95354741", houseNo: "999,999/1", location: "P&P" }
            ][idx] || { id: idx + 1, meterCode: "-", houseNo: "-", location: "-" };
            appState.elecMeters[elecKey][idx] = { ...defaultMet, usage: 0, cost: 0 };
        }
        appState.elecMeters[elecKey][idx][field] = val;
        if (field === "usage") totalElecUsage += val;
        if (field === "cost") totalElecCost += val;
    });

    // 3. Collect Fuel & Gas
    const fuelUsage = parseFloat(document.getElementById("input-fuel-usage")?.value) || 0;
    const fuelCost = parseFloat(document.getElementById("input-fuel-cost")?.value) || 0;
    const gasUsage = parseFloat(document.getElementById("input-gas-usage")?.value) || 0;
    const gasCost = parseFloat(document.getElementById("input-gas-cost")?.value) || 0;

    // 4. Update multiYearData in memory
    const targetMonth = appState.multiYearData[curYear][month];
    targetMonth.production = prodVol;
    targetMonth.note = remarks;

    const waterItem = targetMonth.items.find(i => i.name.includes("น้ำ") && !i.name.includes("น้ำมัน"));
    if (waterItem) {
        waterItem.usage = totalWaterUsage;
        waterItem.cost = totalWaterCost;
        waterItem.production = prodVol;
        waterItem.usagePerProd = prodVol > 0 ? (totalWaterUsage / prodVol) : 0;
        waterItem.costPerProd = prodVol > 0 ? (totalWaterCost / prodVol) : 0;
    }

    const elecItem = targetMonth.items.find(i => i.name.includes("ไฟฟ้า"));
    if (elecItem) {
        elecItem.usage = totalElecUsage;
        elecItem.cost = totalElecCost;
        elecItem.production = prodVol;
        elecItem.usagePerProd = prodVol > 0 ? (totalElecUsage / prodVol) : 0;
        elecItem.costPerProd = prodVol > 0 ? (totalElecCost / prodVol) : 0;
    }

    const fuelItem = targetMonth.items.find(i => i.name.includes("น้ำมัน"));
    if (fuelItem) {
        fuelItem.usage = fuelUsage;
        fuelItem.cost = fuelCost;
        fuelItem.production = prodVol;
        fuelItem.usagePerProd = prodVol > 0 ? (fuelUsage / prodVol) : 0;
        fuelItem.costPerProd = prodVol > 0 ? (fuelCost / prodVol) : 0;
    }

    const gasItem = targetMonth.items.find(i => i.name.includes("แก๊ส") || i.name.includes("LPG"));
    if (gasItem) {
        gasItem.usage = gasUsage;
        gasItem.cost = gasCost;
        gasItem.production = prodVol;
        gasItem.usagePerProd = prodVol > 0 ? (gasUsage / prodVol) : 0;
        gasItem.costPerProd = prodVol > 0 ? (gasCost / prodVol) : 0;
    }

    let grandTot = 0;
    targetMonth.items.forEach(it => grandTot += (parseFloat(it.cost) || 0));
    targetMonth.totalCost = grandTot;
    targetMonth.updatedAt = new Date().toLocaleString('th-TH');

    updateAutoSaveBadge("saving");

    const doSave = () => {
        saveStateToStorage();
        updateAutoSaveBadge("saved");
    };

    if (immediate) {
        if (autoSaveTimer) clearTimeout(autoSaveTimer);
        doSave();
    } else {
        if (autoSaveTimer) clearTimeout(autoSaveTimer);
        autoSaveTimer = setTimeout(doSave, 300);
    }
}

function loadEntryFormData(month) {
    const curYear = appState.selectedYear;
    const yearData = appState.multiYearData[curYear] || {};
    const mData = yearData[month] || { production: 0, items: [], note: "" };
    const locked = isMonthLocked(curYear, month);
    
    document.getElementById("input-prod-vol").value = (mData.production && mData.production > 0) ? mData.production : "";
    document.getElementById("input-remarks").value = mData.note || "";

    const waterKey = `${curYear}_${month}`;
    let waterList = appState.waterMeters[waterKey];
    
    const isWaterEmpty = !waterList || !Array.isArray(waterList) || waterList.length === 0 || 
                         waterList.every(it => (!it.cost || it.cost === 0) && (!it.usage || it.usage === 0));
    
    const initWaterSource = (typeof ALL_INITIAL_WATER_METERS !== 'undefined' && ALL_INITIAL_WATER_METERS[curYear])
        ? ALL_INITIAL_WATER_METERS[curYear][month]
        : (curYear === 2568 && typeof INITIAL_WATER_METERS !== 'undefined' ? INITIAL_WATER_METERS[month] : null);

    if (isWaterEmpty && initWaterSource && initWaterSource.some(it => (it.cost && it.cost > 0) || (it.usage && it.usage > 0))) {
        waterList = JSON.parse(JSON.stringify(initWaterSource));
        appState.waterMeters[waterKey] = waterList;
    } else if (!waterList || !Array.isArray(waterList) || waterList.length === 0) {
        waterList = [
            { id: 1, meterCode: "58470568 575-010 PS", houseNo: "949", location: "บ้านกู๋พจน์ คลัง 1,2", usage: 0, cost: 0 },
            { id: 2, meterCode: "74483678 732-900 PS", houseNo: "999/2", location: "ออฟฟิศคลัง 3", usage: 0, cost: 0 },
            { id: 3, meterCode: "74738048 732-905 PS", houseNo: "949/2", location: "คลัง 3 / คลัง 4", usage: 0, cost: 0 },
            { id: 4, meterCode: "58470550 575-015 PS", houseNo: "949/1", location: "โรงฆ่าเก่า", usage: 0, cost: 0 },
            { id: 5, meterCode: "74492802 732-903 PS", houseNo: "999/3", location: "เฟส 3,4", usage: 0, cost: 0 },
            { id: 6, meterCode: "74850389 / 56188667", houseNo: "949/4-949/7", location: "เฟส 5 / เฟส 6", usage: 0, cost: 0 },
            { id: 7, meterCode: "74074261 / 58456013", houseNo: "999", location: "โรงกุนเชียงตัวใหญ่ / ตัวเล็ก", usage: 0, cost: 0 }
        ];
        appState.waterMeters[waterKey] = waterList;
    }

    const waterTbody = document.getElementById("entry-water-tbody");
    if (waterTbody) {
        let html = "";
        waterList.forEach((m, idx) => {
            const usageVal = (m.usage && m.usage > 0) ? m.usage : "";
            const costVal = (m.cost && m.cost > 0) ? (Number(m.cost)).toFixed(2) : "";
            html += `
            <tr>
                <td>${m.id}</td>
                <td><strong>${m.meterCode}</strong></td>
                <td>${m.houseNo}</td>
                <td>${m.location}</td>
                <td><input type="number" step="any" class="form-control form-control-sm entry-water-input ${locked ? 'locked-input' : ''}" ${locked ? 'disabled' : ''} data-idx="${idx}" data-field="usage" value="${usageVal}" placeholder="0" onfocus="this.select()" oninput="handleEntryInput(this)"></td>
                <td><input type="number" step="any" class="form-control form-control-sm entry-water-input ${locked ? 'locked-input' : ''}" ${locked ? 'disabled' : ''} data-idx="${idx}" data-field="cost" value="${costVal}" placeholder="0.00" onfocus="this.select()" oninput="handleEntryInput(this)"></td>
            </tr>`;
        });
        waterTbody.innerHTML = html;
    }

    const elecKey = `${curYear}_${month}`;
    let elecList = appState.elecMeters[elecKey];

    const isElecEmpty = !elecList || !Array.isArray(elecList) || elecList.length === 0 || 
                        elecList.every(it => (!it.cost || it.cost === 0) && (!it.usage || it.usage === 0));

    const initElecSource = (typeof ALL_INITIAL_ELEC_METERS !== 'undefined' && ALL_INITIAL_ELEC_METERS[curYear])
        ? ALL_INITIAL_ELEC_METERS[curYear][month]
        : (curYear === 2568 && typeof INITIAL_ELEC_METERS !== 'undefined' ? INITIAL_ELEC_METERS[month] : null);

    if (isElecEmpty && initElecSource && initElecSource.some(it => (it.cost && it.cost > 0) || (it.usage && it.usage > 0))) {
        elecList = JSON.parse(JSON.stringify(initElecSource));
        appState.elecMeters[elecKey] = elecList;
    } else if (!elecList || !Array.isArray(elecList) || elecList.length === 0) {
        elecList = [
            { id: 1, meterCode: "55161825", houseNo: "949/1", location: "หน้าร้านเก่า", usage: 0, cost: 0 },
            { id: 2, meterCode: "55048446", houseNo: "999", location: "คลังสินค้า 1", usage: 0, cost: 0 },
            { id: 3, meterCode: "55117509", houseNo: "949", location: "บ้านกู๋พจน์", usage: 0, cost: 0 },
            { id: 4, meterCode: "55213319", houseNo: "999/2", location: "ออฟฟิสคลัง 3", usage: 0, cost: 0 },
            { id: 5, meterCode: "95746027", houseNo: "999/2-5", location: "คลังสินค้า 4", usage: 0, cost: 0 },
            { id: 6, meterCode: "95887241", houseNo: "999/5-949/7", location: "เฟส 5-เฟส 6", usage: 0, cost: 0 },
            { id: 7, meterCode: "95354741", houseNo: "999,999/1", location: "P&P", usage: 0, cost: 0 }
        ];
        appState.elecMeters[elecKey] = elecList;
    }

    const elecTbody = document.getElementById("entry-elec-tbody");
    if (elecTbody) {
        let html = "";
        elecList.forEach((m, idx) => {
            const usageVal = (m.usage && m.usage > 0) ? m.usage : "";
            const costVal = (m.cost && m.cost > 0) ? (Number(m.cost)).toFixed(2) : "";
            html += `
            <tr>
                <td>${m.id}</td>
                <td><strong>${m.meterCode}</strong></td>
                <td>${m.houseNo}</td>
                <td>${m.location}</td>
                <td><input type="number" step="any" class="form-control form-control-sm entry-elec-input ${locked ? 'locked-input' : ''}" ${locked ? 'disabled' : ''} data-idx="${idx}" data-field="usage" value="${usageVal}" placeholder="0" onfocus="this.select()" oninput="handleEntryInput(this)"></td>
                <td><input type="number" step="any" class="form-control form-control-sm entry-elec-input ${locked ? 'locked-input' : ''}" ${locked ? 'disabled' : ''} data-idx="${idx}" data-field="cost" value="${costVal}" placeholder="0.00" onfocus="this.select()" oninput="handleEntryInput(this)"></td>
            </tr>`;
        });
        elecTbody.innerHTML = html;
    }

    let fuelObj = (mData.items || []).find(i => i.name.includes("น้ำมัน")) || { usage: 0, cost: 0 };
    let gasObj = (mData.items || []).find(i => i.name.includes("แก๊ส") || i.name.includes("LPG")) || { usage: 0, cost: 0 };

    document.getElementById("input-fuel-usage").value = (fuelObj.usage && fuelObj.usage > 0) ? fuelObj.usage : "";
    document.getElementById("input-fuel-cost").value = (fuelObj.cost && fuelObj.cost > 0) ? fuelObj.cost : "";
    document.getElementById("input-gas-usage").value = (gasObj.usage && gasObj.usage > 0) ? gasObj.usage : "";
    document.getElementById("input-gas-cost").value = (gasObj.cost && gasObj.cost > 0) ? gasObj.cost : "";

    calculateEntryFormSummary();
    applyEntryFormLockState(locked);
}

function calculateEntryFormSummary() {
    const prodVol = parseFloat(document.getElementById("input-prod-vol").value) || 0;

    let totalWaterUsage = 0, totalWaterCost = 0;
    document.querySelectorAll(".entry-water-input[data-field='usage']").forEach(input => {
        totalWaterUsage += parseFloat(input.value) || 0;
    });
    document.querySelectorAll(".entry-water-input[data-field='cost']").forEach(input => {
        totalWaterCost += parseFloat(input.value) || 0;
    });

    let totalElecUsage = 0, totalElecCost = 0;
    document.querySelectorAll(".entry-elec-input[data-field='usage']").forEach(input => {
        totalElecUsage += parseFloat(input.value) || 0;
    });
    document.querySelectorAll(".entry-elec-input[data-field='cost']").forEach(input => {
        totalElecCost += parseFloat(input.value) || 0;
    });

    const fuelUsage = parseFloat(document.getElementById("input-fuel-usage").value) || 0;
    const fuelCost = parseFloat(document.getElementById("input-fuel-cost").value) || 0;

    const gasUsage = parseFloat(document.getElementById("input-gas-usage").value) || 0;
    const gasCost = parseFloat(document.getElementById("input-gas-cost").value) || 0;

    updateStatusBadge("status-water", totalWaterCost > 0 || totalWaterUsage > 0);
    updateStatusBadge("status-elec", totalElecCost > 0 || totalElecUsage > 0);
    updateStatusBadge("status-fuel", fuelCost > 0 || fuelUsage > 0);
    updateStatusBadge("status-gas", gasCost > 0 || gasUsage > 0);

    document.getElementById("res-water-usage").textContent = totalWaterUsage.toLocaleString('th-TH');
    document.getElementById("res-water-cost").textContent = totalWaterCost.toLocaleString('th-TH', {minimumFractionDigits: 2}) + " ฿";
    document.getElementById("res-water-cost-ratio").textContent = (prodVol > 0 ? (totalWaterCost / prodVol) : 0).toFixed(2) + " ฿/ตัว";

    document.getElementById("res-elec-usage").textContent = totalElecUsage.toLocaleString('th-TH');
    document.getElementById("res-elec-cost").textContent = totalElecCost.toLocaleString('th-TH', {minimumFractionDigits: 2}) + " ฿";
    document.getElementById("res-elec-cost-ratio").textContent = (prodVol > 0 ? (totalElecCost / prodVol) : 0).toFixed(2) + " ฿/ตัว";

    document.getElementById("res-fuel-usage").textContent = fuelUsage.toLocaleString('th-TH');
    document.getElementById("res-fuel-cost").textContent = fuelCost.toLocaleString('th-TH', {minimumFractionDigits: 2}) + " ฿";
    document.getElementById("res-fuel-cost-ratio").textContent = (prodVol > 0 ? (fuelCost / prodVol) : 0).toFixed(2) + " ฿/ตัว";

    document.getElementById("res-gas-usage").textContent = gasUsage.toLocaleString('th-TH');
    document.getElementById("res-gas-cost").textContent = gasCost.toLocaleString('th-TH', {minimumFractionDigits: 2}) + " ฿";
    document.getElementById("res-gas-cost-ratio").textContent = (prodVol > 0 ? (gasCost / prodVol) : 0).toFixed(2) + " ฿/ตัว";

    const grandTotalCost = totalWaterCost + totalElecCost + fuelCost + gasCost;
    const grandTotalRatio = prodVol > 0 ? (grandTotalCost / prodVol) : 0;

    document.getElementById("entry-grand-total-cost").textContent = grandTotalCost.toLocaleString('th-TH', {minimumFractionDigits: 2}) + " ฿";
    document.getElementById("entry-grand-total-ratio").textContent = grandTotalRatio.toFixed(2) + " ฿/ตัว";
}

function updateStatusBadge(elementId, isRecorded) {
    const el = document.getElementById(elementId);
    if (!el) return;
    if (isRecorded) {
        el.className = "badge badge-status-done";
        el.innerHTML = `<i class="fa-solid fa-circle-check"></i> บันทึกแล้ว`;
    } else {
        el.className = "badge badge-status-pending";
        el.innerHTML = `<i class="fa-solid fa-clock"></i> รอลงบันทึก`;
    }
}

function saveResource(resourceType, skipRefresh = false) {
    if (!checkAuthPermission("บันทึกข้อมูลทรัพยากร")) return;

    const month = appState.selectedMonth;
    const year = appState.selectedYear;
    const prodVol = parseFloat(document.getElementById("input-prod-vol").value) || 0;
    const nowStr = new Date().toLocaleString('th-TH');

    // FIX #6: Input Validation
    if (prodVol < 0 || prodVol > 9999999) {
        alert("ยอดการผลิตไม่สมเหตุสมผล โปรดตรวจสอบอีกครั้ง");
        return;
    }

    ensureMonthStructure(year, month);

    if (resourceType === 'water') {
        let totalWaterUsage = 0, totalWaterCost = 0;
        const waterKey = `${year}_${month}`;
        appState.waterMeters[waterKey] = [];

        document.querySelectorAll(".entry-water-input").forEach(input => {
            const idx = parseInt(input.getAttribute("data-idx"));
            const field = input.getAttribute("data-field");
            const val = parseFloat(input.value) || 0;
            
            if (!appState.waterMeters[waterKey][idx]) {
                const defaultMet = [
                    { id: 1, meterCode: "58470568 575-010 PS", houseNo: "949", location: "บ้านกู๋พจน์ คลัง 1,2" },
                    { id: 2, meterCode: "74483678 732-900 PS", houseNo: "999/2", location: "ออฟฟิศคลัง 3" },
                    { id: 3, meterCode: "74738048 732-905 PS", houseNo: "949/2", location: "คลัง 3 / คลัง 4" },
                    { id: 4, meterCode: "58470550 575-015 PS", houseNo: "949/1", location: "โรงฆ่าเก่า" },
                    { id: 5, meterCode: "74492802 732-903 PS", houseNo: "999/3", location: "เฟส 3,4" },
                    { id: 6, meterCode: "74850389 / 56188667", houseNo: "949/4-949/7", location: "เฟส 5 / เฟส 6" },
                    { id: 7, meterCode: "74074261 / 58456013", houseNo: "999", location: "โรงกุนเชียงตัวใหญ่ / ตัวเล็ก" }
                ][idx];
                appState.waterMeters[waterKey][idx] = { ...defaultMet, usage: 0, cost: 0 };
            }
            appState.waterMeters[waterKey][idx][field] = val;

            if (field === 'usage') totalWaterUsage += val;
            if (field === 'cost') totalWaterCost += val;
        });

        const waterItem = appState.multiYearData[year][month].items.find(i => i.name.includes("น้ำ") && !i.name.includes("น้ำมัน"));
        if (waterItem) {
            waterItem.usage = totalWaterUsage;
            waterItem.cost = totalWaterCost;
            waterItem.production = prodVol;
            waterItem.usagePerProd = prodVol > 0 ? totalWaterUsage / prodVol : 0;
            waterItem.costPerProd = prodVol > 0 ? totalWaterCost / prodVol : 0;
        }
        if (!skipRefresh) showToast(`บันทึกเฉพาะ ค่าน้ำ เดือน ${month} ${year} เรียบร้อยแล้ว (ล็อกเป็นสีเทา)`);
    } else if (resourceType === 'elec') {
        let totalElecUsage = 0, totalElecCost = 0;
        const elecKey = `${year}_${month}`;
        appState.elecMeters[elecKey] = [];

        document.querySelectorAll(".entry-elec-input").forEach(input => {
            const idx = parseInt(input.getAttribute("data-idx"));
            const field = input.getAttribute("data-field");
            const val = parseFloat(input.value) || 0;

            if (!appState.elecMeters[elecKey][idx]) {
                const defaultMet = [
                    { id: 1, meterCode: "55161825", houseNo: "949/1", location: "หน้าร้านเก่า" },
                    { id: 2, meterCode: "55048446", houseNo: "999", location: "คลังสินค้า 1" },
                    { id: 3, meterCode: "55117509", houseNo: "949", location: "บ้านกู๋พจน์" },
                    { id: 4, meterCode: "55213319", houseNo: "999/2", location: "ออฟฟิสคลัง 3" },
                    { id: 5, meterCode: "95746027", houseNo: "999/2-5", location: "คลังสินค้า 4" },
                    { id: 6, meterCode: "95887241", houseNo: "999/5-949/7", location: "เฟส 5-เฟส 6" },
                    { id: 7, meterCode: "95354741", houseNo: "999,999/1", location: "P&P" }
                ][idx];
                appState.elecMeters[elecKey][idx] = { ...defaultMet, usage: 0, cost: 0 };
            }
            appState.elecMeters[elecKey][idx][field] = val;

            if (field === 'usage') totalElecUsage += val;
            if (field === 'cost') totalElecCost += val;
        });

        const elecItem = appState.multiYearData[year][month].items.find(i => i.name.includes("ไฟฟ้า"));
        if (elecItem) {
            elecItem.usage = totalElecUsage;
            elecItem.cost = totalElecCost;
            elecItem.production = prodVol;
            elecItem.usagePerProd = prodVol > 0 ? totalElecUsage / prodVol : 0;
            elecItem.costPerProd = prodVol > 0 ? totalElecCost / prodVol : 0;
        }
        if (!skipRefresh) showToast(`บันทึกเฉพาะ ค่าไฟฟ้า เดือน ${month} ${year} เรียบร้อยแล้ว (ล็อกเป็นสีเทา)`);
    } else if (resourceType === 'fuel') {
        const fuelUsage = parseFloat(document.getElementById("input-fuel-usage").value) || 0;
        const fuelCost = parseFloat(document.getElementById("input-fuel-cost").value) || 0;
        const fuelItem = appState.multiYearData[year][month].items.find(i => i.name.includes("น้ำมัน"));
        if (fuelItem) {
            fuelItem.usage = fuelUsage;
            fuelItem.cost = fuelCost;
            fuelItem.production = prodVol;
            fuelItem.usagePerProd = prodVol > 0 ? fuelUsage / prodVol : 0;
            fuelItem.costPerProd = prodVol > 0 ? fuelCost / prodVol : 0;
        }
        if (!skipRefresh) showToast(`บันทึกเฉพาะ น้ำมันเชื้อเพลิง เดือน ${month} ${year} เรียบร้อยแล้ว (ล็อกเป็นสีเทา)`);
    } else if (resourceType === 'gas') {
        const gasUsage = parseFloat(document.getElementById("input-gas-usage").value) || 0;
        const gasCost = parseFloat(document.getElementById("input-gas-cost").value) || 0;
        const gasItem = appState.multiYearData[year][month].items.find(i => i.name.includes("แก๊ส") || i.name.includes("LPG"));
        if (gasItem) {
            gasItem.usage = gasUsage;
            gasItem.cost = gasCost;
            gasItem.production = prodVol;
            gasItem.usagePerProd = prodVol > 0 ? gasUsage / prodVol : 0;
            gasItem.costPerProd = prodVol > 0 ? gasCost / prodVol : 0;
        }
        if (!skipRefresh) showToast(`บันทึกเฉพาะ แก๊ส (LPG) เดือน ${month} ${year} เรียบร้อยแล้ว (ล็อกเป็นสีเทา)`);
    }

    let grandTot = 0;
    appState.multiYearData[year][month].items.forEach(it => grandTot += (parseFloat(it.cost) || 0));
    appState.multiYearData[year][month].totalCost = grandTot;
    appState.multiYearData[year][month].production = prodVol;
    appState.multiYearData[year][month].updatedAt = nowStr;

    if (!skipRefresh) {
        appState.multiYearData[year][month].isLocked = true;
        appState.isEditing = false;
        appState.editingMonth = null;
        appState.previousSnapshot = null;
        saveStateToStorage();
        if (typeof sheetsService !== 'undefined' && sheetsService.isConfigured()) {
            sheetsService.saveMonthToSheets(year, month);
        }
        cancelEditMode();
        refreshAllViews();
    }
}

// FIX #1: Dedicated function to save production volume with validation
function saveProdVol() {
    if (!checkAuthPermission("บันทึกยอดผลิต")) return;

    const month = appState.selectedMonth;
    const year = appState.selectedYear;
    const prodInput = document.getElementById("input-prod-vol");
    const prodVol = parseFloat(prodInput.value);

    if (isNaN(prodVol) || prodInput.value === "") {
        alert("โปรดกรอกยอดการผลิต (จำนวนตัว)");
        return;
    }
    if (prodVol < 0 || prodVol > 9999999) {
        alert("ยอดการผลิตไม่สมเหตุสมผล (0 – 9,999,999) โปรดตรวจสอบอีกครั้ง");
        return;
    }

    ensureMonthStructure(year, month);
    appState.multiYearData[year][month].production = prodVol;
    // Update production in all items too
    (appState.multiYearData[year][month].items || []).forEach(it => {
        it.production = prodVol;
        it.usagePerProd = prodVol > 0 ? (it.usage / prodVol) : 0;
        it.costPerProd  = prodVol > 0 ? (it.cost  / prodVol) : 0;
    });
    appState.multiYearData[year][month].updatedAt = new Date().toLocaleString('th-TH');
    appState.multiYearData[year][month].isLocked = true;
    appState.isEditing = false;
    appState.editingMonth = null;
    appState.previousSnapshot = null;

    saveStateToStorage();
    if (typeof sheetsService !== 'undefined' && sheetsService.isConfigured()) {
        sheetsService.saveMonthToSheets(year, month);
    }
    cancelEditMode();
    refreshAllViews();
    showToast(`✅ บันทึกยอดการผลิต ${prodVol.toLocaleString('th-TH')} ตัว เดือน ${month} ${year} เรียบร้อยแล้ว (ล็อกเป็นสีเทา)`);
}

function ensureMonthStructure(year, month) {
    if (!appState.multiYearData[year]) appState.multiYearData[year] = {};
    if (!appState.multiYearData[year][month]) {
        appState.multiYearData[year][month] = {
            month: month,
            year: year,
            production: 0,
            items: [
                { id: 1, name: "น้ำ", usage: 0, unit: "ลบ.ม.", cost: 0, production: 0, usagePerProd: 0, costPerProd: 0 },
                { id: 2, name: "ไฟฟ้า", usage: 0, unit: "kWh", cost: 0, production: 0, usagePerProd: 0, costPerProd: 0 },
                { id: 3, name: "น้ำมันเชื้อเพลิง", usage: 0, unit: "ลิตร", cost: 0, production: 0, usagePerProd: 0, costPerProd: 0 },
                { id: 4, name: "แก๊ส (LPG)", usage: 0, unit: "กิโลกรัม", cost: 0, production: 0, usagePerProd: 0, costPerProd: 0 }
            ],
            totalCost: 0,
            note: "-",
            creator: "ผู้จัดทำ (QA)",
            inspector: "ผู้ตรวจสอบ (EMR)",
            isLocked: false
        };
    }
}

function saveEntryForm() {
    if (!checkAuthPermission("บันทึกฟอร์มข้อมูลทั้งหมด")) return;

    const month = appState.selectedMonth;
    const year = appState.selectedYear;
    const prodVol = parseFloat(document.getElementById("input-prod-vol").value) || 0;
    const remarks = document.getElementById("input-remarks").value;
    const editReason = document.getElementById("input-edit-reason")?.value || "";

    if (appState.isEditing && !editReason.trim()) {
        alert("โปรดระบุสาเหตุในการแก้ไขข้อมูลก่อนกดบันทึก");
        document.getElementById("input-edit-reason").focus();
        return;
    }

    saveResource('water', true);
    saveResource('elec', true);
    saveResource('fuel', true);
    saveResource('gas', true);

    appState.multiYearData[year][month].note = remarks;
    const nowStr = new Date().toLocaleString('th-TH');
    appState.multiYearData[year][month].updatedAt = nowStr;

    if (appState.isEditing && appState.previousSnapshot) {
        const prev = appState.previousSnapshot;
        const grandTotalCost = appState.multiYearData[year][month].totalCost;

        const changes = [];
        if (prev.production !== prodVol) {
            changes.push(`ยอดการผลิต: ${prev.production?.toLocaleString() || 0} ตัว ➔ ${prodVol.toLocaleString()} ตัว`);
        }
        if (prev.totalCost !== grandTotalCost) {
            changes.push(`รวมค่าพลังงาน: ${(prev.totalCost || 0).toLocaleString('th-TH', {minimumFractionDigits: 2})} ฿ ➔ ${grandTotalCost.toLocaleString('th-TH', {minimumFractionDigits: 2})} ฿`);
        }

        const auditEntry = {
            id: Date.now(),
            timestamp: nowStr,
            month: `${month} ${year}`,
            reason: editReason,
            changes: changes.length > 0 ? changes : ["ปรับปรุงรายละเอียดมิเตอร์ย่อย / หมายเหตุ"],
            editor: appState.currentUser ? `ผู้แก้ไข (${appState.currentUser})` : "ผู้แก้ไขระบบ (QA/EMR)"
        };

        appState.auditLogs.unshift(auditEntry);
        showToast(`✅ บันทึกประวัติการแก้ไขข้อมูลเดือน ${month} ${year} เรียบร้อยแล้ว (ล็อกเป็นสีเทา)`);
    } else {
        showToast(`✅ บันทึกข้อมูลประจำเดือน ${month} ${year} เรียบร้อยแล้ว (ล็อกเป็นสีเทา)`);
    }

    appState.multiYearData[year][month].isLocked = true;
    appState.isEditing = false;
    appState.editingMonth = null;
    appState.previousSnapshot = null;

    saveStateToStorage();
    if (typeof sheetsService !== 'undefined' && sheetsService.isConfigured()) {
        sheetsService.saveMonthToSheets(year, month);
    }
    cancelEditMode();
    refreshAllViews();
}

// ----------------------------------------------------
// RECORDS HISTORY VIEW RENDERERS
// ----------------------------------------------------
function renderHistoryView() {
    const mainTbody = document.getElementById("history-table-body");
    const dashTbody = document.getElementById("dash-history-table-body");
    
    if (!mainTbody && !dashTbody) return;

    const selectedYear = appState.selectedYear;
    const allowedMonths = selectedYear === CURRENT_REAL_YEAR 
        ? ALL_MONTHS.slice(0, CURRENT_REAL_MONTH_IDX + 1)
        : ALL_MONTHS;

    let html = "";
    const curYearData = appState.multiYearData[selectedYear] || {};

    allowedMonths.forEach(m => {
        const mData = curYearData[m] || { items: [], production: 0 };
        let w = 0, e = 0, f = 0, g = 0, tot = 0;
        
        (mData.items || []).forEach(it => {
            const cost = parseFloat(it.cost) || 0;
            tot += cost;
            if (it.name.includes("น้ำ") && !it.name.includes("น้ำมัน")) w += cost;
            else if (it.name.includes("ไฟฟ้า")) e += cost;
            else if (it.name.includes("น้ำมัน")) f += cost;
            else if (it.name.includes("แก๊ส") || it.name.includes("LPG")) g += cost;
        });

        const costPerProd = mData.production > 0 ? (tot / mData.production) : 0;
        const lastUpdated = mData.updatedAt || (tot > 0 ? `ไฟล์ต้นฉบับ ${selectedYear}` : "รอลงบันทึก");

        const editBtnHtml = appState.isLoggedIn 
            ? `<button class="btn btn-warning btn-sm" onclick="startEditMode('${m}')"><i class="fa-solid fa-pen-to-square"></i> แก้ไข</button>`
            : `<button class="btn btn-secondary btn-sm" onclick="showLoginModal('โปรดเข้าสู่ระบบเพื่อแก้ไขข้อมูล')"><i class="fa-solid fa-lock"></i> แก้ไข</button>`;

        html += `
        <tr>
            <td><strong>${m} ${selectedYear}</strong></td>
            <td>${(mData.production || 0).toLocaleString('th-TH')} ตัว</td>
            <td>${w.toLocaleString('th-TH', {minimumFractionDigits: 2})} ฿</td>
            <td>${e.toLocaleString('th-TH', {minimumFractionDigits: 2})} ฿</td>
            <td>${f.toLocaleString('th-TH', {minimumFractionDigits: 2})} ฿</td>
            <td>${g.toLocaleString('th-TH', {minimumFractionDigits: 2})} ฿</td>
            <td style="font-weight:700; color:var(--color-primary);">${tot.toLocaleString('th-TH', {minimumFractionDigits: 2})} ฿</td>
            <td style="font-weight:700; color:var(--color-accent);">${costPerProd.toFixed(2)} ฿/ตัว</td>
            <td style="font-size:0.8rem; color:var(--text-muted);">${lastUpdated}</td>
            <td>
                ${editBtnHtml}
                <button class="btn btn-secondary btn-sm" onclick="viewMonthSheet('${m}')">
                    <i class="fa-solid fa-table-cells"></i> สเปรดชีต
                </button>
            </td>
        </tr>`;
    });

    if (mainTbody) mainTbody.innerHTML = html;
    if (dashTbody) dashTbody.innerHTML = html;
}

function viewMonthSheet(month) {
    appState.selectedMonth = month;
    document.querySelectorAll("#entry-month-select, #sheet-month-select").forEach(s => s.value = month);
    switchView("sheet-view");
}

// ----------------------------------------------------
// AUDIT LOG TRAIL RENDERER
// ----------------------------------------------------
function renderAuditView() {
    const container = document.getElementById("audit-logs-container");
    if (!container) return;

    if (appState.auditLogs.length === 0) {
        container.innerHTML = `
        <div style="text-align:center; padding: 3rem 1rem; color:var(--text-muted);">
            <i class="fa-solid fa-clipboard-check" style="font-size:3rem; margin-bottom:1rem; opacity:0.3;"></i>
            <p style="font-size:1.05rem;">ยังไม่มีประวัติการแก้ไขข้อมูลกรณีผิดพลาด</p>
            <p style="font-size:0.85rem; margin-top:5px;">เมื่อมีการแก้ไขข้อมูลในหน้าประวัติการบันทึก ระบบจะบันทึกประวัติไว้ที่นี่ให้อัตโนมัติ</p>
        </div>`;
        return;
    }

    let html = "";
    appState.auditLogs.forEach(log => {
        const changeListHtml = log.changes.map(c => `<div>• ${c}</div>`).join("");
        html += `
        <div class="audit-item">
            <div class="audit-header">
                <div class="audit-title">
                    <i class="fa-solid fa-pen-to-square" style="color:#d97706;"></i>
                    แก้ไขข้อมูล: <strong>${log.month}</strong>
                </div>
                <div class="audit-date"><i class="fa-regular fa-clock"></i> ${log.timestamp}</div>
            </div>
            <div style="font-size:0.9rem; margin-bottom:6px;">
                <strong>สาเหตุการแก้ไข:</strong> <span style="color:#b45309; font-weight:600;">${log.reason}</span>
            </div>
            <div class="audit-changes">
                <div style="font-weight:700; margin-bottom:4px; color:var(--text-primary);">รายการที่มีการเปลี่ยนแปลง:</div>
                ${changeListHtml}
            </div>
            <div style="font-size:0.75rem; color:var(--text-muted); margin-top:8px; text-align:right;">
                บันทึกโดย: ${log.editor}
            </div>
        </div>`;
    });

    container.innerHTML = html;
}

// ----------------------------------------------------
// EXCEL SHEET VIEW & EXPORT
// ----------------------------------------------------
function renderSheetView(month) {
    const selectedYear = appState.selectedYear;
    const curYearData = appState.multiYearData[selectedYear] || {};
    const mData = curYearData[month] || { production: 0, items: [], note: "" };
    
    document.getElementById("sheet-title").textContent = `สรุปค่าใช้จ่ายด้านพลังงาน ประจำเดือน ${month} ${selectedYear}`;
    
    const tbody = document.getElementById("sheet-tbody");
    if (!tbody) return;

    let html = "";
    let grandCost = 0;
    let grandUsage = 0;

    (mData.items || []).forEach(it => {
        grandCost += parseFloat(it.cost) || 0;
        grandUsage += parseFloat(it.usage) || 0;
        const uRatio = mData.production > 0 ? (it.usage / mData.production) : 0;
        const cRatio = mData.production > 0 ? (it.cost / mData.production) : 0;

        html += `
        <tr>
            <td style="text-align:center;">${it.id}</td>
            <td><strong>${it.name}</strong></td>
            <td style="text-align:right;">${(it.usage || 0).toLocaleString('th-TH')}</td>
            <td style="text-align:center;">${it.unit}</td>
            <td style="text-align:right; font-weight:600;">${(it.cost || 0).toLocaleString('th-TH', {minimumFractionDigits: 2})}</td>
            <td style="text-align:right;">${(mData.production || 0).toLocaleString('th-TH')}</td>
            <td style="text-align:right;">${uRatio.toFixed(2)}</td>
            <td style="text-align:right; font-weight:700; color:var(--color-primary);">${cRatio.toFixed(2)}</td>
        </tr>`;
    });

    const totUsageRatio = mData.production > 0 ? (grandUsage / mData.production) : 0;
    const totCostRatio = mData.production > 0 ? (grandCost / mData.production) : 0;

    tbody.innerHTML = html;

    const tfoot = document.getElementById("sheet-tfoot");
    if (tfoot) {
        tfoot.innerHTML = `
        <tr style="font-weight:700; background:#e0e7ff;">
            <td style="text-align:center;">Total</td>
            <td>รวมทั้งหมด</td>
            <td style="text-align:right;">${grandUsage.toLocaleString('th-TH')}</td>
            <td style="text-align:center;">-</td>
            <td style="text-align:right; font-size:1.05rem; color:var(--color-primary);">${grandCost.toLocaleString('th-TH', {minimumFractionDigits: 2})}</td>
            <td style="text-align:right;">${(mData.production || 0).toLocaleString('th-TH')}</td>
            <td style="text-align:right;">${totUsageRatio.toFixed(2)}</td>
            <td style="text-align:right; font-size:1.05rem; color:var(--color-accent);">${totCostRatio.toFixed(2)}</td>
        </tr>`;
    }

    document.getElementById("sheet-remarks").textContent = mData.note || "-";
}

async function exportToExcel() {
    if (typeof ExcelJS === "undefined") {
        alert("กำลังโหลดระบบส่งออก Excel กรุณาลองใหม่อีกครั้ง");
        return;
    }

    showToast("กำลังสร้างไฟล์ Excel กรุณารอสักครู่...");

    const selectedYear = appState.selectedYear;
    const allowedMonths = selectedYear === CURRENT_REAL_YEAR 
        ? ALL_MONTHS.slice(0, CURRENT_REAL_MONTH_IDX + 1)
        : ALL_MONTHS;

    const curYearData = appState.multiYearData[selectedYear] || {};

    const wb = new ExcelJS.Workbook();
    wb.creator = "ระบบจัดการพลังงาน (Energy Management System)";
    wb.created = new Date();

    // -----------------------------------------------------------
    // 1. SHEET 1: สรุปภาพรวม [selectedYear]
    // -----------------------------------------------------------
    const wsSummary = wb.addWorksheet(`สรุปภาพรวม ${selectedYear}`, {
        views: [{ showGridLines: true }]
    });

    const totalColsCount = allowedMonths.length + 3; // Item + Months + Total + Ratio

    // Column Definitions & Widths
    wsSummary.columns = [
        { key: 'item', width: 30 },
        ...allowedMonths.map((m, i) => ({ key: `m${i+1}`, width: 16 })),
        { key: 'total', width: 20 },
        { key: 'ratio', width: 15 }
    ];

    // Helper: Convert column index (1-based) to letter
    function getColLetter(colIdx) {
        let temp, letter = '';
        while (colIdx > 0) {
            temp = (colIdx - 1) % 26;
            letter = String.fromCharCode(temp + 65) + letter;
            colIdx = Math.floor((colIdx - temp - 1) / 26);
        }
        return letter;
    }
    const lastColLetter = getColLetter(totalColsCount);

    // Row 1: Title
    wsSummary.mergeCells(`A1:${lastColLetter}1`);
    const tCell = wsSummary.getCell('A1');
    tCell.value = `สรุปค่าใช้จ่ายด้านพลังงาน ประจำปี ${selectedYear}`;
    tCell.font = { name: 'Cordia New', size: 19, bold: true, color: { argb: 'FF1E3A8A' } };
    tCell.alignment = { horizontal: 'center', vertical: 'middle' };
    wsSummary.getRow(1).height = 38;

    // Row 2: Subtitle
    wsSummary.mergeCells(`A2:${lastColLetter}2`);
    const subCell = wsSummary.getCell('A2');
    subCell.value = `รายงานสรุปค่าใช้จ่ายด้านพลังงาน 4 ประเภท เปรียบเทียบรายเดือน และต้นทุนเฉลี่ยต่อยอดการผลิตหมู (บาท/ตัว)`;
    subCell.font = { name: 'Cordia New', size: 13, italic: true, color: { argb: 'FF475569' } };
    subCell.alignment = { horizontal: 'center', vertical: 'middle' };
    wsSummary.getRow(2).height = 22;

    wsSummary.getRow(3).height = 12;

    // Row 4: Header
    const summaryHeaders = ['ชื่อพลังงาน', ...allowedMonths, 'Total (บาท)', 'สัดส่วน (%)'];
    const hRow = wsSummary.getRow(4);
    hRow.values = summaryHeaders;
    hRow.height = 30;
    hRow.eachCell((cell, colNum) => {
        cell.font = { name: 'Cordia New', size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A8A' } }; // Navy Blue
        cell.alignment = { horizontal: colNum === 1 ? 'left' : 'center', vertical: 'middle' };
        cell.border = {
            top: { style: 'thin', color: { argb: 'FF1E3A8A' } },
            left: { style: 'thin', color: { argb: 'FF3B82F6' } },
            bottom: { style: 'medium', color: { argb: 'FF0F172A' } },
            right: { style: 'thin', color: { argb: 'FF3B82F6' } }
        };
    });

    let waterCosts = [], elecCosts = [], fuelCosts = [], gasCosts = [], totalCosts = [], prods = [], costPerProds = [];
    let sumW = 0, sumE = 0, sumF = 0, sumG = 0, sumTot = 0, sumP = 0;

    allowedMonths.forEach(m => {
        const mData = curYearData[m] || { items: [], production: 0 };
        let w = 0, e = 0, f = 0, g = 0, tot = 0;
        (mData.items || []).forEach(it => {
            const cost = parseFloat(it.cost) || 0;
            tot += cost;
            if (it.name.includes("น้ำ") && !it.name.includes("น้ำมัน")) w += cost;
            else if (it.name.includes("ไฟฟ้า")) e += cost;
            else if (it.name.includes("น้ำมัน")) f += cost;
            else if (it.name.includes("แก๊ส") || it.name.includes("LPG")) g += cost;
        });
        waterCosts.push(w); elecCosts.push(e); fuelCosts.push(f); gasCosts.push(g); totalCosts.push(tot);
        const prod = parseFloat(mData.production) || 0;
        prods.push(prod);
        costPerProds.push(prod > 0 ? (tot / prod) : 0);

        sumW += w; sumE += e; sumF += f; sumG += g; sumTot += tot; sumP += prod;
    });

    const energyTypes = [
        { name: 'น้ำ', data: waterCosts, sum: sumW },
        { name: 'ไฟฟ้า', data: elecCosts, sum: sumE },
        { name: 'น้ำมันเชื้อเพลิง', data: fuelCosts, sum: sumF },
        { name: 'แก๊ส (LPG)', data: gasCosts, sum: sumG },
    ];

    energyTypes.forEach((et, idx) => {
        const rIdx = 5 + idx;
        const row = wsSummary.getRow(rIdx);
        const pct = sumTot > 0 ? (et.sum / sumTot) : 0;
        row.values = [et.name, ...et.data, et.sum, pct];
        row.height = 24;
        const bg = (idx % 2 === 0) ? 'FFFFFFFF' : 'FFF8FAFC';

        row.eachCell((cell, col) => {
            cell.font = { name: 'Cordia New', size: 13.5, bold: col === 1, color: { argb: 'FF0F172A' } };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
            cell.border = {
                top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
                left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
                bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
                right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
            };
            if (col === 1) {
                cell.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
            } else if (col === totalColsCount) {
                cell.alignment = { horizontal: 'right', vertical: 'middle' };
                cell.numFmt = '0.00%';
            } else {
                cell.alignment = { horizontal: 'right', vertical: 'middle' };
                cell.numFmt = '#,##0.00';
            }
        });
    });

    // Row 9: Total Row (ค่าใช้จ่ายรวม)
    const totRow = wsSummary.getRow(9);
    totRow.values = ['Total (ค่าใช้จ่ายรวม)', ...totalCosts, sumTot, 1.0];
    totRow.height = 28;
    totRow.eachCell((cell, col) => {
        cell.font = { name: 'Cordia New', size: 14, bold: true, color: { argb: 'FF1E3A8A' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } }; // Soft Gold
        cell.border = {
            top: { style: 'thin', color: { argb: 'FF94A3B8' } },
            left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
            bottom: { style: 'double', color: { argb: 'FF0F172A' } }, // Accounting double underline
            right: { style: 'thin', color: { argb: 'FFCBD5E1' } }
        };
        if (col === 1) {
            cell.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
        } else if (col === totalColsCount) {
            cell.alignment = { horizontal: 'right', vertical: 'middle' };
            cell.numFmt = '0.00%';
        } else {
            cell.alignment = { horizontal: 'right', vertical: 'middle' };
            cell.numFmt = '#,##0.00';
        }
    });

    wsSummary.getRow(10).height = 16;

    // Row 11: Production & Unit Cost Section Header
    const prodHRow = wsSummary.getRow(11);
    prodHRow.values = ['รายการวิเคราะห์ต้นทุน', ...allowedMonths, 'รวมทั้งปี / เฉลี่ย', 'หน่วย'];
    prodHRow.height = 28;
    prodHRow.eachCell((cell, col) => {
        cell.font = { name: 'Cordia New', size: 13.5, bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF334155' } }; // Dark Slate
        cell.alignment = { horizontal: col === 1 ? 'left' : 'center', vertical: 'middle' };
        cell.border = {
            top: { style: 'thin', color: { argb: 'FF334155' } },
            left: { style: 'thin', color: { argb: 'FF64748B' } },
            bottom: { style: 'medium', color: { argb: 'FF0F172A' } },
            right: { style: 'thin', color: { argb: 'FF64748B' } }
        };
    });

    // Row 12: Production Volume (ยอดการผลิตหมู)
    const prodRow = wsSummary.getRow(12);
    prodRow.values = ['ยอดการผลิตหมู (ตัว)', ...prods, sumP, 'ตัว'];
    prodRow.height = 26;
    prodRow.eachCell((cell, col) => {
        cell.font = { name: 'Cordia New', size: 13.5, bold: true, color: { argb: 'FF0F172A' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
        cell.border = {
            top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
            left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
            bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
            right: { style: 'thin', color: { argb: 'FFCBD5E1' } }
        };
        if (col === 1) {
            cell.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
        } else if (col === totalColsCount) {
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
        } else {
            cell.alignment = { horizontal: 'right', vertical: 'middle' };
            cell.numFmt = '#,##0';
        }
    });

    // Row 13: Average Cost per Head (ค่าใช้จ่ายเฉลี่ย / ยอดผลิต)
    const avgCostPerP = sumP > 0 ? (sumTot / sumP) : 0;
    const costPRow = wsSummary.getRow(13);
    costPRow.values = ['ค่าใช้จ่ายเฉลี่ย / ยอดผลิต (บาท/ตัว)', ...costPerProds, avgCostPerP, 'บาท/ตัว'];
    costPRow.height = 28;
    costPRow.eachCell((cell, col) => {
        cell.font = { name: 'Cordia New', size: 14, bold: true, color: { argb: 'FF6B21A8' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFAF5FF' } }; // Soft Purple
        cell.border = {
            top: { style: 'thin', color: { argb: 'FFD8B4FE' } },
            left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
            bottom: { style: 'double', color: { argb: 'FF6B21A8' } },
            right: { style: 'thin', color: { argb: 'FFCBD5E1' } }
        };
        if (col === 1) {
            cell.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
        } else if (col === totalColsCount) {
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
        } else {
            cell.alignment = { horizontal: 'right', vertical: 'middle' };
            cell.numFmt = '#,##0.00';
        }
    });

    // -----------------------------------------------------------
    // 2. MONTHLY SHEETS (มกราคม, กุมภาพันธ์, ...)
    // -----------------------------------------------------------
    allowedMonths.forEach(m => {
        const mData = curYearData[m] || { items: [], production: 0 };
        const wsMonth = wb.addWorksheet(m, { views: [{ showGridLines: true }] });

        wsMonth.columns = [
            { key: 'id', width: 10 },
            { key: 'name', width: 26 },
            { key: 'usage', width: 20 },
            { key: 'unit', width: 14 },
            { key: 'cost', width: 22 },
            { key: 'prod', width: 24 },
            { key: 'usageRatio', width: 24 },
            { key: 'costRatio', width: 26 }
        ];

        // Title
        wsMonth.mergeCells('A1:H1');
        const tM = wsMonth.getCell('A1');
        tM.value = `สรุปค่าใช้จ่ายด้านพลังงาน ประจำเดือน ${m} ${selectedYear}`;
        tM.font = { name: 'Cordia New', size: 18, bold: true, color: { argb: 'FF1E3A8A' } };
        tM.alignment = { horizontal: 'center', vertical: 'middle' };
        wsMonth.getRow(1).height = 36;

        // Subtitle
        wsMonth.mergeCells('A2:H2');
        const subM = wsMonth.getCell('A2');
        subM.value = `ยอดการผลิตประจำเดือน: ${(mData.production || 0).toLocaleString('th-TH')} ตัว`;
        subM.font = { name: 'Cordia New', size: 13, bold: true, color: { argb: 'FF475569' } };
        subM.alignment = { horizontal: 'center', vertical: 'middle' };
        wsMonth.getRow(2).height = 22;

        wsMonth.getRow(3).height = 10;

        // Table Header
        const mHeaders = ['ลำดับที่', 'ชื่อพลังงานที่ใช้', 'ปริมาณการใช้', 'หน่วยการใช้', 'จำนวนเงิน (บาท)', 'ยอดการผลิต ต่อเดือน (ตัว)', 'ปริมาณการใช้/ยอดผลิต', 'ค่าใช้จ่าย/ยอดผลิต (บาท/ตัว)'];
        const mHRow = wsMonth.getRow(4);
        mHRow.values = mHeaders;
        mHRow.height = 30;
        mHRow.eachCell((cell) => {
            cell.font = { name: 'Cordia New', size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F766E' } }; // Dark Teal
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
            cell.border = {
                top: { style: 'thin', color: { argb: 'FF0F766E' } },
                left: { style: 'thin', color: { argb: 'FF14B8A6' } },
                bottom: { style: 'medium', color: { argb: 'FF0F172A' } },
                right: { style: 'thin', color: { argb: 'FF14B8A6' } }
            };
        });

        let totUsage = 0, totCost = 0;
        const items = mData.items || [];
        items.forEach((it, idx) => {
            const rIdx = 5 + idx;
            const row = wsMonth.getRow(rIdx);
            const u = parseFloat(it.usage) || 0;
            const c = parseFloat(it.cost) || 0;
            totUsage += u;
            totCost += c;

            const uR = mData.production > 0 ? (u / mData.production) : 0;
            const cR = mData.production > 0 ? (c / mData.production) : 0;

            row.values = [it.id || (idx + 1), it.name, u, it.unit, c, mData.production || 0, uR, cR];
            row.height = 24;
            const bg = (idx % 2 === 0) ? 'FFFFFFFF' : 'FFF8FAFC';

            row.eachCell((cell, col) => {
                cell.font = { name: 'Cordia New', size: 13.5, color: { argb: 'FF0F172A' } };
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
                cell.border = {
                    top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
                    left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
                    bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
                    right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
                };

                if (col === 1 || col === 4) {
                    cell.alignment = { horizontal: 'center', vertical: 'middle' };
                } else if (col === 2) {
                    cell.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
                } else if (col === 6) {
                    cell.alignment = { horizontal: 'right', vertical: 'middle' };
                    cell.numFmt = '#,##0';
                } else {
                    cell.alignment = { horizontal: 'right', vertical: 'middle' };
                    cell.numFmt = '#,##0.00';
                }
            });
        });

        // Monthly Total Row
        const totRIdx = 5 + items.length;
        const mTotRow = wsMonth.getRow(totRIdx);
        const totUR = mData.production > 0 ? (totUsage / mData.production) : 0;
        const totCR = mData.production > 0 ? (totCost / mData.production) : 0;

        wsMonth.mergeCells(`A${totRIdx}:B${totRIdx}`);
        mTotRow.getCell(1).value = 'รวมค่าใช้จ่ายทั้งสิ้น';
        mTotRow.getCell(3).value = totUsage;
        mTotRow.getCell(4).value = '-';
        mTotRow.getCell(5).value = totCost;
        mTotRow.getCell(6).value = mData.production || 0;
        mTotRow.getCell(7).value = totUR;
        mTotRow.getCell(8).value = totCR;
        mTotRow.height = 28;

        for (let col = 1; col <= 8; col++) {
            const cell = mTotRow.getCell(col);
            cell.font = { name: 'Cordia New', size: 14, bold: true, color: { argb: 'FF1E3A8A' } };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } }; // Soft Gold
            cell.border = {
                top: { style: 'thin', color: { argb: 'FF94A3B8' } },
                left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
                bottom: { style: 'double', color: { argb: 'FF0F172A' } },
                right: { style: 'thin', color: { argb: 'FFCBD5E1' } }
            };

            if (col === 1 || col === 2) {
                cell.alignment = { horizontal: 'center', vertical: 'middle' };
            } else if (col === 4) {
                cell.alignment = { horizontal: 'center', vertical: 'middle' };
            } else if (col === 6) {
                cell.alignment = { horizontal: 'right', vertical: 'middle' };
                cell.numFmt = '#,##0';
            } else {
                cell.alignment = { horizontal: 'right', vertical: 'middle' };
                cell.numFmt = '#,##0.00';
            }
        }

        // Remarks if note is present
        if (mData.note) {
            const noteRIdx = totRIdx + 2;
            wsMonth.mergeCells(`A${noteRIdx}:H${noteRIdx}`);
            const noteCell = wsMonth.getCell(`A${noteRIdx}`);
            noteCell.value = `หมายเหตุ: ${mData.note}`;
            noteCell.font = { name: 'Cordia New', size: 12, italic: true, color: { argb: 'FF64748B' } };
            noteCell.alignment = { horizontal: 'left', vertical: 'middle' };
            wsMonth.getRow(noteRIdx).height = 22;
        }
    });

    // -----------------------------------------------------------
    // 3. GENERATE & TRIGGER BROWSER DOWNLOAD
    // -----------------------------------------------------------
    try {
        const buffer = await wb.xlsx.writeBuffer();
        const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `สรุปค่าใช้จ่ายด้านพลังงาน_${selectedYear}_Exported.xlsx`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        a.remove();
        showToast(`ส่งออกไฟล์ Excel ปี ${selectedYear} สวยงามเรียบร้อยแล้ว`);
    } catch (err) {
        console.error("Export error:", err);
        alert("เกิดข้อผิดพลาดในการส่งออกไฟล์ Excel: " + err.message);
    }
}

function printReport() {
    window.print();
}

function showToast(message) {
    const container = document.getElementById("toast-container");
    if (!container) return;
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.innerHTML = `<i class="fa-solid fa-circle-check" style="color:#059669;"></i> <span>${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => {
        toast.remove();
    }, 3000);
}

function toggleReportMonthSelect() {
    const isMonthly = document.querySelector('input[name="report_type"]:checked').value === 'monthly';
    document.getElementById('report-month-group').style.display = isMonthly ? 'block' : 'none';
    renderReportPreview();
}

function initReportView() {
    const years = Object.keys(appState.multiYearData).map(y => parseInt(y)).sort((a,b) => a - b);
    const yrSel = document.getElementById("report-year-select");
    const moSel = document.getElementById("report-month-select");
    
    if (yrSel) {
        yrSel.innerHTML = years.map(y => `<option value="${y}" ${y === appState.selectedYear ? 'selected':''}>ปี พ.ศ. ${y}</option>`).join("");
        yrSel.onchange = renderReportPreview;
    }
    
    if (moSel) {
        const allowedMonths = appState.selectedYear === CURRENT_REAL_YEAR 
            ? ALL_MONTHS.slice(0, CURRENT_REAL_MONTH_IDX + 1)
            : ALL_MONTHS;
        moSel.innerHTML = allowedMonths.map(m => `<option value="${m}">${m}</option>`).join("");
        moSel.value = appState.selectedMonth;
        moSel.onchange = renderReportPreview;
    }
    
    renderReportPreview();
}

function renderReportPreview() {
    const previewArea = document.getElementById("report-preview-area");
    if (!previewArea) return;
    
    const year = parseInt(document.getElementById("report-year-select")?.value || appState.selectedYear);
    const type = document.querySelector('input[name="report_type"]:checked')?.value || 'annual';
    const month = document.getElementById("report-month-select")?.value || appState.selectedMonth;
    
    const yearData = appState.multiYearData[year] || {};
    
    if (type === 'annual') {
        let html = `<table class="custom-table" style="width:100%; border:1px solid #cbd5e1;">
            <thead><tr style="background:#e2e8f0;"><th>เดือน</th><th style="text-align:right;">ยอดผลิต(ตัว)</th><th style="text-align:right;">ค่าน้ำ</th><th style="text-align:right;">ค่าไฟฟ้า</th><th style="text-align:right;">น้ำมัน</th><th style="text-align:right;">แก๊ส</th><th style="text-align:right;">รวม(บาท)</th><th style="text-align:right;">บาท/ตัว</th></tr></thead>
            <tbody>`;
        let sumP=0, sumW=0, sumE=0, sumF=0, sumG=0, sumT=0;
        ALL_MONTHS.forEach(m => {
            const d = yearData[m];
            if (d) {
                let w=0, e=0, f=0, g=0, t=0;
                d.items.forEach(it => {
                    const c = parseFloat(it.cost)||0; t+=c;
                    if (it.name.includes("น้ำ") && !it.name.includes("น้ำมัน")) w+=c;
                    else if (it.name.includes("ไฟฟ้า")) e+=c;
                    else if (it.name.includes("น้ำมัน")) f+=c;
                    else if (it.name.includes("แก๊ส") || it.name.includes("LPG")) g+=c;
                });
                const cp = d.production > 0 ? t/d.production : 0;
                html += `<tr><td>${m}</td><td style="text-align:right;">${d.production.toLocaleString()}</td><td style="text-align:right;">${w.toLocaleString()}</td><td style="text-align:right;">${e.toLocaleString()}</td><td style="text-align:right;">${f.toLocaleString()}</td><td style="text-align:right;">${g.toLocaleString()}</td><td style="text-align:right;">${t.toLocaleString()}</td><td style="text-align:right;">${cp.toFixed(2)}</td></tr>`;
                sumP+=d.production; sumW+=w; sumE+=e; sumF+=f; sumG+=g; sumT+=t;
            }
        });
        const avg = sumP > 0 ? sumT/sumP : 0;
        html += `<tr style="font-weight:bold; background:#f1f5f9;"><td>รวม</td><td style="text-align:right;">${sumP.toLocaleString()}</td><td style="text-align:right;">${sumW.toLocaleString()}</td><td style="text-align:right;">${sumE.toLocaleString()}</td><td style="text-align:right;">${sumF.toLocaleString()}</td><td style="text-align:right;">${sumG.toLocaleString()}</td><td style="text-align:right;">${sumT.toLocaleString()}</td><td style="text-align:right;">${avg.toFixed(2)}</td></tr>`;
        html += `</tbody></table>`;
        previewArea.innerHTML = html;
    } else {
        const d = yearData[month];
        if (!d) {
            previewArea.innerHTML = `<div style="text-align:center; padding:20px; color:#64748b;">ไม่มีข้อมูลของเดือน ${month} ${year}</div>`;
            return;
        }
        let html = `<table class="custom-table" style="width:100%; border:1px solid #cbd5e1;">
            <thead><tr style="background:#e2e8f0;"><th style="text-align:center;">ลำดับ</th><th>รายการ</th><th style="text-align:right;">ปริมาณ</th><th style="text-align:center;">หน่วย</th><th style="text-align:right;">จำนวนเงิน(บาท)</th></tr></thead>
            <tbody>`;
        d.items.forEach(it => {
            html += `<tr><td style="text-align:center;">${it.id}</td><td>${it.name}</td><td style="text-align:right;">${it.usage.toLocaleString()}</td><td style="text-align:center;">${it.unit}</td><td style="text-align:right;">${parseFloat(it.cost).toLocaleString()}</td></tr>`;
        });
        html += `<tr style="font-weight:bold; background:#f1f5f9;"><td colspan="4" style="text-align:right;">รวมค่าใช้จ่าย</td><td style="text-align:right;">${d.totalCost.toLocaleString()}</td></tr>`;
        html += `</tbody></table>`;
        previewArea.innerHTML = html;
    }
}


// ─────────────────────────────────────────────
//  generateChartsReport(mode)
//  mode: 'usage' | 'cost'
//  Creates a multi-page A4 popup with Chart.js
// ─────────────────────────────────────────────
function generateChartsReport(mode) {
    const yrEl = document.getElementById('report-year-select');
    if (!yrEl) { alert('โปรดเลือกปีก่อน'); return; }
    const year = parseInt(yrEl.value);
    const yearData = appState.multiYearData[year] || {};
    const isUsage = mode !== 'cost';
    const modeLabel = isUsage ? 'ปริมาณการใช้งาน' : 'จำนวนเงิน';
    const modeUnit  = isUsage ? '' : 'บาท';

    // ── Gather data by month ──────────────────
    const months = ALL_MONTHS;
    const data = { water:[], elec:[], oil:[], gas:[], prod:[], perUnit:[], total:[] };

    months.forEach(function(m) {
        const d = yearData[m] || {};
        const items = d.items || [];
        let w=0,e=0,f=0,g=0,t=0;
        items.forEach(function(it){
            const val = isUsage ? (parseFloat(it.usage)||0) : (parseFloat(it.cost)||0);
            t += isUsage ? 0 : val;
            if(it.name.includes('น้ำ') && !it.name.includes('น้ำมัน')) w += val;
            else if(it.name.includes('ไฟฟ้า')) e += val;
            else if(it.name.includes('น้ำมัน')) f += val;
            else if(it.name.includes('แก๊ส')||it.name.includes('LPG')) g += val;
        });
        // Fix: always use sum of category costs (w+e+f+g) as total
        // d.totalCost is sometimes stale/0 if save wasn't called after last edit
        t = w + e + f + g;
        // Fallback: if sum is 0 but d.totalCost exists and is non-zero, use it
        if (t === 0 && !isUsage) {
            const stored = parseFloat(d.totalCost) || 0;
            if (stored > 0) t = stored;
        }
        const prod = parseFloat(d.production)||0;
        const ratio = prod > 0 ? t/prod : 0;
        data.water.push(w);
        data.elec.push(e);
        data.oil.push(f);
        data.gas.push(g);
        data.prod.push(prod);
        data.total.push(t);
        data.perUnit.push(isUsage ? (prod>0?t/prod:0) : ratio);
    });

    // ── Helper: format number ─────────────────
    function fmt(v, dec) { return v.toLocaleString('th-TH', {minimumFractionDigits:dec||0,maximumFractionDigits:dec||0}); }

    // ── Build summary table HTML ──────────────
    function buildSummaryTable() {
        const rows = [
            { label:'น้ำ '+(isUsage?'(ลบ.ม.)':'(บาท)'), key:'water', textColor:'#0277bd', bg:'#e1f5fe' },
            { label:'ไฟฟ้า '+(isUsage?'(kWh)':'(บาท)'), key:'elec',  textColor:'#c62828', bg:'#fce4ec' },
            { label:'น้ำมัน '+(isUsage?'(ลิตร)':'(บาท)'), key:'oil', textColor:'#6a1b9a', bg:'#f3e5f5' },
            { label:'แก๊ส '+(isUsage?'(Kg)':'(บาท)'), key:'gas',    textColor:'#2e7d32', bg:'#e8f5e9' },
        ];

        // Abbreviated month names
        const mAbbr = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
        let thRow = '<tr style="background:#1e3a5f;color:#fff;font-weight:700;"><th style="padding:6px 8px;text-align:left;">ชื่อพลังงาน</th>';
        mAbbr.forEach(function(m){ thRow += '<th style="padding:6px 4px;text-align:right;font-size:11px;">'+m+'</th>'; });
        thRow += '<th style="background:#ffd600;color:#000;padding:6px 8px;text-align:right;">Total</th></tr>';

        let tbody = '';
        rows.forEach(function(r) {
            const vals = data[r.key];
            const total = vals.reduce(function(a,b){return a+b;},0);
            tbody += '<tr style="background:'+r.bg+';">';
            tbody += '<td style="padding:5px 8px;font-weight:700;color:'+r.textColor+';">'+r.label+'</td>';
            vals.forEach(function(v){ tbody += '<td style="padding:5px 4px;text-align:right;font-size:11px;">'+(v>0?fmt(v,0):'-')+'</td>'; });
            tbody += '<td style="background:#ffd600;color:#000;font-weight:700;padding:5px 8px;text-align:right;">'+fmt(total,0)+'</td>';
            tbody += '</tr>';
        });

        // Total row
        const totals = months.map(function(_,i){ return data.total[i]; });
        const grandTotal = totals.reduce(function(a,b){return a+b;},0);
        tbody += '<tr style="background:#fff176;font-weight:700;">';
        tbody += '<td style="padding:5px 8px;">Total</td>';
        totals.forEach(function(v){ tbody += '<td style="padding:5px 4px;text-align:right;font-size:11px;">'+fmt(v,isUsage?0:2)+'</td>'; });
        tbody += '<td style="background:#ffd600;color:#000;padding:5px 8px;text-align:right;">'+fmt(grandTotal,isUsage?0:2)+'</td></tr>';

        // Production row
        const totalProd = data.prod.reduce(function(a,b){return a+b;},0);
        tbody += '<tr style="background:#e8f5e9;"><td colspan="14" style="padding:4px 8px;"></td></tr>';
        tbody += '<tr style="background:#e8f5e9;font-weight:600;">';
        tbody += '<td style="padding:5px 8px;">ยอดการผลิต (ตัว)</td>';
        data.prod.forEach(function(v){ tbody += '<td style="padding:5px 4px;text-align:right;font-size:11px;">'+fmt(v,0)+'</td>'; });
        tbody += '<td style="background:#ffd600;color:#000;font-weight:700;padding:5px 8px;text-align:right;">'+fmt(totalProd,0)+'</td></tr>';

        // Per unit row
        const perUnits = months.map(function(_,i){ return data.prod[i]>0 ? data.total[i]/data.prod[i] : 0; });
        tbody += '<tr style="background:#fff9c4;">';
        tbody += '<td style="padding:5px 8px;font-size:11px;">'+(isUsage?'ปริมาณรวม/ยอดผลิต':'ค่าใช้จ่าย/ยอดผลิต (บาท/ตัว)')+'</td>';
        perUnits.forEach(function(v){ tbody += '<td style="padding:5px 4px;text-align:right;font-size:11px;">'+fmt(v,2)+'</td>'; });
        const avgPU = totalProd>0 ? grandTotal/totalProd : 0;
        tbody += '<td style="background:#ffd600;color:#000;font-weight:700;padding:5px 8px;text-align:right;">'+fmt(avgPU,2)+'</td></tr>';

        return '<table style="width:100%;border-collapse:collapse;font-size:12px;border:1px solid #bbb;">'
            + '<thead>' + thRow + '</thead><tbody>' + tbody + '</tbody></table>';
    }

    // ── Build a chart page (canvas) ───────────
    function chartPage(title, chartId, bgColor, chartType, datasets, yLabel, extraFooter) {
        const footer = extraFooter || '';
        return '<div class="a4-page">'
            + '<div class="page-header"><h2>'+title+'</h2>'+(yLabel?'<p class="subtitle">หน่วย: '+yLabel+'</p>':'')+'</div>'
            + '<div class="chart-container"><canvas id="'+chartId+'" width="900" height="430"></canvas></div>'
            + footer
            + '<script>'
            + '(function(){'
            + ' var ctx=document.getElementById("'+chartId+'").getContext("2d");'
            + ' var labels=' + JSON.stringify(months) + ';'
            + ' new Chart(ctx,{'
            + '  type:"bar",'
            + '  data:{labels:labels,datasets:' + JSON.stringify(datasets) + '},'
            + '  options:{'
            + '   responsive:false,'
            + '   animation:{duration:0},'
            + '   plugins:{'
            + '    legend:{display:'+(datasets.length>1?'true':'false')+',position:"bottom",labels:{font:{size:11}}},'
            + '    datalabels:{display:false}'
            + '   },'
            + '   scales:{'
            + '    x:{ticks:{font:{size:10}},grid:{display:false}},'
            + '    y:{ticks:{font:{size:10},callback:function(v){return v.toLocaleString("th-TH");}},beginAtZero:true}'
            + '   }'
            + '  }'
            + ' });'
            + '})();'
            + '<\/script>'
            + '</div>';
    }

    // ── Colours ───────────────────────────────
    var mAbbr = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];

    // Summary table page
    var page0 = '<div class="a4-page">'
        + '<div class="page-header"><h2>การอนุรักษ์พลังงานและทรัพยากร ปี '+year+'</h2>'
        + '<p class="subtitle">'+modeLabel+'</p></div>'
        + '<div style="overflow-x:auto;">'+buildSummaryTable()+'</div>'
        + '</div>';

    // Individual charts
    var charts = [];

    // Water
    charts.push(chartPage(
        'ปริมาณการใช้น้ำ ปี '+year,
        'ch_water', '#e1f5fe', 'bar',
        [{ label:'น้ำ '+(isUsage?'(ลบ.ม.)':'(บาท)'), data: data.water,
           backgroundColor:'#4fc3f7', borderColor:'#0288d1', borderWidth:1,
           datalabels:{display:true} }],
        isUsage?'ลบ.ม.':'บาท'
    ));
    // Electricity
    charts.push(chartPage(
        'ปริมาณการใช้ไฟฟ้า ปี '+year,
        'ch_elec', '#fce4ec', 'bar',
        [{ label:'ไฟฟ้า '+(isUsage?'(kWh)':'(บาท)'), data: data.elec,
           backgroundColor:'#f48fb1', borderColor:'#c62828', borderWidth:1 }],
        isUsage?'kWh':'บาท'
    ));
    // Oil
    charts.push(chartPage(
        'ปริมาณการใช้น้ำมัน ปี '+year,
        'ch_oil', '#f3e5f5', 'bar',
        [{ label:'น้ำมัน '+(isUsage?'(ลิตร)':'(บาท)'), data: data.oil,
           backgroundColor:'#ce93d8', borderColor:'#7b1fa2', borderWidth:1 }],
        isUsage?'ลิตร':'บาท'
    ));
    // Gas
    charts.push(chartPage(
        'ปริมาณการใช้แก๊ส ปี '+year,
        'ch_gas', '#e8f5e9', 'bar',
        [{ label:'แก๊ส '+(isUsage?'(Kg)':'(บาท)'), data: data.gas,
           backgroundColor:'#81c784', borderColor:'#388e3c', borderWidth:1 }],
        isUsage?'Kg':'บาท'
    ));
    // Combined
    charts.push(chartPage(
        'เทียบ'+modeLabel+'การใช้พลังงาน ปี '+year,
        'ch_all', '#fff', 'bar',
        [
            { label:'น้ำ '+(isUsage?'(ลบ.ม.)':'(บาท)'), data:data.water, backgroundColor:'#4fc3f7', borderColor:'#0288d1', borderWidth:1 },
            { label:'ไฟฟ้า '+(isUsage?'(kWh)':'(บาท)'), data:data.elec, backgroundColor:'#f48fb1', borderColor:'#c62828', borderWidth:1 },
            { label:'น้ำมัน '+(isUsage?'(ลิตร)':'(บาท)'), data:data.oil, backgroundColor:'#ce93d8', borderColor:'#7b1fa2', borderWidth:1 },
            { label:'แก๊ส '+(isUsage?'(Kg)':'(บาท)'), data:data.gas, backgroundColor:'#81c784', borderColor:'#388e3c', borderWidth:1 }
        ],
        isUsage?'หน่วยต่างๆ':'บาท'
    ));
    // Production
    charts.push(chartPage(
        'ยอดการผลิตหมู แต่ละเดือนในปี '+year+' (ตัว)',
        'ch_prod', '#fffde7', 'bar',
        [{ label:'ยอดผลิต (ตัว)', data:data.prod,
           backgroundColor:'#fff176', borderColor:'#f9a825', borderWidth:1 }],
        'ตัว'
    ));
    // Per unit
    charts.push(chartPage(
        (isUsage?'ปริมาณรวม':'ค่าใช้จ่าย')+' / ยอดการผลิตหมู(ตัว) ในแต่ละเดือน ปี '+year,
        'ch_perunit', '#e8f5e9', 'bar',
        [{ label:(isUsage?'ปริมาณ/ตัว':'บาท/ตัว'), data:data.perUnit,
           backgroundColor:'#66bb6a', borderColor:'#1b5e20', borderWidth:1 }],
        isUsage?'หน่วย/ตัว':'บาท/ตัว'
    ));

    // ── Build HTML ────────────────────────────
    var css = [
        '@import url("https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700&display=swap");',
        '* { box-sizing:border-box; margin:0; padding:0; }',
        'body { font-family:"Sarabun","TH Sarabun New",sans-serif; background:#e5e7eb; }',
        '.a4-page {',
        '  width:277mm; min-height:190mm; max-height:190mm;',
        '  background:#fff; margin:8mm auto; padding:10mm 12mm 8mm;',
        '  page-break-after:always; overflow:hidden;',
        '  display:flex; flex-direction:column;',
        '}',
        '.page-header { text-align:center; margin-bottom:6mm; border-bottom:2px solid #1e3a5f; padding-bottom:3mm; }',
        '.page-header h2 { font-size:15pt; font-weight:700; color:#1e3a5f; }',
        '.page-header .subtitle { font-size:9pt; color:#64748b; margin-top:2px; }',
        '.chart-container { flex:1; display:flex; align-items:center; justify-content:center; }',
        'canvas { max-width:100%; max-height:148mm; }',
        'table { font-size:11px; }',
        /* Loading overlay — hides pages on screen until print dialog opens */
        '#overlay {',
        '  position:fixed; inset:0; background:#1e3a5f;',
        '  display:flex; flex-direction:column; align-items:center; justify-content:center;',
        '  z-index:9999; color:#fff; font-family:"Sarabun",sans-serif;',
        '}',
        '#overlay h3 { font-size:20px; margin-bottom:12px; }',
        '#overlay p  { font-size:13px; color:#94a3b8; }',
        '.spinner { width:48px; height:48px; border:5px solid #334155; border-top-color:#38bdf8; border-radius:50%; animation:spin 0.8s linear infinite; margin-bottom:20px; }',
        '@keyframes spin { to { transform:rotate(360deg); } }',
        /* Force ALL backgrounds + colors to print */
        '* { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; color-adjust: exact !important; }',
        '@media print {',
        '  body { background:#fff; }',
        '  #overlay { display:none !important; }',
        '  .a4-page { margin:0; width:100%; min-height:0; page-break-after:always; padding:8mm 10mm; }',
        '  @page { size:A4 landscape; margin:0.5cm; }',
        '  .no-print { display:none; }',
        '}'
    ].join(' ');

    var html = '<!DOCTYPE html><html lang="th"><head>'
        + '<meta charset="UTF-8"><title>รายงานกราฟ '+modeLabel+' ปี '+year+'</title>'
        + '<style>'+css+'</style>'
        + '<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"><\/script>'
        + '</head><body>'
        /* Overlay: covers pages while charts render */
        + '<div id="overlay">'
        + '  <div class="spinner"></div>'
        + '  <h3>📊 กำลังเตรียมรายงานกราฟ...</h3>'
        + '  <p>โปรดรอสักครู่ หน้าต่างพิมพ์จะเปิดอัตโนมัติ...</p>'
        + '</div>'
        + page0
        + charts.join('')
        + '<script>'
        + 'window.addEventListener("load", function() {'
        + '  setTimeout(function(){'
        + '    window.print();'
        + '  }, 2500);'
        + '  window.addEventListener("afterprint", function(){ window.close(); });'
        + '});'
        + '<\/script>'
        + '</body></html>';


    var w = window.open('', '_blank');
    if (!w) { alert('โปรดอนุญาต Popup สำหรับหน้าเว็บนี้ก่อนแล้วลองใหม่'); return; }
    w.document.write(html);
    w.document.close();
}


function generateAndPrintReport() {

    const yrEl = document.getElementById('report-year-select');
    const moEl = document.getElementById('report-month-select');
    const typeEl = document.querySelector('input[name="report_type"]:checked');
    if (!yrEl || !typeEl) { alert('โปรดเลือกปีและประเภทรายงานก่อน'); return; }

    const year = parseInt(yrEl.value);
    const type = typeEl.value;
    const month = moEl ? moEl.value : appState.selectedMonth;
    const yearData = appState.multiYearData[year] || {};

    const title = type === 'annual'
        ? 'รายงานสรุปค่าใช้จ่ายด้านพลังงาน ประจำปี ' + year
        : 'รายงานสรุปค่าใช้จ่ายด้านพลังงาน ประจำเดือน ' + month + ' ' + year;

    // Build table HTML using string concat (safe — no nested template literal issues)
    let tableHtml = '';

    if (type === 'annual') {
        tableHtml += '<table class="print-table"><thead><tr>';
        tableHtml += '<th>เดือน</th><th>ยอดผลิต(ตัว)</th><th>ค่าน้ำ</th><th>ค่าไฟฟ้า</th><th>น้ำมัน</th><th>แก๊ส</th><th>รวม(บาท)</th><th>บาท/ตัว</th>';
        tableHtml += '</tr></thead><tbody>';

        let sumP = 0, sumW = 0, sumE = 0, sumF = 0, sumG = 0, sumT = 0;
        ALL_MONTHS.forEach(function(m) {
            const d = yearData[m];
            if (!d) return;
            let w = 0, e = 0, f = 0, g = 0, t = 0;
            (d.items || []).forEach(function(it) {
                const c = parseFloat(it.cost) || 0; t += c;
                if (it.name.includes('น้ำ') && !it.name.includes('น้ำมัน')) w += c;
                else if (it.name.includes('ไฟฟ้า')) e += c;
                else if (it.name.includes('น้ำมัน')) f += c;
                else if (it.name.includes('แก๊ส') || it.name.includes('LPG')) g += c;
            });
            const cp = d.production > 0 ? t / d.production : 0;
            tableHtml += '<tr>'
                + '<td>' + m + '</td>'
                + '<td style="text-align:right">' + (d.production || 0).toLocaleString('th-TH') + '</td>'
                + '<td style="text-align:right">' + w.toLocaleString('th-TH', {minimumFractionDigits:2}) + '</td>'
                + '<td style="text-align:right">' + e.toLocaleString('th-TH', {minimumFractionDigits:2}) + '</td>'
                + '<td style="text-align:right">' + f.toLocaleString('th-TH', {minimumFractionDigits:2}) + '</td>'
                + '<td style="text-align:right">' + g.toLocaleString('th-TH', {minimumFractionDigits:2}) + '</td>'
                + '<td style="text-align:right">' + t.toLocaleString('th-TH', {minimumFractionDigits:2}) + '</td>'
                + '<td style="text-align:right">' + cp.toFixed(2) + '</td>'
                + '</tr>';
            sumP += (d.production || 0); sumW += w; sumE += e; sumF += f; sumG += g; sumT += t;
        });

        const avg = sumP > 0 ? sumT / sumP : 0;
        tableHtml += '<tr class="summary">'
            + '<td>รวมทั้งปี</td>'
            + '<td style="text-align:right">' + sumP.toLocaleString('th-TH') + '</td>'
            + '<td style="text-align:right">' + sumW.toLocaleString('th-TH', {minimumFractionDigits:2}) + '</td>'
            + '<td style="text-align:right">' + sumE.toLocaleString('th-TH', {minimumFractionDigits:2}) + '</td>'
            + '<td style="text-align:right">' + sumF.toLocaleString('th-TH', {minimumFractionDigits:2}) + '</td>'
            + '<td style="text-align:right">' + sumG.toLocaleString('th-TH', {minimumFractionDigits:2}) + '</td>'
            + '<td style="text-align:right">' + sumT.toLocaleString('th-TH', {minimumFractionDigits:2}) + '</td>'
            + '<td style="text-align:right">' + avg.toFixed(2) + '</td>'
            + '</tr>';
        tableHtml += '</tbody></table>';

    } else {
        // Monthly report
        const d = yearData[month];
        tableHtml += '<table class="print-table"><thead><tr>';
        tableHtml += '<th style="text-align:center">ลำดับ</th><th>รายการพลังงาน</th><th style="text-align:right">ปริมาณ</th><th style="text-align:center">หน่วย</th><th style="text-align:right">จำนวนเงิน (บาท)</th><th style="text-align:right">บาท/ตัว</th>';
        tableHtml += '</tr></thead><tbody>';

        if (d && d.items) {
            const prod = d.production || 0;
            let grandTotal = 0;
            d.items.forEach(function(it) {
                const cost = parseFloat(it.cost) || 0;
                grandTotal += cost;
                const cpp = prod > 0 ? cost / prod : 0;
                tableHtml += '<tr>'
                    + '<td style="text-align:center">' + it.id + '</td>'
                    + '<td>' + it.name + '</td>'
                    + '<td style="text-align:right">' + (it.usage || 0).toLocaleString('th-TH') + '</td>'
                    + '<td style="text-align:center">' + it.unit + '</td>'
                    + '<td style="text-align:right">' + cost.toLocaleString('th-TH', {minimumFractionDigits:2}) + '</td>'
                    + '<td style="text-align:right">' + cpp.toFixed(2) + '</td>'
                    + '</tr>';
            });
            const totalCpp = prod > 0 ? grandTotal / prod : 0;
            tableHtml += '<tr class="summary">'
                + '<td colspan="4" style="text-align:right">รวมค่าใช้จ่ายทั้งหมด</td>'
                + '<td style="text-align:right">' + grandTotal.toLocaleString('th-TH', {minimumFractionDigits:2}) + '</td>'
                + '<td style="text-align:right">' + totalCpp.toFixed(2) + '</td>'
                + '</tr>';
            tableHtml += '<tr><td colspan="6" style="font-size:0.85em; color:#64748b; padding:6px 10px;">📦 ยอดการผลิตเดือนนี้: ' + prod.toLocaleString('th-TH') + ' ตัว</td></tr>';
        } else {
            tableHtml += '<tr><td colspan="6" style="text-align:center; padding:20px; color:#888;">ไม่มีข้อมูลของเดือน ' + month + ' ' + year + '</td></tr>';
        }
        tableHtml += '</tbody></table>';

        // Sub-meter details
        const mKey = year + '_' + month;
        const waterList = appState.waterMeters[mKey];
        if (waterList && waterList.length > 0) {
            tableHtml += '<h4 class="section-title water">💧 รายละเอียดมิเตอร์น้ำ (Sub-meters)</h4>';
            tableHtml += '<table class="print-table"><thead><tr><th>รหัสเครื่องวัด</th><th>บ้านเลขที่</th><th>สถานที่</th><th style="text-align:right">ปริมาณ (ลบ.ม.)</th><th style="text-align:right">จำนวนเงิน (บาท)</th></tr></thead><tbody>';
            waterList.forEach(function(meter) {
                if (!meter) return;
                tableHtml += '<tr><td>' + (meter.meterCode||'') + '</td><td>' + (meter.houseNo||'') + '</td><td>' + (meter.location||'') + '</td>'
                    + '<td style="text-align:right">' + (meter.usage||0).toLocaleString('th-TH') + '</td>'
                    + '<td style="text-align:right">' + (parseFloat(meter.cost)||0).toLocaleString('th-TH', {minimumFractionDigits:2}) + '</td></tr>';
            });
            tableHtml += '</tbody></table>';
        }

        const elecList = appState.elecMeters[mKey];
        if (elecList && elecList.length > 0) {
            tableHtml += '<h4 class="section-title elec">⚡ รายละเอียดมิเตอร์ไฟฟ้า (Sub-meters)</h4>';
            tableHtml += '<table class="print-table"><thead><tr><th>รหัสเครื่องวัด</th><th>บ้านเลขที่</th><th>สถานที่</th><th style="text-align:right">ปริมาณ (kWh)</th><th style="text-align:right">จำนวนเงิน (บาท)</th></tr></thead><tbody>';
            elecList.forEach(function(meter) {
                if (!meter) return;
                tableHtml += '<tr><td>' + (meter.meterCode||'') + '</td><td>' + (meter.houseNo||'') + '</td><td>' + (meter.location||'') + '</td>'
                    + '<td style="text-align:right">' + (meter.usage||0).toLocaleString('th-TH') + '</td>'
                    + '<td style="text-align:right">' + (parseFloat(meter.cost)||0).toLocaleString('th-TH', {minimumFractionDigits:2}) + '</td></tr>';
            });
            tableHtml += '</tbody></table>';
        }
    }

    // Signature rows
    const sigHtml = '<div class="signatures">'
        + '<div class="sig-box"><p class="sig-title">ผู้จัดทำ</p><p class="sig-role">(QA / ควบคุมคุณภาพ)</p><div class="sig-line"></div><p class="sig-name">(............................................)</p><p class="sig-date">วันที่ ............/............/............</p></div>'
        + '<div class="sig-box"><p class="sig-title">ผู้ตรวจสอบ</p><p class="sig-role">(EMR / ผู้จัดการพลังงาน)</p><div class="sig-line"></div><p class="sig-name">(............................................)</p><p class="sig-date">วันที่ ............/............/............</p></div>'
        + '</div>';

    const css = [
        '@import url("https://fonts.googleapis.com/css2?family=Sarabun:wght@300;400;600;700&display=swap");',
        '* { box-sizing: border-box; margin: 0; padding: 0; }',
        'body { font-family: "Sarabun", "TH Sarabun New", sans-serif; background: #f0f4f8; color: #1a202c; font-size: 13px; }',
        '.page-wrap { background: #fff; max-width: 1100px; margin: 20px auto; padding: 36px 40px 30px; border-radius: 10px; box-shadow: 0 4px 24px rgba(0,0,0,0.12); }',
        /* Header */
        '.report-header { text-align: center; margin-bottom: 28px; }',
        '.report-header .logo-bar { background: linear-gradient(135deg, #1e3a5f 0%, #2563eb 60%, #0ea5e9 100%); border-radius: 8px; padding: 18px 24px 14px; margin-bottom: 0; }',
        '.report-header .logo-bar h2 { color: #fff; font-size: 20px; font-weight: 700; letter-spacing: 0.5px; margin: 0; text-shadow: 0 1px 3px rgba(0,0,0,0.3); }',
        '.report-header .meta-bar { background: #e8f0fe; border: 1px solid #bfdbfe; border-top: none; border-radius: 0 0 8px 8px; padding: 7px 16px; display: flex; justify-content: space-between; font-size: 12px; color: #374151; }',
        /* Table */
        '.print-table { width: 100%; border-collapse: collapse; margin-bottom: 24px; font-size: 12.5px; }',
        '.print-table thead tr { background: linear-gradient(90deg, #1e3a5f, #2563eb); }',
        '.print-table th { color: #fff; font-weight: 700; padding: 9px 10px; text-align: center; border: 1px solid #1d4ed8; letter-spacing: 0.2px; }',
        '.print-table tbody tr:nth-child(even) { background-color: #f0f7ff; }',
        '.print-table tbody tr:nth-child(odd) { background-color: #ffffff; }',
        '.print-table tbody tr:hover { background-color: #dbeafe; }',
        '.print-table td { padding: 7px 10px; border: 1px solid #cbd5e1; color: #1e293b; }',
        '.print-table tfoot tr, .print-table tr.summary { background: linear-gradient(90deg, #1e3a5f 0%, #1e40af 100%); }',
        '.print-table tr.summary td { color: #fff; font-weight: 700; border-color: #1d4ed8; padding: 9px 10px; }',
        '.print-table tr.zero-row td { color: #94a3b8; font-style: italic; }',
        /* Section headings */
        'h4.section-title { margin: 20px 0 8px; padding: 6px 14px; border-left: 4px solid #2563eb; background: #eff6ff; color: #1e3a5f; font-size: 13px; border-radius: 0 6px 6px 0; }',
        'h4.section-title.water { border-left-color: #0ea5e9; background: #f0f9ff; color: #0369a1; }',
        'h4.section-title.elec { border-left-color: #f59e0b; background: #fffbeb; color: #92400e; }',
        /* Signatures */
        '.signatures { display: flex; justify-content: space-around; align-items: flex-start; margin-top: 48px; padding-top: 20px; border-top: 2px solid #e2e8f0; }',
        '.sig-box { text-align: center; width: 260px; }',
        '.sig-title { font-size: 15px; font-weight: 700; color: #1e3a5f; margin-bottom: 2px; }',
        '.sig-role { font-size: 11px; color: #64748b; margin-bottom: 0; }',
        '.sig-line { margin: 48px auto 8px; width: 80%; border-bottom: 2px solid #1e3a5f; }',
        '.sig-name { font-size: 12px; color: #374151; }',
        '.sig-date { font-size: 11px; color: #94a3b8; margin-top: 4px; }',
        /* Print overrides */
        '@media print {',
        '  @page { size: A4 landscape; margin: 0.8cm; }',
        '  body { background: #fff; font-size: 11px; }',
        '  .page-wrap { box-shadow: none; padding: 6mm 8mm; border-radius: 0; margin: 0; max-width: 100%; }',
        '  .print-table { font-size: 10px; }',
        '  .print-table th, .print-table td { padding: 4px 6px; }',
        '  .print-table thead tr { -webkit-print-color-adjust: exact; print-color-adjust: exact; }',
        '  .print-table tr.summary { -webkit-print-color-adjust: exact; print-color-adjust: exact; }',
        '  .report-header .logo-bar { -webkit-print-color-adjust: exact; print-color-adjust: exact; }',
        '  .report-header .logo-bar h2 { font-size: 14pt; }',
        '  .signatures { margin-top: 20px; padding-top: 12px; }',
        '}'
    ].join(' ');


    const printDate = new Date().toLocaleDateString('th-TH', {year:'numeric', month:'long', day:'numeric'});
    const docType = type === 'annual' ? 'รายงานประจำปี' : 'รายงานประจำเดือน';

    const htmlContent = '<!DOCTYPE html><html lang="th"><head>'
        + '<meta charset="UTF-8">'
        + '<title>' + title + '</title>'
        + '<style>' + css + '</style>'
        + '</head><body>'
        + '<div class="page-wrap">'
        + '<div class="report-header">'
        + '  <div class="logo-bar"><h2>📊 ' + title + '</h2></div>'
        + '  <div class="meta-bar"><span>ประเภท: ' + docType + '</span><span>วันที่พิมพ์: ' + printDate + '</span></div>'
        + '</div>'
        + tableHtml
        + sigHtml
        + '</div>'
        + '<script>window.onload = function() { window.print(); }<\/script>'
        + '</body></html>';

    const w = window.open('', '_blank');
    if (!w) { alert('โปรดอนุญาต Popup สำหรับหน้าเว็บนี้ก่อนแล้วลองใหม่'); return; }
    w.document.write(htmlContent);
    w.document.close();
}