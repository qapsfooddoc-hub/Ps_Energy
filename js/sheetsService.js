/**
 * ============================================================================
 * GOOGLE SHEETS SYNC SERVICE (บริการเชื่อมต่อฐานข้อมูล Google Sheets)
 * ============================================================================
 * รองรับการทำงานแบบ Stale-While-Revalidate (เปิดปุ๊บติดปั๊บ + ซิงค์เบื้องหลัง)
 * และส่งข้อมูลกลับไปยัง Google Sheets อัตโนมัติเมื่อมีการบันทึกข้อมูล
 */

const sheetsService = {
  STORAGE_KEY_URL: "PS_ENERGY_SHEETS_URL",
  STORAGE_KEY_LAST_SYNC: "PS_ENERGY_LAST_SYNC_TIME",
  isSyncing: false,

  getUrl() {
    return (localStorage.getItem(this.STORAGE_KEY_URL) || "").trim();
  },

  setUrl(url) {
    if (!url) {
      localStorage.removeItem(this.STORAGE_KEY_URL);
    } else {
      localStorage.setItem(this.STORAGE_KEY_URL, url.trim());
    }
    this.updateStatusBadge();
  },

  isConfigured() {
    const url = this.getUrl();
    return url.length > 20 && url.includes("script.google.com");
  },

  getLastSyncTime() {
    return localStorage.getItem(this.STORAGE_KEY_LAST_SYNC) || null;
  },

  setLastSyncTime() {
    const now = new Date().toLocaleString("th-TH", {
      dateStyle: "short",
      timeStyle: "short"
    });
    localStorage.setItem(this.STORAGE_KEY_LAST_SYNC, now);
    return now;
  },

  // --------------------------------------------------------------------------
  // TEST CONNECTION (PING)
  // --------------------------------------------------------------------------
  async testConnection(targetUrl) {
    const url = targetUrl || this.getUrl();
    if (!url) throw new Error("โปรดระบุ Google Apps Script Web App URL");

    const startTime = performance.now();
    const pingUrl = url + (url.includes("?") ? "&" : "?") + "action=ping&_t=" + Date.now();

    const response = await fetch(pingUrl, {
      method: "GET",
      mode: "cors"
    });

    if (!response.ok) {
      throw new Error(`เชื่อมต่อไม่สำเร็จ HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    const durationMs = Math.round(performance.now() - startTime);

    if (data.status !== "success") {
      throw new Error(data.message || "ตอบกลับด้วยสถานะไม่สำเร็จ");
    }

    return {
      success: true,
      durationMs: durationMs,
      message: data.message
    };
  },

  // --------------------------------------------------------------------------
  // FETCH ALL DATA (PULL FROM SHEETS)
  // --------------------------------------------------------------------------
  async syncFromSheets(showToastMessage = false) {
    if (!this.isConfigured()) return false;
    if (this.isSyncing) return false;

    this.isSyncing = true;
    this.updateStatusBadge("syncing");

    const url = this.getUrl();
    const fetchUrl = url + (url.includes("?") ? "&" : "?") + "action=getData&_t=" + Date.now();
    const startTime = performance.now();

    try {
      const response = await fetch(fetchUrl, {
        method: "GET",
        mode: "cors"
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const res = await response.json();

      if (res.status === "success" && res.data) {
        const { multiYearData, waterMeters, elecMeters, auditLogs } = res.data;
        const durationMs = Math.round(performance.now() - startTime);

        // Merge or replace if data exists
        let hasChanges = false;
        if (multiYearData && Object.keys(multiYearData).length > 0) {
          appState.multiYearData = multiYearData;
          hasChanges = true;
        }
        if (waterMeters && Object.keys(waterMeters).length > 0) {
          appState.waterMeters = waterMeters;
          hasChanges = true;
        }
        if (elecMeters && Object.keys(elecMeters).length > 0) {
          appState.elecMeters = elecMeters;
          hasChanges = true;
        }
        if (auditLogs && Array.isArray(auditLogs) && auditLogs.length > 0) {
          appState.auditLogs = auditLogs;
          hasChanges = true;
        }

        if (hasChanges) {
          saveStateToStorage();
          if (typeof refreshAllViews === "function") refreshAllViews();
        }

        const syncTime = this.setLastSyncTime();
        this.updateStatusBadge("connected", syncTime);

        if (showToastMessage && typeof showToast === "function") {
          showToast(`☁️ ซิงค์ข้อมูลล่าสุดจาก Google Sheets เรียบร้อย (${durationMs}ms)`);
        }
        return true;
      } else {
        throw new Error(res.message || "รูปแบบข้อมูลจาก Sheets ไม่ถูกต้อง");
      }
    } catch (err) {
      console.warn("[Google Sheets Sync] Sync error:", err);
      this.updateStatusBadge("error", err.message);
      if (showToastMessage && typeof showToast === "function") {
        showToast(`⚠️ ซิงค์ Google Sheets ไม่สำเร็จ: ${err.message}`, "warning");
      }
      return false;
    } finally {
      this.isSyncing = false;
    }
  },

  // --------------------------------------------------------------------------
  // SAVE SINGLE MONTH TO SHEETS (PUSH TO SHEETS)
  // --------------------------------------------------------------------------
  async saveMonthToSheets(year, month) {
    if (!this.isConfigured()) return false;

    const monthData = appState.multiYearData[year] && appState.multiYearData[year][month];
    if (!monthData) return false;

    const waterKey = `${year}_${month}`;
    const elecKey = `${year}_${month}`;
    const waterM = appState.waterMeters[waterKey] || [];
    const elecM = appState.elecMeters[elecKey] || [];
    const latestAudit = appState.auditLogs && appState.auditLogs.length > 0 ? appState.auditLogs[0] : null;

    const payload = {
      action: "saveMonth",
      year: year,
      month: month,
      monthData: monthData,
      waterMeters: waterM,
      elecMeters: elecM,
      auditLog: latestAudit
    };

    try {
      this.updateStatusBadge("saving");
      // Use text/plain to prevent CORS preflight OPTIONS in Google Apps Script
      const response = await fetch(this.getUrl(), {
        method: "POST",
        mode: "cors",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(payload)
      });

      const res = await response.json();
      if (res.status === "success") {
        const syncTime = this.setLastSyncTime();
        this.updateStatusBadge("connected", syncTime);
        if (typeof showToast === "function") {
          showToast(`☁️ บันทึกลง Google Sheets (${month} ${year}) สำเร็จ!`);
        }
        return true;
      } else {
        throw new Error(res.message || "Server returned failure");
      }
    } catch (err) {
      console.error("[Google Sheets Sync] Save month error:", err);
      this.updateStatusBadge("error");
      if (typeof showToast === "function") {
        showToast(`⚠️ บันทึกลง Google Sheets ไม่สำเร็จ: ${err.message}`, "warning");
      }
      return false;
    }
  },

  // --------------------------------------------------------------------------
  // SEED ALL DATA TO SHEETS (INITIAL SETUP)
  // --------------------------------------------------------------------------
  async seedAllToSheets() {
    if (!this.isConfigured()) throw new Error("โปรดระบุและบันทึก URL ก่อนดำเนินการ");

    const payload = {
      action: "seedAllData",
      multiYearData: appState.multiYearData,
      waterMeters: appState.waterMeters,
      elecMeters: appState.elecMeters
    };

    const response = await fetch(this.getUrl(), {
      method: "POST",
      mode: "cors",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload)
    });

    const res = await response.json();
    if (res.status !== "success") {
      throw new Error(res.message || "ไม่สามารถส่งออกข้อมูลทั้งหมดได้");
    }

    this.setLastSyncTime();
    this.updateStatusBadge("connected");
    return res;
  },

  // --------------------------------------------------------------------------
  // UI STATUS BADGE CONTROLLER
  // --------------------------------------------------------------------------
  updateStatusBadge(statusOverride, extraInfo) {
    const badge = document.getElementById("sheets-sync-btn");
    const indicator = document.getElementById("sheets-status-indicator");
    const statusText = document.getElementById("sheets-status-text");
    const syncTimeText = document.getElementById("sheets-last-sync-display");

    const configured = this.isConfigured();
    const lastSync = extraInfo || this.getLastSyncTime();

    if (syncTimeText) {
      syncTimeText.textContent = lastSync ? `ซิงค์ล่าสุด: ${lastSync}` : "ยังไม่มีประวัติซิงค์";
    }

    if (!configured) {
      if (badge) {
        badge.className = "btn btn-sm btn-sheets-unconfigured";
        badge.innerHTML = `<i class="fa-solid fa-cloud"></i> <span>Google Sheets</span> <span class="sync-dot-badge dot-gray" title="ยังไม่เชื่อมต่อ"></span>`;
      }
      if (indicator) {
        indicator.className = "sync-status-pill pill-gray";
        indicator.innerHTML = `<span class="sync-dot dot-gray"></span> <span>Local Only</span>`;
      }
      if (statusText) statusText.innerHTML = `<span style="color:#64748b;"><i class="fa-solid fa-circle-info"></i> ยังไม่ได้เชื่อมต่อ Google Sheets (ทำงานแบบ Local)</span>`;
      return;
    }

    const state = statusOverride || "connected";

    if (state === "syncing" || state === "saving") {
      if (badge) {
        badge.className = "btn btn-sm btn-sheets-syncing";
        badge.innerHTML = `<i class="fa-solid fa-arrows-rotate fa-spin"></i> <span>กำลังซิงค์...</span>`;
      }
      if (indicator) {
        indicator.className = "sync-status-pill pill-yellow";
        indicator.innerHTML = `<span class="sync-dot dot-yellow fa-spin"></span> <span>กำลังซิงค์...</span>`;
      }
      if (statusText) statusText.innerHTML = `<span style="color:#d97706;"><i class="fa-solid fa-arrows-rotate fa-spin"></i> กำลังซิงค์ข้อมูลกับ Google Sheets...</span>`;
    } else if (state === "connected") {
      if (badge) {
        badge.className = "btn btn-sm btn-sheets-connected";
        badge.innerHTML = `<i class="fa-solid fa-cloud-arrow-up"></i> <span>Google Sheets</span> <span class="sync-dot-badge dot-green" title="เชื่อมต่อแล้ว"></span>`;
      }
      if (indicator) {
        indicator.className = "sync-status-pill pill-green";
        indicator.innerHTML = `<span class="sync-dot dot-green"></span> <span>เชื่อมต่อแล้ว</span>`;
      }
      if (statusText) statusText.innerHTML = `<span style="color:#059669;"><i class="fa-solid fa-circle-check"></i> เชื่อมต่อ Google Sheets เรียบร้อยแล้ว (ซิงค์อัตโนมัติ)</span>`;
    } else if (state === "error") {
      if (badge) {
        badge.className = "btn btn-sm btn-sheets-error";
        badge.innerHTML = `<i class="fa-solid fa-cloud-exclamation"></i> <span>Sheets ผิดพลาด</span> <span class="sync-dot-badge dot-red" title="เชื่อมต่อไม่สำเร็จ"></span>`;
      }
      if (indicator) {
        indicator.className = "sync-status-pill pill-red";
        indicator.innerHTML = `<span class="sync-dot dot-red"></span> <span>เชื่อมต่อไม่ได้</span>`;
      }
      if (statusText) statusText.innerHTML = `<span style="color:#dc2626;"><i class="fa-solid fa-triangle-exclamation"></i> ไม่สามารถเชื่อมต่อ Google Sheets ได้ (${extraInfo || "Error"})</span>`;
    }
  }
};

// ----------------------------------------------------------------------------
// MODAL CONTROLLERS & EVENT HANDLERS
// ----------------------------------------------------------------------------
function openSheetsModal() {
  const modal = document.getElementById("sheets-modal");
  if (!modal) return;

  const inputUrl = document.getElementById("sheets-url-input");
  if (inputUrl) {
    inputUrl.value = sheetsService.getUrl();
  }

  sheetsService.updateStatusBadge();
  modal.style.display = "flex";
}

function closeSheetsModal() {
  const modal = document.getElementById("sheets-modal");
  if (modal) modal.style.display = "none";
}

async function handleTestSheetsConnection() {
  const inputUrl = document.getElementById("sheets-url-input");
  const resultDiv = document.getElementById("sheets-test-result");
  const url = inputUrl ? inputUrl.value.trim() : "";

  if (!url) {
    if (resultDiv) {
      resultDiv.style.display = "block";
      resultDiv.className = "alert alert-warning";
      resultDiv.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> โปรดวาง URL ของ Google Apps Script ก่อนทดสอบ`;
    }
    return;
  }

  if (resultDiv) {
    resultDiv.style.display = "block";
    resultDiv.className = "alert alert-info";
    resultDiv.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> กำลังทดสอบเชื่อมต่อไปยัง Google Sheets...`;
  }

  try {
    const res = await sheetsService.testConnection(url);
    if (resultDiv) {
      resultDiv.className = "alert alert-success";
      resultDiv.innerHTML = `
        <div style="font-weight:700;"><i class="fa-solid fa-circle-check"></i> เชื่อมต่อสำเร็จ! (Response Time: ${res.durationMs} ms)</div>
        <small style="opacity:0.9;">Google Apps Script Web App ตอบกลับอย่างสมบูรณ์ พร้อมใช้งานแล้ว</small>
      `;
    }
  } catch (err) {
    if (resultDiv) {
      resultDiv.className = "alert alert-danger";
      resultDiv.innerHTML = `
        <div style="font-weight:700;"><i class="fa-solid fa-circle-xmark"></i> เชื่อมต่อไม่สำเร็จ</div>
        <small style="display:block; margin-top:4px;">${err.message}</small>
        <small style="display:block; margin-top:6px; color:#991b1b;">💡 ตรวจสอบ: ตั้งค่า Web App ให้สิทธิ์เข้าถึงเป็น <b>"ทุกคน (Anyone)"</b> แล้วหรือยัง?</small>
      `;
    }
  }
}

function handleSaveSheetsUrl() {
  const inputUrl = document.getElementById("sheets-url-input");
  const url = inputUrl ? inputUrl.value.trim() : "";

  sheetsService.setUrl(url);

  if (url) {
    if (typeof showToast === "function") showToast("✅ บันทึกการเชื่อมต่อ Google Sheets เรียบร้อยแล้ว");
    // Trigger background sync immediately
    sheetsService.syncFromSheets(true);
  } else {
    if (typeof showToast === "function") showToast("ลบการเชื่อมต่อ Google Sheets แล้ว (กลับมาใช้โหมด Local)");
  }

  closeSheetsModal();
}

async function handlePullFromSheets() {
  const resultDiv = document.getElementById("sheets-test-result");
  if (resultDiv) {
    resultDiv.style.display = "block";
    resultDiv.className = "alert alert-info";
    resultDiv.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> กำลังดึงข้อมูลทั้งหมดจาก Google Sheets...`;
  }

  const ok = await sheetsService.syncFromSheets(true);
  if (resultDiv) {
    if (ok) {
      resultDiv.className = "alert alert-success";
      resultDiv.innerHTML = `<i class="fa-solid fa-circle-check"></i> ดึงข้อมูลและอัพเดทแดชบอร์ดเรียบร้อยแล้ว!`;
    } else {
      resultDiv.className = "alert alert-danger";
      resultDiv.innerHTML = `<i class="fa-solid fa-circle-xmark"></i> ไม่สามารถดึงข้อมูลได้ โปรดตรวจสอบการเชื่อมต่อ`;
    }
  }
}

async function handleSeedAllToSheets() {
  if (!confirm("⚠️ ยืนยันการส่งออกข้อมูลทั้งหมด:\n\nระบบจะสร้างชีต Energy_Summary, Water_Meters, Elec_Meters และส่งข้อมูลทั้งหมด (ปี 2559 - 2569) ขึ้น Google Sheets ทันที\n\nต้องการดำเนินการต่อหรือไม่?")) {
    return;
  }

  const resultDiv = document.getElementById("sheets-test-result");
  if (resultDiv) {
    resultDiv.style.display = "block";
    resultDiv.className = "alert alert-info";
    resultDiv.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> กำลังส่งออกข้อมูลทั้งหมด 11 ปีขึ้น Google Sheets (อาจใช้เวลาประมาณ 3-5 วินาที)...`;
  }

  try {
    const res = await sheetsService.seedAllToSheets();
    if (resultDiv) {
      resultDiv.className = "alert alert-success";
      resultDiv.innerHTML = `
        <div style="font-weight:700;"><i class="fa-solid fa-circle-check"></i> ส่งออกข้อมูล 11 ปีขึ้น Google Sheets เรียบร้อย!</div>
        <small>สรุปพลังงาน: ${res.details?.energyRecords || 0} แถว | มิเตอร์น้ำ: ${res.details?.waterRecords || 0} แถว | มิเตอร์ไฟ: ${res.details?.elecRecords || 0} แถว</small>
      `;
    }
    if (typeof showToast === "function") showToast("✅ ส่งออกข้อมูลทั้งหมดขึ้น Google Sheets สำเร็จ!");
  } catch (err) {
    if (resultDiv) {
      resultDiv.className = "alert alert-danger";
      resultDiv.innerHTML = `<i class="fa-solid fa-circle-xmark"></i> ส่งออกข้อมูลไม่สำเร็จ: ${err.message}`;
    }
  }
}

function copyAppsScriptCode() {
  const code = `/** วางโค้ดนี้ใน Google Sheets > ส่วนขยาย > Apps Script **/`;
  // Read full code from hidden textarea or fetch
  const fullCodeEl = document.getElementById("apps-script-full-code");
  const codeToCopy = (typeof GOOGLE_APPS_SCRIPT_SOURCE !== "undefined") ? GOOGLE_APPS_SCRIPT_SOURCE : (fullCodeEl ? fullCodeEl.value : code);

  navigator.clipboard.writeText(codeToCopy).then(() => {
    if (typeof showToast === "function") showToast("📋 คัดลอกโค้ด Google Apps Script เรียบร้อยแล้ว!");
  }).catch(() => {
    alert("โปรดคลุมดำและคัดลอกโค้ดด้วยตนเอง");
  });
}

function switchSheetsModalTab(tabId) {
  document.querySelectorAll(".sheets-tab-btn").forEach(btn => btn.classList.remove("active"));
  document.querySelectorAll(".sheets-tab-content").forEach(content => content.classList.remove("active"));

  const targetBtn = document.querySelector(`.sheets-tab-btn[data-tab="${tabId}"]`);
  const targetContent = document.getElementById(tabId);

  if (targetBtn) targetBtn.classList.add("active");
  if (targetContent) targetContent.classList.add("active");
}

const GOOGLE_APPS_SCRIPT_SOURCE = "/**\n * ============================================================================\n * GOOGLE APPS SCRIPT: Energy Usage System Backend API (ระบบบริหารจัดการพลังงาน)\n * ============================================================================\n * \n * วิธีการติดตั้ง (Quick Setup):\n * 1. เปิด Google Sheets ใหม่ (หรือไฟล์เดิม)\n * 2. เมนูด้านบน เลือก: \"ส่วนขยาย\" (Extensions) > \"Apps Script\"\n * 3. ลบโค้ดเดิมออกทั้งหมด แล้ววางโค้ดไฟล์นี้ลงไปทั้งหมด\n * 4. กดปุ่ม \"บันทึก\" (รูปแผ่นดิสก์)\n * 5. กดปุ่มสีน้ำเงินมุมขวาบน \"การทำให้ใช้งานได้\" (Deploy) > \"การทำให้ใช้งานได้ใหม่\" (New deployment)\n * 6. เลือกประเภท: \"เว็บแอป\" (Web app)\n * 7. ตั้งค่า:\n *    - คำอธิบาย: Energy API\n *    - ดำเนินการในฐานะ: \"ฉัน\" (Me - บัญชีของคุณ)\n *    - ผู้ที่มีสิทธิ์เข้าถึง: \"ทุกคน\" (Anyone) **สำคัญมาก ต้องเลือกทุกคน**\n * 8. กด \"ทำให้ใช้งานได้\" (Deploy) และกดยืนยันสิทธิ์การเข้าถึง (Authorize Access)\n * 9. คัดลอก \"URL เว็บแอป\" (Web App URL) ที่ขึ้นต้นด้วย https://script.google.com/macros/s/.../exec\n *    นำไปวางในหน้าต่างตั้งค่า Google Sheets บนหน้าเว็บไซต์ของคุณ\n * ============================================================================\n */\n\nconst SHEET_ENERGY = \"Energy_Summary\";\nconst SHEET_WATER = \"Water_Meters\";\nconst SHEET_ELEC = \"Elec_Meters\";\nconst SHEET_AUDIT = \"Audit_Logs\";\n\nfunction doGet(e) {\n  try {\n    const action = e.parameter.action || \"getData\";\n    \n    if (action === \"ping\") {\n      return jsonResponse({\n        status: \"success\",\n        message: \"Google Apps Script API is running perfectly!\",\n        timestamp: new Date().toISOString()\n      });\n    }\n    \n    if (action === \"getData\") {\n      const data = getAllDataFromSheets();\n      return jsonResponse({\n        status: \"success\",\n        data: data,\n        timestamp: new Date().toISOString()\n      });\n    }\n\n    return jsonResponse({ status: \"error\", message: \"Unknown GET action: \" + action });\n  } catch (err) {\n    return jsonResponse({ status: \"error\", message: err.toString() });\n  }\n}\n\nfunction doPost(e) {\n  try {\n    const contents = e.postData && e.postData.contents ? JSON.parse(e.postData.contents) : {};\n    const action = contents.action || \"saveMonth\";\n\n    if (action === \"ping\") {\n      return jsonResponse({ status: \"success\", message: \"POST Ping OK\" });\n    }\n\n    if (action === \"seedAllData\") {\n      const res = seedAllDataToSheets(contents.multiYearData, contents.waterMeters, contents.elecMeters);\n      return jsonResponse({ status: \"success\", message: \"Seeded all data successfully\", details: res });\n    }\n\n    if (action === \"saveMonth\") {\n      const res = saveSingleMonth(contents);\n      return jsonResponse({ status: \"success\", message: \"Month saved successfully\", details: res });\n    }\n\n    return jsonResponse({ status: \"error\", message: \"Unknown POST action: \" + action });\n  } catch (err) {\n    return jsonResponse({ status: \"error\", message: err.toString() });\n  }\n}\n\nfunction jsonResponse(obj) {\n  return ContentService.createTextOutput(JSON.stringify(obj))\n    .setMimeType(ContentService.MimeType.JSON);\n}\n\n// ----------------------------------------------------------------------------\n// GET ALL DATA\n// ----------------------------------------------------------------------------\nfunction getAllDataFromSheets() {\n  const ss = SpreadsheetApp.getActiveSpreadsheet();\n  ensureSheetsSetup(ss);\n\n  const multiYearData = {};\n  const waterMeters = {};\n  const elecMeters = {};\n  const auditLogs = [];\n\n  // 1. Read Energy Summary\n  const sheetEnergy = ss.getSheetByName(SHEET_ENERGY);\n  const energyRows = sheetEnergy.getDataRange().getValues();\n  // Header: Year(0), Month(1), Production(2), WaterUsage(3), WaterCost(4), ElecUsage(5), ElecCost(6), FuelUsage(7), FuelCost(8), GasUsage(9), GasCost(10), TotalCost(11), CostPerHead(12), UpdatedAt(13)\n  for (let i = 1; i < energyRows.length; i++) {\n    const r = energyRows[i];\n    const year = String(r[0]);\n    const month = String(r[1]);\n    if (!year || !month || year === \"undefined\") continue;\n\n    if (!multiYearData[year]) multiYearData[year] = {};\n\n    const prod = Number(r[2]) || 0;\n    const waterU = Number(r[3]) || 0;\n    const waterC = Number(r[4]) || 0;\n    const elecU = Number(r[5]) || 0;\n    const elecC = Number(r[6]) || 0;\n    const fuelU = Number(r[7]) || 0;\n    const fuelC = Number(r[8]) || 0;\n    const gasU = Number(r[9]) || 0;\n    const gasC = Number(r[10]) || 0;\n    const totC = Number(r[11]) || 0;\n\n    multiYearData[year][month] = {\n      month: month,\n      year: parseInt(year),\n      production: prod,\n      totalCost: totC,\n      updatedAt: r[13] ? String(r[13]) : \"\",\n      isLocked: true,\n      items: [\n        { id: 1, name: \"น้ำ\", usage: waterU, unit: \"ลบ.ม.\", cost: waterC, production: prod, usagePerProd: prod > 0 ? waterU / prod : 0, costPerProd: prod > 0 ? waterC / prod : 0 },\n        { id: 2, name: \"ไฟฟ้า\", usage: elecU, unit: \"kWh\", cost: elecC, production: prod, usagePerProd: prod > 0 ? elecU / prod : 0, costPerProd: prod > 0 ? elecC / prod : 0 },\n        { id: 3, name: \"น้ำมันเชื้อเพลิง\", usage: fuelU, unit: \"ลิตร\", cost: fuelC, production: prod, usagePerProd: prod > 0 ? fuelU / prod : 0, costPerProd: prod > 0 ? fuelC / prod : 0 },\n        { id: 4, name: \"แก๊ส (LPG)\", usage: gasU, unit: \"กิโลกรัม\", cost: gasC, production: prod, usagePerProd: prod > 0 ? gasU / prod : 0, costPerProd: prod > 0 ? gasC / prod : 0 }\n      ]\n    };\n  }\n\n  // 2. Read Water Meters\n  const sheetWater = ss.getSheetByName(SHEET_WATER);\n  const waterRows = sheetWater.getDataRange().getValues();\n  // Header: Year(0), Month(1), Meter_ID(2), Meter_Code(3), House_No(4), Location(5), Usage(6), Cost(7)\n  for (let i = 1; i < waterRows.length; i++) {\n    const r = waterRows[i];\n    const year = String(r[0]);\n    const month = String(r[1]);\n    if (!year || !month) continue;\n    const k = year + \"_\" + month;\n    if (!waterMeters[k]) waterMeters[k] = [];\n    waterMeters[k].push({\n      id: Number(r[2]) || 0,\n      meterCode: String(r[3] || \"\"),\n      houseNo: String(r[4] || \"\"),\n      location: String(r[5] || \"\"),\n      usage: Number(r[6]) || 0,\n      cost: Number(r[7]) || 0\n    });\n  }\n\n  // 3. Read Elec Meters\n  const sheetElec = ss.getSheetByName(SHEET_ELEC);\n  const elecRows = sheetElec.getDataRange().getValues();\n  for (let i = 1; i < elecRows.length; i++) {\n    const r = elecRows[i];\n    const year = String(r[0]);\n    const month = String(r[1]);\n    if (!year || !month) continue;\n    const k = year + \"_\" + month;\n    if (!elecMeters[k]) elecMeters[k] = [];\n    elecMeters[k].push({\n      id: Number(r[2]) || 0,\n      meterCode: String(r[3] || \"\"),\n      houseNo: String(r[4] || \"\"),\n      location: String(r[5] || \"\"),\n      usage: Number(r[6]) || 0,\n      cost: Number(r[7]) || 0\n    });\n  }\n\n  // 4. Read Audit Logs\n  const sheetAudit = ss.getSheetByName(SHEET_AUDIT);\n  const auditRows = sheetAudit.getDataRange().getValues();\n  // Header: Timestamp(0), Month_Year(1), Editor(2), Reason(3), Changes(4)\n  for (let i = 1; i < auditRows.length; i++) {\n    const r = auditRows[i];\n    if (!r[0]) continue;\n    auditLogs.push({\n      id: i,\n      timestamp: String(r[0]),\n      month: String(r[1]),\n      editor: String(r[2]),\n      reason: String(r[3]),\n      changes: String(r[4]).split(\"\\n\")\n    });\n  }\n\n  return {\n    multiYearData: multiYearData,\n    waterMeters: waterMeters,\n    elecMeters: elecMeters,\n    auditLogs: auditLogs\n  };\n}\n\n// ----------------------------------------------------------------------------\n// SAVE SINGLE MONTH\n// ----------------------------------------------------------------------------\nfunction saveSingleMonth(payload) {\n  const ss = SpreadsheetApp.getActiveSpreadsheet();\n  ensureSheetsSetup(ss);\n\n  const year = payload.year;\n  const month = payload.month;\n  const monthData = payload.monthData || {};\n  const waterMet = payload.waterMeters || [];\n  const elecMet = payload.elecMeters || [];\n  const auditLog = payload.auditLog;\n\n  // 1. Upsert Energy Summary\n  const sheetEnergy = ss.getSheetByName(SHEET_ENERGY);\n  const energyData = sheetEnergy.getDataRange().getValues();\n  let foundRowIdx = -1;\n\n  for (let i = 1; i < energyData.length; i++) {\n    if (String(energyData[i][0]) === String(year) && String(energyData[i][1]) === String(month)) {\n      foundRowIdx = i + 1;\n      break;\n    }\n  }\n\n  const items = monthData.items || [];\n  const waterItem = items.find(it => it.name && it.name.includes(\"น้ำ\") && !it.name.includes(\"น้ำมัน\")) || {};\n  const elecItem = items.find(it => it.name && it.name.includes(\"ไฟฟ้า\")) || {};\n  const fuelItem = items.find(it => it.name && it.name.includes(\"น้ำมัน\")) || {};\n  const gasItem = items.find(it => it.name && it.name.includes(\"แก๊ส\")) || {};\n\n  const prod = Number(monthData.production) || 0;\n  const totC = Number(monthData.totalCost) || 0;\n  const costPerHead = prod > 0 ? totC / prod : 0;\n  const nowStr = new Date().toLocaleString(\"th-TH\");\n\n  const rowValues = [\n    year,\n    month,\n    prod,\n    Number(waterItem.usage) || 0,\n    Number(waterItem.cost) || 0,\n    Number(elecItem.usage) || 0,\n    Number(elecItem.cost) || 0,\n    Number(fuelItem.usage) || 0,\n    Number(fuelItem.cost) || 0,\n    Number(gasItem.usage) || 0,\n    Number(gasItem.cost) || 0,\n    totC,\n    costPerHead,\n    nowStr\n  ];\n\n  if (foundRowIdx > 0) {\n    sheetEnergy.getRange(foundRowIdx, 1, 1, rowValues.length).setValues([rowValues]);\n  } else {\n    sheetEnergy.appendRow(rowValues);\n  }\n\n  // 2. Upsert Sub-meters\n  upsertSubMeters(ss.getSheetByName(SHEET_WATER), year, month, waterMet);\n  upsertSubMeters(ss.getSheetByName(SHEET_ELEC), year, month, elecMet);\n\n  // 3. Append Audit Log if provided\n  if (auditLog) {\n    const sheetAudit = ss.getSheetByName(SHEET_AUDIT);\n    sheetAudit.appendRow([\n      auditLog.timestamp || nowStr,\n      auditLog.month || (month + \" \" + year),\n      auditLog.editor || \"ผู้แก้ไขระบบ\",\n      auditLog.reason || \"-\",\n      Array.isArray(auditLog.changes) ? auditLog.changes.join(\"\\n\") : String(auditLog.changes || \"-\")\n    ]);\n  }\n\n  return { year: year, month: month, status: \"updated\" };\n}\n\nfunction upsertSubMeters(sheet, year, month, metersList) {\n  if (!sheet || !metersList || metersList.length === 0) return;\n  const values = sheet.getDataRange().getValues();\n  const rowsToKeep = [];\n\n  // Keep header\n  if (values.length > 0) rowsToKeep.push(values[0]);\n\n  // Keep other months' data\n  for (let i = 1; i < values.length; i++) {\n    const r = values[i];\n    if (String(r[0]) === String(year) && String(r[1]) === String(month)) {\n      continue; // Remove old rows for this month\n    }\n    rowsToKeep.push(r);\n  }\n\n  // Add new rows\n  metersList.forEach(m => {\n    rowsToKeep.push([\n      year,\n      month,\n      m.id || 0,\n      m.meterCode || \"\",\n      m.houseNo || \"\",\n      m.location || \"\",\n      Number(m.usage) || 0,\n      Number(m.cost) || 0\n    ]);\n  });\n\n  sheet.clearContents();\n  sheet.getRange(1, 1, rowsToKeep.length, rowsToKeep[0].length).setValues(rowsToKeep);\n}\n\n// ----------------------------------------------------------------------------\n// SEED ALL DATA (2559 - 2569) INITIAL SETUP\n// ----------------------------------------------------------------------------\nfunction seedAllDataToSheets(multiYearData, waterMeters, elecMeters) {\n  const ss = SpreadsheetApp.getActiveSpreadsheet();\n  ensureSheetsSetup(ss, true); // true = reset headers\n\n  // 1. Populate Energy Summary\n  const sheetEnergy = ss.getSheetByName(SHEET_ENERGY);\n  const energyRows = [];\n  const years = Object.keys(multiYearData || {}).map(Number).sort((a,b)=>a-b);\n\n  years.forEach(yr => {\n    const monthsObj = multiYearData[yr] || {};\n    const months = Object.keys(monthsObj);\n    months.forEach(m => {\n      const d = monthsObj[m];\n      if (!d) return;\n      const items = d.items || [];\n      const waterItem = items.find(it => it.name && it.name.includes(\"น้ำ\") && !it.name.includes(\"น้ำมัน\")) || {};\n      const elecItem = items.find(it => it.name && it.name.includes(\"ไฟฟ้า\")) || {};\n      const fuelItem = items.find(it => it.name && it.name.includes(\"น้ำมัน\")) || {};\n      const gasItem = items.find(it => it.name && it.name.includes(\"แก๊ส\")) || {};\n\n      const prod = Number(d.production) || 0;\n      const totC = Number(d.totalCost) || 0;\n      const costPerHead = prod > 0 ? totC / prod : 0;\n\n      energyRows.push([\n        yr,\n        m,\n        prod,\n        Number(waterItem.usage) || 0,\n        Number(waterItem.cost) || 0,\n        Number(elecItem.usage) || 0,\n        Number(elecItem.cost) || 0,\n        Number(fuelItem.usage) || 0,\n        Number(fuelItem.cost) || 0,\n        Number(gasItem.usage) || 0,\n        Number(gasItem.cost) || 0,\n        totC,\n        costPerHead,\n        d.updatedAt || \"\"\n      ]);\n    });\n  });\n\n  if (energyRows.length > 0) {\n    sheetEnergy.getRange(2, 1, energyRows.length, energyRows[0].length).setValues(energyRows);\n  }\n\n  // 2. Populate Water Meters\n  const sheetWater = ss.getSheetByName(SHEET_WATER);\n  const waterRows = [];\n  Object.keys(waterMeters || {}).forEach(k => {\n    const parts = k.split(\"_\");\n    const yr = parts[0];\n    const m = parts[1];\n    (waterMeters[k] || []).forEach(item => {\n      waterRows.push([\n        yr,\n        m,\n        item.id || 0,\n        item.meterCode || \"\",\n        item.houseNo || \"\",\n        item.location || \"\",\n        Number(item.usage) || 0,\n        Number(item.cost) || 0\n      ]);\n    });\n  });\n  if (waterRows.length > 0) {\n    sheetWater.getRange(2, 1, waterRows.length, waterRows[0].length).setValues(waterRows);\n  }\n\n  // 3. Populate Elec Meters\n  const sheetElec = ss.getSheetByName(SHEET_ELEC);\n  const elecRows = [];\n  Object.keys(elecMeters || {}).forEach(k => {\n    const parts = k.split(\"_\");\n    const yr = parts[0];\n    const m = parts[1];\n    (elecMeters[k] || []).forEach(item => {\n      elecRows.push([\n        yr,\n        m,\n        item.id || 0,\n        item.meterCode || \"\",\n        item.houseNo || \"\",\n        item.location || \"\",\n        Number(item.usage) || 0,\n        Number(item.cost) || 0\n      ]);\n    });\n  });\n  if (elecRows.length > 0) {\n    sheetElec.getRange(2, 1, elecRows.length, elecRows[0].length).setValues(elecRows);\n  }\n\n  return {\n    energyRecords: energyRows.length,\n    waterRecords: waterRows.length,\n    elecRecords: elecRows.length\n  };\n}\n\n// ----------------------------------------------------------------------------\n// ENSURE SHEETS EXIST & FORMAT HEADERS\n// ----------------------------------------------------------------------------\nfunction ensureSheetsSetup(ss, forceReset) {\n  const configs = [\n    {\n      name: SHEET_ENERGY,\n      headers: [\n        \"ปี (Year)\", \"เดือน (Month)\", \"ยอดการผลิต (ตัว)\", \n        \"น้ำ (ลบ.ม.)\", \"ค่าน้ำ (บาท)\", \n        \"ไฟฟ้า (kWh)\", \"ค่าไฟ (บาท)\", \n        \"น้ำมัน (ลิตร)\", \"ค่าน้ำมัน (บาท)\", \n        \"แก๊ส (กก.)\", \"ค่าแก๊ส (บาท)\", \n        \"รวมยอดเงิน (บาท)\", \"ค่าใช้จ่ายเฉลี่ย/ตัว (บาท)\", \"อัพเดทล่าสุด\"\n      ],\n      color: \"#0284c7\" // ฟ้า\n    },\n    {\n      name: SHEET_WATER,\n      headers: [\"ปี (Year)\", \"เดือน (Month)\", \"ลำดับ\", \"รหัสเครื่องวัด\", \"บ้านเลขที่\", \"สถานที่\", \"ปริมาณการใช้ (ลบ.ม.)\", \"จำนวนเงิน (บาท)\"],\n      color: \"#0369a1\" // น้ำเงิน\n    },\n    {\n      name: SHEET_ELEC,\n      headers: [\"ปี (Year)\", \"เดือน (Month)\", \"ลำดับ\", \"รหัสเครื่องวัด\", \"บ้านเลขที่\", \"สถานที่\", \"ปริมาณการใช้ (kWh)\", \"จำนวนเงิน (บาท)\"],\n      color: \"#d97706\" // ส้ม\n    },\n    {\n      name: SHEET_AUDIT,\n      headers: [\"วัน-เวลา (Timestamp)\", \"รอบเดือน/ปี\", \"ผู้แก้ไข (Editor)\", \"เหตุผลการแก้ไข (Reason)\", \"รายละเอียดการเปลี่ยนแปลง (Changes)\"],\n      color: \"#4f46e5\" // ม่วง\n    }\n  ];\n\n  configs.forEach(cfg => {\n    let sheet = ss.getSheetByName(cfg.name);\n    if (!sheet) {\n      sheet = ss.insertSheet(cfg.name);\n    }\n    if (forceReset || sheet.getLastRow() === 0) {\n      sheet.clear();\n      sheet.getRange(1, 1, 1, cfg.headers.length).setValues([cfg.headers]);\n      const headerRange = sheet.getRange(1, 1, 1, cfg.headers.length);\n      headerRange.setBackground(cfg.color);\n      headerRange.setFontColor(\"#ffffff\");\n      headerRange.setFontWeight(\"bold\");\n      headerRange.setHorizontalAlignment(\"center\");\n      sheet.setFrozenRows(1);\n    }\n  });\n}\n";
